package com.example.twoaccmess

/**
 * The 10-second round-robin unread scan, kept free of Android types so every rule is unit-tested on the
 * JVM (the same split as [HubReducer], [WebSessionReport] and [HubReliability]).
 *
 * Why a scan at all. [WebUnread] reacts to whatever a page happens to announce. A page that is not the
 * focused tab, or one that finished loading before anyone looked, may announce nothing for a long time,
 * so "no event arrived" and "nothing is unread" look identical. This asks each space in turn instead.
 *
 * Why round-robin and not all spaces at once. Reading a space costs that page its own work. Reading six
 * sessions on one tick pays for six at once, on a phone with two cores; one space per tick keeps each
 * tick as cheap as a single page. The price is freshness, and it is worth stating exactly: the tick is
 * [TICK_MS], and a full sweep over N spaces takes N ticks, so each space is re-read inside
 * [sweepMs] — not every 10 seconds. Ten seconds is a *tick*, not a per-space interval, and no Android
 * background schedule is guaranteed at that rate while the screen is off (Doze suspends CPU and network).
 *
 * What one reading can say. A tab title or a DOM badge is an aggregate count, so a reading can raise a
 * per-space unread number and nothing else: it cannot name a conversation, a sender or a message. Muted
 * threads are the one thing a count cannot express on its own, which is why [Reading.muted] exists. An
 * adapter that can see the site's mute state reports it, and the count is reduced before any card is
 * considered. A source that cannot see it leaves [Reading.muted] null rather than reporting a total as
 * if it were already filtered.
 */
object SpaceScan {
    /** How often the sweep is asked for its next space. Driven by the caller, never by a timer in here. */
    const val TICK_MS = 10_000L

    /** Ceiling for the diagnostics line, matching [WebUnread.detail]. */
    const val DETAIL_LIMIT = 400

    /** Where a reading came from. [TITLE] is the native title the app already receives for a space. */
    enum class Source { TITLE, DOM }

    /**
     * What one accepted reading does to a space's baseline. Only [RAISED] may raise a card; [UNAVAILABLE]
     * is not a reading at all and never changes anything.
     */
    enum class Move { NONE, BASELINE, RAISED, CLEARED, UPDATED, UNAVAILABLE }

    /**
     * One space's answer for one tick. [unread] is the site's own total. [muted] is how many of those
     * belong to threads the user muted, or null when this source cannot tell — a tab title cannot, and
     * claiming otherwise is how a muted chat ends up as a card.
     */
    data class Reading(
        val unread: Int,
        val muted: Int? = null,
        val source: Source = Source.TITLE,
        val at: Long = 0L,
    ) {
        init {
            require(unread >= 0) { "unread cannot be negative" }
            require(muted == null || muted >= 0) { "muted cannot be negative" }
        }

        val mutedKnown: Boolean get() = muted != null

        /** The only number a card may be built from: what is left after the threads the user muted. */
        val unmuted: Int get() = (unread - (muted ?: 0)).coerceAtLeast(0)
    }

    /** What one accepted reading did, and the number it left behind. */
    data class Outcome(val move: Move, val unmuted: Int, val mutedKnown: Boolean, val at: Long) {
        val alert: Boolean get() = move == Move.RAISED
    }

    /**
     * One space's memory of its last reading. The rules mirror [WebUnread.Watch] on purpose — a first
     * reading is a baseline, only a growing number is news, zero clears, everything else is quiet — and
     * they are applied to [Reading.unmuted], which is what a card may claim.
     *
     * The consequence of filtering before the comparison is deliberate and worth naming: changing the
     * mute state of a thread changes the unmuted number, so unmuting a thread that already had unread can
     * raise one card. That card is honest — the thread is unread now and the user asked to see it — and
     * the alternative, alerting on the raw total, is the behaviour this filtering exists to remove.
     */
    class Watch {
        private var baseline = -1

        /** The page this baseline described is gone (reload, sign-in, app switch): next reading is a baseline. */
        @Synchronized fun forget() { baseline = -1 }

        @Synchronized fun accept(reading: Reading): Outcome {
            val next = reading.unmuted.coerceAtMost(WebUnread.MAX)
            val previous = baseline
            baseline = next
            val move = when {
                previous < 0 -> Move.BASELINE
                next > previous -> Move.RAISED
                next == 0 && previous > 0 -> Move.CLEARED
                next != previous -> Move.UPDATED
                else -> Move.NONE
            }
            return Outcome(move, next, reading.mutedKnown, reading.at)
        }
    }

    /**
     * Round-robin over the slots the user actually has. It remembers the last space *by identity*, not by
     * index, because an index resumes wrongly the moment a slot is removed: with [A, B, C] stopping at B
     * and A removed, an index would land back on B and skip C for a whole turn. A removed space that
     * appears again is picked up again without any bookkeeping.
     */
    class Cursor {
        private var last: AccountId? = null

        @Synchronized fun next(slots: List<AccountId>): AccountId? {
            if (slots.isEmpty()) {
                last = null
                return null
            }
            val from = slots.indexOfFirst { it == last }
            val next = if (from < 0) slots.first() else slots[(from + 1) % slots.size]
            last = next
            return next
        }

        @Synchronized fun forget() { last = null }
    }

    /**
     * Reads one space once. An adapter is per site ([HubApps]) because unread and mute state live in each
     * site's own markup, and there is no adapter that reads all of them.
     *
     * The contract has two halves that matter more than the reading itself:
     * [read] returns null instead of guessing when it cannot see the page (signed out, session suspended,
     * no adapter for that site), and a thrown failure is caught by the sweep, recorded by class name and
     * treated as unavailable, so one broken adapter cannot stop every other space from being checked.
     */
    interface Reader {
        fun read(space: AccountId): Reading?
    }

    /** One tick's result. [reading] and [outcome] are null when the space could not be read. */
    data class Step(val space: AccountId, val reading: Reading?, val outcome: Outcome?, val failure: String?) {
        val move: Move get() = outcome?.move ?: Move.UNAVAILABLE
    }

    /**
     * The scanner: one space per [step], in turn, each with its own baseline. It owns no timer — the
     * caller drives it every [TICK_MS] — which is exactly what makes a whole sweep a fast unit test
     * instead of a wait, and what keeps the scan in the process that owns the state.
     */
    class Sweep(private val reader: Reader) {
        private val cursor = Cursor()
        private val watches = HashMap<AccountId, Watch>()

        /** Reads the next space. Returns null only when there is no space to read at all. */
        @Synchronized fun step(slots: List<AccountId>, at: Long = 0L): Step? {
            val space = cursor.next(slots) ?: return null
            val watch = watches.getOrPut(space) { Watch() }
            val reading = try {
                reader.read(space)
            } catch (failure: Exception) {
                // Class name only: a message can carry page text, and this line reaches a status file.
                return Step(space, null, null, failure.javaClass.simpleName)
            }
            if (reading == null) return Step(space, null, null, null)
            return Step(space, reading, watch.accept(reading), null)
        }

        /** Drops one space's baseline without disturbing the others; used when its page is replaced. */
        @Synchronized fun forget(space: AccountId) { watches[space]?.forget() }
    }

    /** How long a full sweep takes over [spaceCount] spaces: the honest freshness figure for the scan. */
    fun sweepMs(spaceCount: Int): Long = TICK_MS * spaceCount.coerceAtLeast(0)

    /**
     * The wire shape a page's own reader writes back (assets/unread-reader.js), in the same key=value
     * form [WebSessionReport] already uses. Both sides are pinned against the same literal by a test on
     * each side, because a silent mismatch here would look exactly like "no unread anywhere".
     */
    fun encode(reading: Reading): String {
        val muted = requireNotNull(reading.muted) { "a DOM reading always knows its muted count" }
        return "unread=${reading.unread}\nmuted=$muted"
    }

    /**
     * Parses one reading posted by a page's reader. Returns null — a refusal — when anything is missing
     * or impossible: no mute field at all is *not* the same as "nothing was muted", and treating it as
     * zero is how a muted chat becomes a card.
     */
    fun decode(text: String?, source: Source = Source.DOM, at: Long = 0L): Reading? {
        val fields = text?.lineSequence()?.mapNotNull { line ->
            val cut = line.indexOf('=')
            if (cut <= 0) null else line.substring(0, cut).trim() to line.substring(cut + 1).trim()
        }?.toMap().orEmpty()
        val unread = fields["unread"]?.toIntOrNull() ?: return null
        val muted = fields["muted"]?.toIntOrNull() ?: return null
        if (unread < 0 || muted < 0) return null
        return Reading(unread, muted, source, at)
    }

    /**
     * One short line for the session status file, in the shape [WebUnread.detail] established: a single
     * line, no '=' (the file is parsed as key=value) and never any page content.
     */
    fun detail(step: Step?): String {
        val line = when {
            step == null -> "scan idle · no space in use"
            step.failure != null -> "scan ${step.space.name} failed · ${step.failure}"
            step.outcome == null -> "scan ${step.space.name} · page cannot be read this tick"
            step.move == Move.RAISED -> "scan ${step.space.name} · ${step.outcome.unmuted} unmuted unread (not message IDs)"
            step.move == Move.CLEARED -> "scan ${step.space.name} · caught up"
            else -> "scan ${step.space.name} · ${step.outcome.unmuted} unmuted unread"
        }
        val suffix = if (step?.outcome != null && !step.outcome.mutedKnown) " · mute state unknown" else ""
        return (line + suffix).take(DETAIL_LIMIT)
    }
}
