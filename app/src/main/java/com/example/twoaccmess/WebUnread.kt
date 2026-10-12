package com.example.twoaccmess

/**
 * Native WebChromeClient.onReceivedTitle source. No script, timer, DOM scan or network request.
 * A count is an aggregate signal, NOT a message id: unchanged/dot/capped badges cannot identify
 * subsequent messages or their conversation. Delivery requires the website and WebView to stay alive.
 */
object WebUnread {
    const val MAX = 99
    fun sourceKey(id: AccountId) = "web:${id.name}"
    const val CONVERSATION = "web-session"
    fun isSource(sourceKey: String) = sourceKey.startsWith("web:")

    fun count(title: String?): Int {
        val text = title?.trim()?.take(300).orEmpty()
        if (text.isEmpty()) return 0
        BRACKETED.find(text)?.let { return it.groupValues[1].toInt().takeIf { value -> value in 1..MAX } ?: 0 }
        LEADING.find(text)?.let { return it.groupValues[1].toInt().takeIf { value -> value in 1..MAX } ?: 0 }
        return if (text.startsWith("•") || text.startsWith("●") || text.startsWith("*")) 1 else 0
    }

    private val BRACKETED = Regex("\\(([0-9]{1,3})\\)")
    private val LEADING = Regex("^([0-9]{1,3})(?:\\s|[·•|:-])")
    enum class Move { NONE, BASELINE, RAISED, UPDATED, CLEARED }

    class Watch {
        private var baseline = -1
        @Synchronized fun forget() { baseline = -1 }
        @Synchronized fun read(count: Int): Move {
            val previous = baseline
            val next = count.coerceIn(0, MAX)
            baseline = next
            return when {
                previous < 0 -> Move.BASELINE
                next > previous -> Move.RAISED
                next == 0 && previous > 0 -> Move.CLEARED
                next != previous -> Move.UPDATED
                else -> Move.NONE
            }
        }
    }

    fun detail(running: Boolean, move: Move = Move.NONE, unread: Int = 0): String = when {
        !running -> "native title events best-effort only (off screen; Android may suspend/kill session)"
        move == Move.RAISED -> "unread increase seen in web title · $unread unread (not message IDs)"
        move == Move.CLEARED -> "caught up in web title"
        else -> "native title events armed (website delivery/authentication unknown)"
    }
    fun cardTitle(id: AccountId) = AccountAlerts.title(id, 1)
    fun cardText(app: HubApp, unread: Int) =
        "${app.label} web session · $unread unread reported by tab title (not message IDs)"
}
