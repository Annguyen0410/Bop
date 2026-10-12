package com.example.twoaccmess

/**
 * Accuracy rule for hub cards: which phone notifications may become "Account X has a message".
 *
 * A slot's card claims that a *conversation* was active on that account, so feed noise (likes,
 * job alerts, "your backup finished", promotions) must never produce one. Android gives three
 * independent signals, and the rule keeps every signal that proves a conversation while dropping
 * only what is provably not one:
 *
 *  1. a messaging payload ([NotificationCompat.MessagingStyle]) — the app itself said "this is a chat";
 *  2. a conversation shortcut (`Notification.getShortcutId`) — Android's per-chat identity;
 *  3. an explicit message category (msg/email/call/missed_call).
 *
 * A notification with none of them is accepted only when its category is unknown (many chat apps
 * never set one) and rejected for the categories Android reserves for non-message alerts. Pure text
 * handling so the rule is unit-tested, and its constants are the documented values of
 * `android.app.Notification.CATEGORY_*`; a device test cross-checks them against the platform.
 */
object AlertFilter {
    const val CATEGORY_MESSAGE = "msg"
    const val CATEGORY_EMAIL = "email"
    const val CATEGORY_CALL = "call"
    const val CATEGORY_MISSED_CALL = "missed_call"

    const val CATEGORY_PROMO = "promo"
    const val CATEGORY_SOCIAL = "social"
    const val CATEGORY_RECOMMENDATION = "recommendation"
    const val CATEGORY_STATUS = "status"
    const val CATEGORY_PROGRESS = "progress"
    const val CATEGORY_SERVICE = "service"
    const val CATEGORY_TRANSPORT = "transport"
    const val CATEGORY_SYSTEM = "sys"
    const val CATEGORY_ERROR = "err"
    const val CATEGORY_ALARM = "alarm"
    const val CATEGORY_EVENT = "event"
    const val CATEGORY_REMINDER = "reminder"
    const val CATEGORY_LOCATION = "location_sharing"
    const val CATEGORY_STOPWATCH = "stopwatch"
    const val CATEGORY_WORKOUT = "workout"
    const val CATEGORY_NAVIGATION = "navigation"

    /** Categories that always describe a conversation. */
    private val MESSAGES = setOf(CATEGORY_MESSAGE, CATEGORY_EMAIL, CATEGORY_CALL, CATEGORY_MISSED_CALL)

    /** Categories Android reserves for things that are not someone messaging you. */
    private val NOISE = setOf(
        CATEGORY_PROMO, CATEGORY_SOCIAL, CATEGORY_RECOMMENDATION, CATEGORY_STATUS, CATEGORY_PROGRESS,
        CATEGORY_SERVICE, CATEGORY_TRANSPORT, CATEGORY_SYSTEM, CATEGORY_ERROR, CATEGORY_ALARM,
        CATEGORY_EVENT, CATEGORY_REMINDER, CATEGORY_LOCATION, CATEGORY_STOPWATCH, CATEGORY_WORKOUT,
        CATEGORY_NAVIGATION,
    )

    fun messageLike(category: String?, hasMessagingStyle: Boolean, hasConversation: Boolean): Boolean = when {
        // Any positive proof of a conversation wins, whatever the category says.
        hasMessagingStyle || hasConversation -> true
        category.isNullOrEmpty() -> true
        category in MESSAGES -> true
        category in NOISE -> false
        // An unknown category is not proof of noise: keep the message rather than lose it.
        else -> true
    }
}
