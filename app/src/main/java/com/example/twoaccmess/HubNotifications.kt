package com.example.twoaccmess

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationChannelGroup
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.UserManager
import androidx.core.app.NotificationCompat
import java.util.concurrent.ConcurrentHashMap

/**
 * One plain, always swipeable card per slot, so the shade itself says which account was messaged.
 *
 * Design rules learned from 1.2/1.3: grouped children plus a silent group summary can be pinned or
 * hard to dismiss on several OEM skins, and re-posting an unchanged card made a dismissed alert come
 * back. This version therefore never uses groups, never posts a card twice with the same content, and
 * turns both a swipe and the "Dismiss" action into an acknowledgement inside the hub.
 */
object HubNotifications {
    const val CONTROL_CHANNEL = "hub_control"
    const val ACTION_DISMISS = "com.example.twoaccmess.DISMISS_HUB_ALERT"
    const val EXTRA_SLOT = "slot"
    const val EXTRA_SOURCES = "sources"
    private const val TEST_TIMEOUT_MS = 120_000L

    /** Kept from 1.3 so a user who muted an account keeps that choice; `legacyChannel` is 1.2's silent id. */
    fun channel(id: AccountId) = "alerts_v2_${id.name}"
    private fun legacyChannel(id: AccountId) = "alerts_${id.name}"
    fun tag(id: AccountId) = "hub-account-${id.name}"
    private fun testTag(id: AccountId) = "${tag(id)}-test"

    /** One stable card id per slot. Never a group summary id. */
    fun cardId(id: AccountId) = 100 + id.ordinal
    private fun testCardId(id: AccountId) = 200 + id.ordinal

    /**
     * Content last posted per slot: an unchanged state must never recreate a dismissed card.
     *
     * Concurrent by necessity, not by taste: [sync] now runs both from the listener service and from the
     * web-session receiver's own thread ([WebAlertReceiver]), so a plain `HashMap` here would be a data
     * race between two writers of the same map.
     */
    private val posted = ConcurrentHashMap<AccountId, String>()
    private val webArrival = ConcurrentHashMap<AccountId, Long>()

    fun createChannels(context: Context, slots: List<AccountId> = AccountId.entries) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CONTROL_CHANNEL, "Floating hub controls", NotificationManager.IMPORTANCE_LOW))
        (AccountId.entries + HubRepository.state.value.accounts.map { it.accountId } + slots).distinct().forEach { id ->
            if (id !in slots) {
                // A slot the user removed keeps no card and no leftover entry in Android settings.
                manager.deleteNotificationChannel(channel(id))
                manager.deleteNotificationChannel(legacyChannel(id))
                manager.deleteNotificationChannelGroup("account_${id.name}")
                posted.remove(id)
                return@forEach
            }
            manager.createNotificationChannelGroup(NotificationChannelGroup("account_${id.name}", "Account ${id.name}"))
            if (manager.getNotificationChannel(legacyChannel(id)) != null) manager.deleteNotificationChannel(legacyChannel(id))
            manager.createNotificationChannel(NotificationChannel(channel(id), "Account ${id.name} · new message", NotificationManager.IMPORTANCE_DEFAULT).apply {
                group = "account_${id.name}"
                description = "One card per account, titled \"Account ${id.name} has a message\". The source app's own alert is kept. Swipe the card away or tap Dismiss to silence it here."
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                enableVibration(false)
            })
        }
    }

    @Synchronized
    fun sync(context: Context, state: HubState) {
        createChannels(context, state.slots)
        val manager = context.getSystemService(NotificationManager::class.java)
        // A web-session alert comes from this app's own open page ([WebUnread]), so it needs no
        // notification access; it is still gated by the mirror switch, the lock state and the
        // permission to post. A listener alert keeps needing the connection.
        val webSlots = state.alerts.keys.filter { WebUnread.isSource(it.sourceKey) }.map { it.accountId }.toSet()
        val allowed = state.mirrorAlerts && !HubRepository.isLocked(context) && HubPlatform.canNotify(context) &&
            (state.connected || webSlots.isNotEmpty())
        state.accounts.forEach { account ->
            val source = state.connected || account.accountId in webSlots
            publish(context, manager, state, account.accountId, allowed && source && account.accountId in state.slots)
        }
    }

    private fun publish(context: Context, manager: NotificationManager, state: HubState, id: AccountId, allowed: Boolean) {
        val pending = if (allowed) state.conversations(id).filter { !it.acknowledged } else emptyList()
        if (pending.isEmpty()) {
            posted.remove(id)
            manager.cancel(tag(id), cardId(id))
            manager.cancel(tag(id), AccountAlerts.SUMMARY_ID) // leftover 1.2/1.3 group summary
            return
        }
        val account = state.account(id)
        // One atomic step: two threads syncing at once must not both decide this content is new.
        val content = signature(pending, account)
        if (posted.put(id, content) == content) return
        // A lower unread marker is a state update, not a new sound. Let Android channels/DND control
        // real arrivals; never use Ringtone playback that bypasses notification permission/mute.
        val web = pending.filter { WebUnread.isSource(it.key.sourceKey) }.maxOfOrNull { it.postedAt }
        val previousWeb = web?.let { webArrival.put(id, it) }
        val silentWebUpdate = web != null && web == previousWeb && pending.all { WebUnread.isSource(it.key.sourceKey) }
        val users = context.getSystemService(UserManager::class.java)
        // Never republish work message text or sender names. Lock/DLP behavior differs across devices.
        // A web-only slot has no profile, so its own app's notification is always personal.
        val personal = account.profileSerial == null ||
            account.profileSerial == users.getSerialNumberForUser(android.os.Process.myUserHandle())
        fun line(alert: ObservedAlert) = if (personal) "${alert.title}: ${alert.messages.lastOrNull()?.text ?: "Preview unavailable"}"
        else "Managed-profile ${account.app.label} alert · open hub"
        val newest = pending.maxByOrNull { it.postedAt }
        val style = NotificationCompat.InboxStyle().setSummaryText("${pending.size} observed chats · not a total unread count")
        pending.take(5).forEach { style.addLine(line(it)) }
        val sources = pending.map { it.key.sourceKey }
        post(context, manager, tag(id), cardId(id), NotificationCompat.Builder(context, channel(id))
            .setSmallIcon(R.drawable.ic_hub)
            .setSilent(silentWebUpdate)
            .setContentTitle(AccountAlerts.title(id, pending.size))
            .setContentText(if (pending.size == 1) line(pending.first()) else AccountAlerts.summaryText(id, account.label, pending.size))
            .setSubText("${account.app.label} · ${account.label}")
            .setStyle(style)
            .setContentIntent(contentIntent(context, state, id))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setWhen(newest?.postedAt ?: System.currentTimeMillis())
            .setAutoCancel(true)
            .setDeleteIntent(acknowledgeIntent(context, id, sources, id.ordinal))
            .addAction(0, "Dismiss", acknowledgeIntent(context, id, sources, id.ordinal + 100))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(generic(context, id)))
    }

    /**
     * Posts one card. A refused post must not be remembered as "already shown", otherwise the same
     * content would stay missing until the next message arrives.
     */
    private fun post(context: Context, manager: NotificationManager, tag: String, id: Int, builder: NotificationCompat.Builder) {
        try {
            manager.notify(tag, id, builder.build())
        } catch (failure: RuntimeException) {
            HubRepository.state.value.accounts.firstOrNull { id == cardId(it.accountId) || id == testCardId(it.accountId) }?.accountId?.let { account ->
                posted.remove(account)
                webArrival.remove(account)
            }
            CrashLog.write(context, "hub notification post", failure)
        }
    }

    /** Exact visible content of one card. The same message twice must not re-alert or reappear. */
    private fun signature(pending: List<ObservedAlert>, account: AccountBinding) = buildString {
        append(account.label).append('|').append(account.profileSerial).append('|')
        pending.sortedBy { it.key.sourceKey }.forEach { alert ->
            append(alert.key.sourceKey).append('~').append(alert.title).append('~').append(alert.postedAt).append('~')
            alert.messages.lastOrNull()?.let { append(it.sender).append(':').append(it.text) }
            append(';')
        }
    }

    private fun contentIntent(context: Context, state: HubState, id: AccountId) =
        PendingIntent.getActivity(context, id.ordinal, accountIntent(context, state, id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun accountIntent(context: Context, state: HubState, id: AccountId) = Intent(context, MainActivity::class.java).apply {
        action = "com.example.twoaccmess.ACCOUNT_${id.name}"
        data = Uri.parse("twoaccmess://account/${id.name}/${state.account(id).generation}")
        putExtra(MainActivity.ACCOUNT_EXTRA, id.name)
        putExtra(MainActivity.NATIVE_TOOLS_EXTRA, true)
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }

    /** Swiping the card and tapping Dismiss both acknowledge exactly the chats named in that card. */
    private fun acknowledgeIntent(context: Context, id: AccountId, sources: List<String>, request: Int) =
        PendingIntent.getBroadcast(context, request, Intent(context, HubAlertActionReceiver::class.java).apply {
            action = ACTION_DISMISS
            data = Uri.parse("twoaccmess://dismiss/${id.name}/$request")
            putExtra(EXTRA_SLOT, id.name)
            putStringArrayListExtra(EXTRA_SOURCES, ArrayList(sources))
        }, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun generic(context: Context, id: AccountId) = NotificationCompat.Builder(context, channel(id))
        .setSmallIcon(R.drawable.ic_hub).setContentTitle("Account ${id.name}")
        .setContentText("Message alert available").build()

    /** Only this app's own cards, including leftovers posted by an earlier process. */
    private fun active(manager: NotificationManager, tag: String) = try {
        manager.activeNotifications.filter { it.tag == tag }
    } catch (_: Throwable) {
        emptyList()
    }

    /**
     * A clearly labelled, self-expiring card per enabled slot. This is how the user verifies the
     * wording and the notification permission on a device; it never reads a message.
     */
    fun sendTest(context: Context, state: HubState): Boolean {
        createChannels(context, state.slots)
        if (!HubPlatform.canNotify(context)) return false
        val manager = context.getSystemService(NotificationManager::class.java)
        state.slots.forEach { id ->
            val app = state.account(id).app
            post(context, manager, testTag(id), testCardId(id), NotificationCompat.Builder(context, channel(id))
                .setSmallIcon(R.drawable.ic_hub)
                .setContentTitle(AccountAlerts.title(id, 1))
                .setContentText(AccountAlerts.testCard(id, app))
                .setStyle(NotificationCompat.BigTextStyle().bigText(AccountAlerts.testCard(id, app)))
                .setContentIntent(contentIntent(context, state, id))
                .setTimeoutAfter(TEST_TIMEOUT_MS)
                .setAutoCancel(true)
                .setDeleteIntent(acknowledgeIntent(context, id, emptyList(), id.ordinal + 200))
                .addAction(0, "Dismiss", acknowledgeIntent(context, id, emptyList(), id.ordinal + 300))
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(generic(context, id)))
        }
        return state.slots.isNotEmpty()
    }

    /** Clears every card this app posted, including leftover ids from 1.2/1.3. */
    fun clear(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        posted.clear()
        webArrival.clear()
        HubRepository.state.value.accounts.map { it.accountId }.forEach { id ->
            listOf(tag(id), testTag(id)).forEach { postedTag ->
                active(manager, postedTag).forEach { manager.cancel(it.tag, it.id) }
            }
            manager.cancel(tag(id), cardId(id))
            manager.cancel(tag(id), AccountAlerts.SUMMARY_ID)
        }
    }
}
