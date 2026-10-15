package com.example.twoaccmess

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import android.util.Base64

private const val NOTES_MAX_IMAGE_BYTES = 500_000
private const val NOTES_MAX_TEXT = 4_000
private const val NOTES_AAD = "Bop LAN notes v1"

data class LinkedNote(
    val id: String,
    val text: String,
    val image: String = "",
    val mime: String = "",
    val sender: String,
    val timestamp: Long,
    val deletedAt: Long = 0,
)

object LinkedNotes {
    data class Pairing(val host: String, val port: Int, val token: String)

    fun parsePairingCode(value: String): Pairing? {
        val match = Regex("^BOPNOTES1:((?:[0-9]{1,3}\\.){3}[0-9]{1,3}):([0-9]{1,5}):([a-fA-F0-9]{64})$").matchEntire(value.trim()) ?: return null
        val host = normalizePrivateHost(match.groupValues[1]) ?: return null
        val port = match.groupValues[2].toIntOrNull()?.takeIf { it == 38671 } ?: return null
        return Pairing(host, port, match.groupValues[3])
    }

    fun create(text: String, image: String = "", mime: String = "image/jpeg", sender: String = "Android", timestamp: Long = System.currentTimeMillis()) =
        normalize(LinkedNote(UUID.randomUUID().toString(), text, image, mime, sender, timestamp))
            ?: throw IllegalArgumentException("A note needs text or a supported image")

    fun normalize(note: LinkedNote): LinkedNote? {
        return try {
            if (!note.id.matches(Regex("[A-Za-z0-9_-]{8,80}")) || note.text.length > 100_000 || note.image.length > 666_672) return null
            val text = note.text.take(NOTES_MAX_TEXT).trim()
            val image = note.image
            base64ByteCount(image) ?: return null
            if (text.isBlank() && image.isBlank() && note.deletedAt <= 0) return null
            LinkedNote(note.id, text, image, if (image.isEmpty()) "" else if (note.mime == "image/png") "image/png" else "image/jpeg",
                if (note.sender == "Android") "Android" else "Desktop", note.timestamp.coerceAtLeast(1), note.deletedAt.coerceAtLeast(0))
        } catch (_: Exception) { null }
    }

    fun merge(first: List<LinkedNote>, second: List<LinkedNote>): List<LinkedNote> =
        mergeIncludingDeleted(first, second)

    private fun mergeIncludingDeleted(first: List<LinkedNote>, second: List<LinkedNote>): List<LinkedNote> {
        val merged = (first + second).mapNotNull(::normalize)
            .groupBy { it.id }.values.map { versions -> versions.maxWith(compareBy<LinkedNote> { it.deletedAt }.thenBy { it.timestamp }) }
            .sortedWith(compareBy<LinkedNote> { maxOf(it.timestamp, it.deletedAt) }.thenBy { it.id }).takeLast(100)
        var bytes = 0
        return merged.asReversed().filter { note ->
            val size = note.text.toByteArray(Charsets.UTF_8).size + (base64ByteCount(note.image) ?: 0)
            if (bytes + size > 5_000_000) false else { bytes += size; true }
        }.asReversed()
    }

    private fun base64ByteCount(value: String): Int? {
        if (value.isEmpty()) return 0
        if (value.length > ((NOTES_MAX_IMAGE_BYTES + 2) / 3) * 4 || value.length % 4 != 0 ||
            !value.matches(Regex("(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?"))) return null
        val padding = when {
            value.endsWith("==") -> 2
            value.endsWith("=") -> 1
            else -> 0
        }
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        if ((padding == 2 && alphabet.indexOf(value[value.length - 3]) and 15 != 0) ||
            (padding == 1 && alphabet.indexOf(value[value.length - 2]) and 3 != 0)) return null
        val decodedBytes = value.length / 4 * 3 - padding
        return decodedBytes.takeIf { it <= NOTES_MAX_IMAGE_BYTES }
    }

    private fun readFrame(input: InputStream, maxBytes: Int): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) throw IllegalStateException("Desktop closed the sync connection")
            var newline = -1
            for (index in 0 until count) if (buffer[index] == 10.toByte()) { newline = index; break }
            val length = if (newline < 0) count else newline
            require(output.size() + length <= maxBytes) { "Notes response is too large" }
            output.write(buffer, 0, length)
            if (newline >= 0) return output.toString(Charsets.UTF_8.name())
        }
    }

    fun image(context: Context, uri: Uri): Pair<String, String>? {
        return try {
            val resolver = context.contentResolver
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: return null
            var sample = 1
            while (bounds.outWidth / sample > 1280 || bounds.outHeight / sample > 1280) sample *= 2
            val options = BitmapFactory.Options().apply { inSampleSize = sample }
            val bitmap = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
            var quality = 88
            var bytes: ByteArray
            do {
                val output = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)
                bytes = output.toByteArray()
                quality -= 8
            } while (bytes.size > NOTES_MAX_IMAGE_BYTES && quality >= 40)
            bitmap.recycle()
            if (bytes.size > NOTES_MAX_IMAGE_BYTES) null else Base64.encodeToString(bytes, Base64.NO_WRAP) to "image/jpeg"
        } catch (_: Exception) { null }
    }

    fun decodeImage(value: String): Bitmap? = try { val bytes = Base64.decode(value, Base64.DEFAULT); BitmapFactory.decodeByteArray(bytes, 0, bytes.size) } catch (_: Exception) { null }

    fun sync(host: String, port: Int, token: String, notes: List<LinkedNote>): List<LinkedNote> {
        require(normalizePrivateHost(host) != null && port in 1..65535 && token.matches(Regex("[a-fA-F0-9]{64}")))
        require(notes.size <= 100) { "Too many notes to sync at once" }
        Socket().use { socket ->
            socket.connect(InetSocketAddress(host, port), 3500)
            socket.soTimeout = 5000
            socket.tcpNoDelay = true
            val request = JSONObject().put("action", "merge").put("notes", JSONArray().apply { mergeIncludingDeleted(emptyList(), notes).forEach { put(it.toJson()) } })
            val writer = OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8)
            val frame = seal(token, request.toString())
            require(frame.toByteArray(Charsets.UTF_8).size <= 9_000_000) { "Notes request is too large" }
            writer.write(frame); writer.write("\n"); writer.flush()
            val line = readFrame(socket.getInputStream(), 9_000_000)
            val response = JSONObject(open(token, line))
            if (response.has("error")) throw IllegalStateException(response.getString("error"))
            val array = response.optJSONArray("notes") ?: JSONArray()
            val result = (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.toNote() }
            return mergeIncludingDeleted(notes, result)
        }
    }

    fun normalizePrivateHost(host: String): String? {
        val pieces = host.trim().split('.')
        if (pieces.size != 4) return null
        val octets = pieces.map { it.toIntOrNull()?.takeIf { value -> value in 0..255 } ?: return null }
        val private = octets[0] == 10 || octets[0] == 127 ||
            (octets[0] == 172 && octets[1] in 16..31) || (octets[0] == 192 && octets[1] == 168)
        return if (private) octets.joinToString(".") else null
    }

    fun tombstone(note: LinkedNote, deletedAt: Long = System.currentTimeMillis()): LinkedNote =
        LinkedNote(note.id, "", sender = note.sender, timestamp = note.timestamp, deletedAt = deletedAt.coerceAtLeast(1))

    fun parse(value: JSONObject): LinkedNote? = try {
        normalize(LinkedNote(value.getString("id"), value.optString("text"), value.optString("image"),
            value.optString("mime"), value.optString("sender"), value.optLong("timestamp", System.currentTimeMillis()), value.optLong("deletedAt", 0)))
    } catch (_: Exception) { null }

    private fun JSONObject.toNote() = LinkedNotes.parse(this)
    private fun LinkedNote.toJson() = JSONObject().put("id", id).put("text", text).put("image", image)
        .put("mime", mime).put("sender", sender).put("timestamp", timestamp).put("deletedAt", deletedAt)

    private fun key(token: String) = MessageDigest.getInstance("SHA-256").digest(token.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
    private fun seal(token: String, value: String): String {
        val nonce = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key(token), "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(NOTES_AAD.toByteArray(Charsets.UTF_8))
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return JSONObject().put("nonce", Base64.encodeToString(nonce, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(encrypted.copyOfRange(0, encrypted.size - 16), Base64.NO_WRAP))
            .put("tag", Base64.encodeToString(encrypted.copyOfRange(encrypted.size - 16, encrypted.size), Base64.NO_WRAP)).toString()
    }

    private fun open(token: String, frame: String): String {
        val value = JSONObject(frame)
        val nonce = Base64.decode(value.getString("nonce"), Base64.DEFAULT)
        val data = Base64.decode(value.getString("data"), Base64.DEFAULT)
        val tag = Base64.decode(value.getString("tag"), Base64.DEFAULT)
        require(nonce.size == 12 && tag.size == 16 && data.size <= 9_000_000)
        require(Base64.encodeToString(nonce, Base64.NO_WRAP) == value.getString("nonce") &&
            Base64.encodeToString(data, Base64.NO_WRAP) == value.getString("data") &&
            Base64.encodeToString(tag, Base64.NO_WRAP) == value.getString("tag")) { "Invalid encrypted frame encoding" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key(token), "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(NOTES_AAD.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(data + tag).toString(Charsets.UTF_8)
    }
}
