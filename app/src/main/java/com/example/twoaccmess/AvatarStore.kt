package com.example.twoaccmess

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.util.AtomicFile
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory
import java.io.File
import java.util.Locale

/** The largest centered square of a picture, in source pixels. */
data class AvatarCrop(val left: Int, val top: Int, val size: Int)

/** Naming, cropping and downscaling rules for the optional avatars. Pure so they can be unit-tested. */
object AvatarPolicy {
    /** Key of the single picture used as the floating bubble icon. */
    const val BUBBLE = "bubble"
    /** Stored pictures are squares with this longest edge: the overlay must stay cheap. */
    const val MAX_EDGE = 256
    const val DIR = "avatars"

    fun slot(id: AccountId?): String = id?.let { "account_${it.name.lowercase(Locale.ROOT)}" } ?: BUBBLE

    fun fileFor(slot: String) = "$slot.png"

    /** Only the bubble plus the current account slots exist, so a stale menu cannot write elsewhere. */
    fun valid(slot: String) = slot == BUBBLE || (slot.startsWith("account_") && AccountId.from(slot.removePrefix("account_").uppercase(Locale.ROOT))?.let { slot(it) == slot } == true)

    /**
     * Largest centered square of a [width]×[height] picture. Both stored sides come from the same
     * crop, so a portrait or landscape picture keeps its proportions instead of being squeezed into
     * a square (the 1.5 overlay stretched it to the frame before this).
     */
    fun crop(width: Int, height: Int): AvatarCrop {
        val size = minOf(width, height)
        if (size <= 0) return AvatarCrop(0, 0, 0)
        return AvatarCrop((width - size) / 2, (height - size) / 2, size)
    }

    /** Edge of the stored square copy: the shorter side, capped at [max]. Never upscales. */
    fun square(width: Int, height: Int, max: Int = MAX_EDGE): Int {
        val shortest = minOf(width, height)
        if (shortest <= 0 || max <= 0) return 0
        return minOf(shortest, max)
    }

    /** Power-of-two inSampleSize that keeps the decoded bitmap close to the stored size. */
    fun sampleSize(width: Int, height: Int, max: Int = MAX_EDGE): Int {
        val longest = maxOf(width, height)
        if (longest <= 0 || max <= 0) return 1
        var sample = 1
        while (longest / sample > max) sample *= 2
        return sample
    }
}

/**
 * App-private avatar files: one optional picture for the bubble icon and one per account slot.
 * Files live in `filesDir/avatars` and are never uploaded or shared. Decoding happens on a caller
 * worker thread; this object only reads and writes files plus a small in-process bitmap cache.
 */
object AvatarStore {
    private val cache = HashMap<String, Pair<Long, Bitmap>>()

    fun directory(context: Context) = File(context.filesDir, AvatarPolicy.DIR)
    fun file(context: Context, slot: String) = File(directory(context), AvatarPolicy.fileFor(slot))

    /** Changes whenever the stored file changes, so callers can use it as a cache key. */
    fun stamp(context: Context, slot: String): Long =
        if (AvatarPolicy.valid(slot)) file(context, slot).lastModified() else 0L

    fun has(context: Context, slot: String) = AvatarPolicy.valid(slot) && file(context, slot).let { it.isFile && it.length() > 0 }

    @Synchronized
    fun read(context: Context, slot: String): Bitmap? {
        if (!AvatarPolicy.valid(slot)) return null
        val target = file(context, slot)
        val stamp = target.lastModified()
        if (stamp <= 0 || !target.isFile) {
            cache.remove(slot)
            return null
        }
        cache[slot]?.let { (cachedStamp, bitmap) -> if (cachedStamp == stamp && !bitmap.isRecycled) return bitmap }
        return try {
            BitmapFactory.decodeFile(target.absolutePath)?.also { cache[slot] = stamp to it }
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * Decodes only enough of the picked image to store a small copy. Returns false for anything the
     * picker, the decoder or the filesystem refuses; the previous avatar then stays untouched.
     */
    fun save(context: Context, slot: String, uri: Uri): Boolean {
        if (!AvatarPolicy.valid(slot)) return false
        val source = try {
            decode(context, uri)
        } catch (_: Throwable) {
            null
        } ?: return false
        val scaled = try {
            square(source)
        } catch (_: Throwable) {
            null
        } ?: return false
        return try {
            directory(context).mkdirs()
            val target = AtomicFile(file(context, slot))
            val stream = target.startWrite()
            try {
                if (!scaled.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
                    target.failWrite(stream)
                    return false
                }
                target.finishWrite(stream)
            } catch (error: Throwable) {
                target.failWrite(stream)
                throw error
            }
            forget(slot)
            true
        } catch (_: Throwable) {
            false
        }
    }

    fun clear(context: Context, slot: String) {
        if (!AvatarPolicy.valid(slot)) return
        try {
            file(context, slot).delete()
        } catch (_: Throwable) {
            // A missing file already means "no avatar".
        }
        forget(slot)
    }

    /** Overlay drawables must be round; callers keep ownership of [bitmap]. */
    fun circular(context: Context, bitmap: Bitmap): Drawable =
        RoundedBitmapDrawableFactory.create(context.resources, bitmap).apply { isCircular = true }

    @Synchronized
    private fun forget(slot: String) {
        cache.remove(slot)
    }

    private fun decode(context: Context, uri: Uri): Bitmap? = if (Build.VERSION.SDK_INT >= 28) {
        // ImageDecoder applies the camera's orientation tag for us.
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            val sample = AvatarPolicy.sampleSize(info.size.width, info.size.height)
            if (sample > 1) decoder.setTargetSampleSize(sample)
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.isMutableRequired = false
        }
    } else {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val sample = AvatarPolicy.sampleSize(bounds.outWidth, bounds.outHeight)
        resolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        }
    }

    /** Center-crops to a square, then scales it down: uniform scaling only, never a stretched copy. */
    private fun square(source: Bitmap): Bitmap {
        val crop = AvatarPolicy.crop(source.width, source.height)
        if (crop.size <= 0) return source
        val squared = if (source.width == crop.size && source.height == crop.size) source
        else Bitmap.createBitmap(source, crop.left, crop.top, crop.size, crop.size)
        val edge = AvatarPolicy.square(crop.size, crop.size)
        if (edge <= 0 || edge >= crop.size) return squared
        return Bitmap.createScaledBitmap(squared, edge, edge, true)
    }
}
