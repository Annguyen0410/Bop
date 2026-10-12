package com.example.twoaccmess

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Phone makers do not all re-bind a notification listener after a restart or an app update, which is
 * exactly the "Bop silently stopped alerting" symptom. Asking the system to rebind is cheap and safe:
 * it does nothing when the listener is already bound, starts no service and keeps no process alive.
 */
class HubBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON",
            -> try {
                HubPlatform.requestListenerRebind(context.applicationContext)
            } catch (_: Throwable) {
                // A platform that refuses the rebind must not turn into a crash at boot.
            }
        }
    }
}
