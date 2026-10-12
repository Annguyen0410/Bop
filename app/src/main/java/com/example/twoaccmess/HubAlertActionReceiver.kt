package com.example.twoaccmess

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Turns a dismissed hub card into a local acknowledgement, so a swiped card cannot come back for the
 * same message. It never touches Messenger: original notifications and messages stay as they are.
 */
class HubAlertActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != HubNotifications.ACTION_DISMISS) return
        val slot = intent.getStringExtra(HubNotifications.EXTRA_SLOT)
            ?.let(AccountId::from) ?: return
        // An empty list means "this was not a real alert card"; it must not acknowledge anything.
        val sources = intent.getStringArrayListExtra(HubNotifications.EXTRA_SOURCES).orEmpty()
        if (sources.isEmpty()) return
        HubRepository.acknowledge(slot, sources)
    }
}
