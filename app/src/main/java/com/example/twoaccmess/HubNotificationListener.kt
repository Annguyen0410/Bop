package com.example.twoaccmess

import android.app.Notification
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.UserHandle
import android.os.UserManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

data class LaunchCapability(val intent: PendingIntent, val user: UserHandle, val serial: Long, val generation: Long, val packageName: String)

class HubNotificationListener : NotificationListenerService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val events = Channel<Event>(256)
    private var bound = false
    private var receiverRegistered = false
    private var privacySuspended = false
    private var privacyEpoch = 0L
    private val sourceVersions = mutableMapOf<String, Long>()
    private var nextVersion = 0L
    private sealed interface Event {
        data class Posted(val notification: StatusBarNotification, val version: Long) : Event
        data class Removed(val sourceKey: String) : Event
        data class Snapshot(val notifications: List<Pair<StatusBarNotification, Long>>) : Event
    }

    private val privacyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            privacyEpoch++
            if (intent.action == Intent.ACTION_SCREEN_OFF) privacySuspended = true
            if (intent.action == Intent.ACTION_USER_PRESENT ||
                (intent.action == Intent.ACTION_SCREEN_ON && !HubRepository.isLocked(context))) privacySuspended = false
            invalidateAll()
            HubRepository.clearPreviews()
            HubNotifications.clear(context)
            if (!privacySuspended) reconcile()
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_MANAGED_PROFILE_UNAVAILABLE)
            addAction(Intent.ACTION_MANAGED_PROFILE_AVAILABLE)
            addAction(Intent.ACTION_MANAGED_PROFILE_REMOVED)
        }
        ContextCompat.registerReceiver(this, privacyReceiver, filter, ContextCompat.RECEIVER_EXPORTED)
        receiverRegistered = true
        scope.launch {
            for (event in events) {
                when (event) {
                    is Event.Posted -> ingest(event.notification, event.version)
                    is Event.Removed -> {
                        capabilities.keys.removeAll { it.sourceKey == event.sourceKey }
                        HubRepository.remove(event.sourceKey)
                    }
                    is Event.Snapshot -> {
                        invalidateAll()
                        // Re-reading active sources must not resurrect a card the user already dismissed.
                        // Keep existing acknowledgement while upsert verifies unchanged content/generation.
                        HubRepository.retainSources(event.notifications.map { it.first.key }.toSet())
                        event.notifications.forEach { (notification, version) -> ingest(notification, version) }
                    }
                }
            }
        }
        scope.launch {
            HubRepository.state.map { listOf(it.accounts, it.slots, it.ready, it.disclosureAccepted, it.workPreviews) }
                .distinctUntilChanged().collect { if (bound) reconcile() }
        }
        scope.launch {
            HubRepository.state.map { Triple(it.alerts, it.connected, it.mirrorAlerts) }.distinctUntilChanged()
                .collect { HubNotifications.sync(this@HubNotificationListener, HubRepository.state.value) }
        }
    }

    override fun onListenerConnected() {
        bound = true
        HubRepository.connected()
        reconcile()
    }

    override fun onListenerDisconnected() {
        bound = false
        invalidateAll()
        HubRepository.disconnected()
        HubNotifications.clear(this)
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (HubApps.byPackage(sbn.packageName) != null) {
            // An updated source can replace its click action while parsing is in flight.
            capabilities.keys.removeAll { it.sourceKey == sbn.key }
            val version = trackVersion(sbn.key)
            enqueue(Event.Posted(sbn, version))
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        if (HubApps.byPackage(sbn.packageName) != null) {
            capabilities.keys.removeAll { it.sourceKey == sbn.key }
            trackVersion(sbn.key)
            enqueue(Event.Removed(sbn.key))
        }
    }

    private fun trackVersion(sourceKey: String): Long {
        val version = ++nextVersion
        sourceVersions.remove(sourceKey)
        sourceVersions[sourceKey] = version
        while (sourceVersions.size > 512) {
            // Evicted revisions fail closed if a queued parse later resumes.
            sourceVersions.remove(sourceVersions.keys.first())
        }
        return version
    }

    private fun enqueue(event: Event) {
        if (!events.trySend(event).isSuccess) {
            // Coverage is no longer trustworthy. Fail closed rather than silently lose routing state.
            bound = false
            invalidateAll()
            HubRepository.disconnected()
            HubNotifications.clear(this)
            requestUnbind()
        }
    }

    private fun reconcile() {
        if (!bound) return
        try {
            val notifications = activeNotifications?.filter { HubApps.byPackage(it.packageName) != null }.orEmpty()
            sourceVersions.clear()
            enqueue(Event.Snapshot(notifications.map { notification ->
                val version = trackVersion(notification.key)
                notification to version
            }))
        } catch (_: SecurityException) {
            bound = false
            invalidateAll()
            HubRepository.disconnected()
            HubNotifications.clear(this)
        }
    }

    private suspend fun ingest(sbn: StatusBarNotification, version: Long) {
        if (!bound || privacySuspended || sourceVersions[sbn.key] != version || !HubPlatform.notificationAccess(this)) return
        val app = HubApps.byPackage(sbn.packageName) ?: return
        val users = getSystemService(UserManager::class.java)
        val serial = users.getSerialNumberForUser(sbn.user)
        val account = HubReducer.resolve(HubRepository.state.value, sbn.packageName, serial) ?: return
        if (sbn.postTime < account.boundAt) return
        if (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        // Accuracy: only a notification that proves a conversation may claim a slot. See [AlertFilter].
        val messagingStyle = try {
            NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(sbn.notification) != null
        } catch (_: Throwable) {
            false
        }
        val conversationShortcut = Build.VERSION.SDK_INT >= 26 && sbn.notification.shortcutId != null
        if (!AlertFilter.messageLike(sbn.notification.category, messagingStyle, conversationShortcut)) return
        val profileReady = try { users.isUserUnlocked(sbn.user) && !users.isQuietModeEnabled(sbn.user) }
        catch (_: SecurityException) { false }
        if (!profileReady || HubRepository.isLocked(this)) return
        val personal = sbn.user == android.os.Process.myUserHandle()
        val workPreviews = HubRepository.state.value.workPreviews
        val epoch = privacyEpoch
        val previews = personal || workPreviews
        val parsed = withContext(Dispatchers.Default) { parse(sbn.notification, previews, app.label) }
        // Recheck after background parsing: permission, lock and binding could change meanwhile.
        if (!bound || privacySuspended || epoch != privacyEpoch || sourceVersions[sbn.key] != version || HubRepository.isLocked(this) || !HubPlatform.notificationAccess(this) ||
            HubRepository.state.value.workPreviews != workPreviews || HubRepository.state.value.account(account.accountId) != account) return
        val sourceConversation = if (Build.VERSION.SDK_INT >= 26) sbn.notification.shortcutId else null
        val resolved = HubRepository.ingest(sbn.packageName, serial, sbn.key, sourceConversation,
            parsed.first, parsed.second, sbn.postTime) ?: return
        val token = sbn.notification.contentIntent
        val key = AlertKey(resolved.accountId, sbn.key)
        if (token != null && token.creatorPackage == sbn.packageName && token.creatorUserHandle == sbn.user) {
            capabilities[key] = LaunchCapability(token, sbn.user, serial, resolved.generation, sbn.packageName)
        } else capabilities.remove(key)
        // Bound route capabilities to the same retained keys as the preview store.
        capabilities.keys.retainAll(HubRepository.state.value.alerts.keys)
    }

    private fun parse(notification: Notification, previews: Boolean, appLabel: String): Pair<String, List<ObservedMessage>> {
        if (!previews) return "$appLabel · managed profile" to listOf(ObservedMessage(null, "New alert. Work previews are off.", null))
        return try {
            val extras = notification.extras
            val title = extras?.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()
                ?: extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: appLabel
            val messaging = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
            val messages = messaging?.messages?.takeLast(20)?.map { message ->
                ObservedMessage(message.person?.name?.toString(), message.text?.toString() ?: "Attachment or content unavailable", message.timestamp)
            }.orEmpty()
            val fallback = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()
                ?: extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: "New alert; message preview unavailable."
            title to messages.ifEmpty { listOf(ObservedMessage(null, fallback, null)) }
        } catch (_: android.os.BadParcelableException) {
            appLabel to listOf(ObservedMessage(null, "Notification content unavailable.", null))
        } catch (_: ClassCastException) {
            appLabel to listOf(ObservedMessage(null, "Notification content unavailable.", null))
        }
    }

    override fun onDestroy() {
        bound = false
        if (receiverRegistered) unregisterReceiver(privacyReceiver)
        scope.cancel()
        events.close()
        if (instance === this) instance = null
        invalidateAll()
        HubRepository.disconnected()
        HubNotifications.clear(this)
        super.onDestroy()
    }

    companion object {
        private val capabilities = ConcurrentHashMap<AlertKey, LaunchCapability>()
        private var instance: HubNotificationListener? = null
        fun route(key: AlertKey): LaunchCapability? = capabilities[key]
        fun invalidateAccount(id: AccountId) { capabilities.keys.removeAll { it.accountId == id } }
        fun invalidateAll() { capabilities.clear() }
        fun refresh() { instance?.reconcile() }
    }
}
