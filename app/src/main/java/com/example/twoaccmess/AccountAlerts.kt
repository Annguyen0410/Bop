package com.example.twoaccmess

/**
 * Wording and stable ids for the per-account "which account was messaged" alerts and for the bubble
 * badge. Pure text so it can be unit-tested without Android. No message content is created here.
 *
 * Detection source: this phone's own app notifications that [HubNotificationListener] is allowed to
 * read ([HubApps.observing]), plus the unread marker of a space that is open right now ([WebUnread]).
 * A closed web session still has no background delivery, so it raises nothing on its own.
 */
object AccountAlerts {
    /** Leftover group-summary id from 1.2/1.3. Still cancelled so an upgrade removes old cards. */
    const val SUMMARY_ID = 1

    fun title(id: AccountId, chats: Int): String = when {
        chats <= 0 -> "Account ${id.name}"
        chats == 1 -> "Account ${id.name} has a message"
        else -> "Account ${id.name} has messages in $chats chats"
    }

    fun summaryText(id: AccountId, label: String, chats: Int): String = when {
        chats <= 0 -> "No observed messages for account ${id.name}"
        chats == 1 -> "${label.ifBlank { "Account ${id.name}" }} · 1 observed chat"
        else -> "${label.ifBlank { "Account ${id.name}" }} · $chats observed chats"
    }

    fun badge(total: Int): String? = when {
        total <= 0 -> null
        total > 99 -> "99+"
        else -> total.toString()
    }

    /**
     * The test card names the slot's app and the rule that would produce a real card for it, so the
     * user never expects alerts a web-only app cannot raise.
     */
    fun testCard(id: AccountId, app: HubApp = HubApps.DEFAULT): String {
        val rule = when {
            app.id == HubApps.MESSENGER_ID ->
                "A real \"Account ${id.name} has a message\" card needs the Messenger installation bound to this slot."
            app.observed ->
                "A real \"Account ${id.name} has a message\" card appears when this phone's ${app.label} posts a message-like notification and exactly one slot is set to ${app.label}."
            else -> "${app.label} has no phone-app listener in this build, so it raises no card from notifications. While a ${app.label} space is open, only its own tab title is read, and a new message in that open tab can still badge this slot. Only the ${HubApps.observingCount()} catalog apps that own a phone app raise cards from notifications."
        }
        return "Test card · no message was read. Slot ${id.name} opens ${app.label}. $rule"
    }

    /**
     * One accent per slot, shared by the overlay (android.graphics) and the Compose cockpit. The
     * palette holds one colour per slot in the pool, so two slots of the same hub never look alike.
     */
    private val ACCENTS = intArrayOf(
        0xFF5375FF.toInt(), 0xFFAF67E9.toInt(), 0xFF17A398.toInt(), 0xFFE08A16.toInt(),
        0xFFE1306C.toInt(), 0xFF2AA6E9.toInt(), 0xFF3FA651.toInt(), 0xFFD64545.toInt(),
        0xFF7C6AF0.toInt(), 0xFF0F9BD7.toInt(), 0xFFB58B00.toInt(), 0xFF8E5BD9.toInt(),
        0xFF2F855A.toInt(), 0xFFC2410C.toInt(), 0xFF116E8C.toInt(), 0xFF9D174D.toInt(),
    )

    fun accent(id: AccountId): Int = ACCENTS[id.ordinal % ACCENTS.size]
}
