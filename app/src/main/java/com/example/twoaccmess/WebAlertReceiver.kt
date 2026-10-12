package com.example.twoaccmess

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.concurrent.Executors

/**
 * Carries one reading of an *open* web session's unread marker into the hub process.
 *
 * Every web slot runs in its own process, so the page cannot touch [HubRepository] directly: the
 * session sends this broadcast, the receiver runs where the hub state lives, and the slot's own
 * binding is read there. The payload is a slot and a small number — no page content, and nothing is
 * kept after the alert is built.
 *
 * The hub process may be starting from cold when the first message arrives, and this alert is exactly
 * what the user is waiting for, so a bounded wait for the stored settings beats dropping it.
 */
class WebAlertReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val slot = intent.getStringExtra(EXTRA_SLOT)?.let(AccountId::from) ?: return
        val unread = intent.getIntExtra(EXTRA_UNREAD, 0).coerceIn(0, WebUnread.MAX)
        val incoming = intent.getBooleanExtra(EXTRA_INCOMING, false)
        val hub = context.applicationContext
        val pending = goAsync()
        // One worker, in order. Threads per broadcast could apply a later "caught up" reading before the
        // "new message" reading that preceded it and lose the card; a queue cannot reorder them.
        WORKER.execute {
            try {
                val deadline = System.currentTimeMillis() + READY_TIMEOUT_MS
                while (!HubRepository.state.value.ready && System.currentTimeMillis() < deadline) Thread.sleep(25)
                if (!HubRepository.ingestWeb(slot, unread, incoming)) {
                    CrashLog.write(hub, "web unread settings not ready", IllegalStateException("settings restore timed out"))
                    return@execute
                }
                // The listener service also mirrors the state, but it only runs with notification
                // access; a user who never granted it must still get the card for their own open page.
                HubNotifications.sync(hub, HubRepository.state.value)
            } catch (failure: Exception) {
                CrashLog.write(hub, "web unread delivery", failure)
            } finally {
                try {
                    pending.finish()
                } catch (_: Throwable) {
                    // The system already reclaimed the receiver.
                }
            }
        }
    }

    companion object {
        const val ACTION = "com.example.twoaccmess.WEB_UNREAD"
        const val EXTRA_SLOT = "slot"
        const val EXTRA_UNREAD = "unread"
        const val EXTRA_INCOMING = "incoming"

        /** Well inside the receiver's own budget, and long enough for a cold settings restore. */
        private const val READY_TIMEOUT_MS = 4000L

        /** Daemon so a finished alert never keeps the hub process alive for its own sake. */
        private val WORKER = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "bop-web-alert").apply { isDaemon = true }
        }
    }
}
