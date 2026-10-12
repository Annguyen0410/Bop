package com.example.twoaccmess

import android.app.Application
import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class HubApplication : Application() {
    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
        // Capture failures first, then prepare the per-account browser directory before providers,
        // CookieManager or any WebView can initialize Chromium. Neither call may ever throw: an
        // isolation problem has to become a readable message, not a "keeps stopping" dialog.
        CrashLog.install(this)
        try {
            WebSessionRuntime.prepare(this)
        } catch (failure: Throwable) {
            CrashLog.write(this, "browser session preparation", failure)
        }
    }

    override fun onCreate() {
        super.onCreate()
        // Browser processes must not restore or write the host's shared encrypted settings.
        if (Build.VERSION.SDK_INT < WebSessionPolicy.MIN_ANDROID || WebSessionRuntime.account == null) {
            HubRepository.initialize(this)
        }
    }
}

object HubRepository {
    private val mutable = MutableStateFlow(HubState())
    val state: StateFlow<HubState> = mutable
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val diskLock = Mutex()
    private lateinit var settings: EncryptedSettings
    private lateinit var appContext: Context

    fun initialize(context: Context) {
        appContext = context.applicationContext
        settings = EncryptedSettings(context)
        scope.launch {
            diskLock.withLock {
                val restored = try {
                    settings.read() ?: HubState()
                } catch (_: Exception) {
                    HubState(settingsError = true)
                }
                // A system-bound listener can connect before disk restore completes. The mirrored
                // theme preference wins over the restored value so both stay in step.
                val themed = restored.copy(themeChoice = HubThemeStore.read(context, restored.themeChoice))
                mutate { current -> themed.copy(ready = true, connected = current.connected, overlayRunning = current.overlayRunning) }
                try { SpaceSessions.writeIndex(appContext, state.value) }
                catch (_: Exception) { mutate { it.copy(settingsError = true) } }
            }
        }
    }

    @Synchronized
    private fun mutate(transform: (HubState) -> HubState) { mutable.value = transform(mutable.value) }

    private fun save() {
        scope.launch {
            diskLock.withLock {
                try {
                    settings.write(state.value)
                    SpaceSessions.writeIndex(appContext, state.value)
                    mutate { it.copy(settingsError = false) }
                } catch (_: Exception) {
                    mutate { it.copy(settingsError = true) }
                }
            }
        }
    }

    fun acceptDisclosure() {
        if (!state.value.ready) return
        mutate { it.copy(disclosureAccepted = true) }
        save()
    }

    fun bind(id: AccountId, serial: Long?, label: String): Boolean {
        if (!state.value.ready) return false
        return try {
            mutate { HubReducer.bind(it, id, serial, label, System.currentTimeMillis()) }
            HubNotificationListener.invalidateAccount(id)
            save()
            true
        } catch (_: IllegalArgumentException) {
            false
        }
    }

    fun addSlot(id: AccountId): Boolean {
        if (!state.value.ready) return false
        mutate { HubReducer.enableSlot(it, id) }
        save()
        return true
    }

    fun removeSlot(id: AccountId): Boolean {
        if (!state.value.ready || id == AccountId.A || id == AccountId.B || id !in state.value.slots) return false
        mutate { HubReducer.disableSlot(it, id) }
        HubNotificationListener.invalidateAccount(id)
        save()
        return true
    }

    fun rename(id: AccountId, label: String) {
        if (!state.value.ready) return
        mutate { HubReducer.rename(it, id, label) }
        save()
    }

    fun selectApp(id: AccountId, appId: String) {
        if (!state.value.ready) return
        mutate { HubReducer.selectApp(it, id, appId) }
        save()
    }

    fun setMirror(enabled: Boolean) { mutate { it.copy(mirrorAlerts = enabled) }; save() }

    /**
     * Appearance choice. The encrypted settings keep it for restores, and a plain preference file
     * mirrors it because the overlay service and the browser processes are separate processes that
     * must paint the right palette before any settings file has been unlocked.
     */
    fun setTheme(context: Context, choice: ThemeChoice) {
        mutate { it.copy(themeChoice = choice) }
        HubThemeStore.write(context, choice)
        save()
    }
    fun setWorkPreviews(enabled: Boolean) {
        mutate { it.copy(workPreviews = enabled, alerts = emptyMap()) }
        HubNotificationListener.invalidateAll()
        save()
    }
    fun connected() { mutate { it.copy(connected = true, alerts = emptyMap()) } }
    fun disconnected() { mutate { HubReducer.disconnect(it) } }
    fun clearPreviews() { mutate { it.copy(alerts = emptyMap()) }; HubNotificationListener.invalidateAll() }
    fun remove(sourceKey: String) { mutate { HubReducer.remove(it, sourceKey) } }
    fun retainSources(sources: Set<String>) { mutate { HubReducer.retainSources(it, sources) } }
    fun acknowledge(key: ConversationKey) { mutate { HubReducer.acknowledge(it, key) } }
    fun acknowledge(id: AccountId, sources: Collection<String>) { mutate { HubReducer.acknowledgeSources(it, id, sources) } }
    fun overlay(running: Boolean) { mutate { it.copy(overlayRunning = running) } }

    fun ingest(packageName: String, serial: Long, sourceKey: String, sourceConversation: String?,
               title: String, messages: List<ObservedMessage>, postedAt: Long): AccountBinding? {
        var resolved: AccountBinding? = null
        mutate { state ->
            val account = HubReducer.resolve(state, packageName, serial)
            resolved = account
            if (account == null) state else HubReducer.upsert(state, ObservedAlert(
                key = AlertKey(account.accountId, sourceKey),
                conversation = ConversationKey(account.accountId, sourceConversation ?: "notification:$sourceKey"),
                generation = account.generation,
                title = title.take(160).ifBlank { "${HubApps.byPackage(packageName)?.label ?: "Hub"} notification" },
                messages = messages.takeLast(20).map { it.copy(text = it.text.take(2000), sender = it.sender?.take(100)) },
                postedAt = postedAt,
            ))
        }
        return resolved
    }

    /**
     * One alert from this app's own *open* web session ([WebUnread]): the page reported that its own
     * unread marker grew. The receiver runs in the hub process, so the slot's binding — its app and its
     * generation — is read from [state] instead of being taken from the page, and only an unread count
     * crosses the process boundary. No message text exists here, so none can leak.
     */
    fun ingestWeb(id: AccountId, unread: Int, incoming: Boolean): Boolean {
        if (!state.value.ready) return false
        mutate { current -> HubReducer.webReading(current, id, unread, incoming, System.currentTimeMillis()) }
        return true
    }

    /** The reader caught up in the open page: that slot's web card has nothing left to say. */
    fun clearWeb(id: AccountId) { mutate { HubReducer.remove(it, WebUnread.sourceKey(id)) } }

    fun isLocked(context: Context) = context.getSystemService(KeyguardManager::class.java).isDeviceLocked
}

private class EncryptedSettings(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "hub-settings.enc"))
    private val alias = "twoaccmess.settings.v1"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    fun read(): HubState? {
        if (!file.baseFile.exists()) return null
        val data = file.readFully()
        require(data.size > 13 && data[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(1, 13)))
        cipher.updateAAD("TwoAccMess-settings-v1".toByteArray())
        val json = JSONObject(String(cipher.doFinal(data.copyOfRange(13, data.size)), Charsets.UTF_8))
        val accounts = json.getJSONArray("accounts")
        val stored = (0 until accounts.length()).mapNotNull { index ->
            val value = accounts.optJSONObject(index) ?: return@mapNotNull null
            value.optString("id").takeIf { it.isNotBlank() }?.let { it to value }
        }.toMap()
        // A slot that this file predates restores as "not bound" instead of discarding every binding.
        val ids = (AccountId.entries + stored.keys.mapNotNull(AccountId::from)).distinct().sorted()
        val bindings = ids.map { id ->
            val value = stored[id.name] ?: return@map AccountBinding(id)
            AccountBinding(id, value.optString("label").ifBlank { "Account ${id.name}" },
                if (value.isNull("serial")) null else value.optLong("serial", -1L).takeIf { it >= 0 },
                value.optLong("generation"), value.optLong("boundAt", 0L),
                // An unknown or missing id falls back to Messenger instead of hiding the slot.
                HubApps.orDefault(value.optString("app").takeIf { it.isNotBlank() }).id)
        }
        require(bindings.mapNotNull { it.profileSerial }.distinct().size == bindings.count { it.profileSerial != null })
        require(bindings.all { it.profileSerial == null || it.profileSerial >= 0 })
        // Files from 1.3 and earlier have no "slots": they start with the two base slots only.
        val slots = json.optJSONArray("slots")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                AccountId.from(array.optString(index))?.takeIf { id -> bindings.any { it.accountId == id } }
            }
        } ?: HubState.DEFAULT_SLOTS
        return HubState(accounts = bindings, disclosureAccepted = json.getBoolean("consent"),
            mirrorAlerts = json.optBoolean("mirror", true), workPreviews = json.optBoolean("workPreviews", false),
            enabledSlots = slots, themeChoice = ThemeChoice.from(json.optString("theme")))
    }

    fun write(state: HubState) {
        val json = JSONObject().put("consent", state.disclosureAccepted).put("mirror", state.mirrorAlerts)
            .put("workPreviews", state.workPreviews).put("theme", state.themeChoice.name)
            .put("slots", JSONArray().apply { state.slots.forEach { put(it.name) } })
            .put("accounts", JSONArray().apply {
                state.accounts.forEach { account -> put(JSONObject().put("id", account.accountId.name)
                    .put("label", account.label).put("serial", account.profileSerial ?: JSONObject.NULL)
                    .put("generation", account.generation).put("boundAt", account.boundAt)
                    .put("app", account.appId)) }
            })
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD("TwoAccMess-settings-v1".toByteArray())
        val payload = byteArrayOf(1) + cipher.iv + cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))
        val stream = file.startWrite()
        try { stream.write(payload); file.finishWrite(stream) }
        catch (error: Exception) { file.failWrite(stream); throw error }
    }
}
