package com.example.twoaccmess

/**
 * The floating bubble's unread badge, and the VIP highlight on top of it.
 *
 * The number is still the count of observed chats that are waiting: it is a count, not a message, and
 * nothing here invents content. What the VIP flag changes is the *colour*, which is the whole point of
 * the feature — a mailbox the user marked VIP turns the badge red with white digits, so "something
 * arrived in the account that matters" is readable at a glance instead of by reading a number first.
 * Every other account keeps the ordinary blue with black digits.
 *
 * Pure Kotlin with plain ARGB integers: the overlay service, the Compose cockpit and the JVM tests all
 * read the same values, so the phone and the desktop cannot drift into two different blues. The desktop
 * mirror is `desktop/src/main/vip-badge.js`.
 */
object VipBadge {
    /** Same two-character ceiling as [AccountAlerts.badge]; past it the badge reads "99+". */
    const val CAP = 99

    /** Ordinary badge: blue disc, black digits (4.79:1 against #1976D2). */
    const val NORMAL_BACKGROUND = 0xFF1976D2.toInt()
    const val NORMAL_TEXT = 0xFF000000.toInt()

    /** VIP badge: red disc, white digits (4.63:1 against #D32F2F). */
    const val VIP_BACKGROUND = 0xFFD32F2F.toInt()
    const val VIP_TEXT = 0xFFFFFFFF.toInt()

    enum class Tone { NORMAL, VIP }

    data class Style(val background: Int, val text: Int, val tone: Tone)

    /** Null means "draw no badge at all", which is what zero waiting chats has always meant here. */
    fun label(total: Int): String? = when {
        total <= 0 -> null
        total > CAP -> "$CAP+"
        else -> total.toString()
    }

    /**
     * One VIP chat is enough to turn the whole badge red: the badge has a single colour, and hiding a
     * VIP arrival behind an ordinary blue disc is the bug this feature exists to fix.
     */
    fun tone(vipWaiting: Int): Tone = if (vipWaiting > 0) Tone.VIP else Tone.NORMAL

    /**
     * The colours for a badge that shows [total] waiting chats, [vipWaiting] of which belong to VIP
     * spaces. A negative or impossible VIP count cannot turn the badge red on its own.
     */
    fun style(total: Int, vipWaiting: Int): Style {
        val honest = vipWaiting.coerceIn(0, total.coerceAtLeast(0))
        return when (tone(honest)) {
            Tone.VIP -> Style(VIP_BACKGROUND, VIP_TEXT, Tone.VIP)
            Tone.NORMAL -> Style(NORMAL_BACKGROUND, NORMAL_TEXT, Tone.NORMAL)
        }
    }

    /** Waiting chats across the spaces the user marked VIP. */
    fun vipWaiting(state: HubState): Int =
        state.slots.sumOf { id -> if (state.account(id).vip) state.pending(id) else 0 }

    /** Waiting chats across every space the bubble is listening to. */
    fun total(state: HubState): Int = state.slots.sumOf { state.pending(it) }

    /** The whole badge for a state, so the overlay and the tests ask one question. */
    fun of(state: HubState): Pair<String?, Style> = label(total(state)) to style(total(state), vipWaiting(state))
}
