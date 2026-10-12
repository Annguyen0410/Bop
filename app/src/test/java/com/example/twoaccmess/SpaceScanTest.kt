package com.example.twoaccmess

import org.junit.Assert.*
import org.junit.Test

/**
 * The 10-second round-robin scan, pinned on the rules that decide whether a card is allowed: a first
 * reading is a baseline, only a growing *unmuted* number is news, muted threads are subtracted before
 * anything is compared, and a space that cannot be read changes nothing. No Android, no timer and no
 * page here — the sweep is driven by hand, which is what makes a whole multi-space cycle a unit test.
 */
class SpaceScanTest {

    private class FakeReader(val answers: MutableMap<AccountId, SpaceScan.Reading?>) : SpaceScan.Reader {
        val asked = mutableListOf<AccountId>()
        override fun read(space: AccountId): SpaceScan.Reading? {
            asked += space
            return answers[space]
        }
    }

    private fun reader(vararg pairs: Pair<AccountId, SpaceScan.Reading?>) =
        FakeReader(pairs.toMap().toMutableMap())

    private fun reading(unread: Int, muted: Int? = null, at: Long = 0L) =
        SpaceScan.Reading(unread, muted, SpaceScan.Source.DOM, at)

    @Test fun theTickIsTenSecondsAndAFullSweepIsBoundedByTheSpaceCount() {
        assertEquals(10_000L, SpaceScan.TICK_MS)
        assertEquals(0L, SpaceScan.sweepMs(0))
        assertEquals(10_000L, SpaceScan.sweepMs(1))
        assertEquals(40_000L, SpaceScan.sweepMs(4))
        assertEquals("a nonsense count must not produce a negative window", 0L, SpaceScan.sweepMs(-3))
    }

    @Test fun theSweepVisitsEverySpaceInTurnAndWrapsAround() {
        val reader = reader(AccountId.A to reading(1), AccountId.B to reading(1), AccountId.C to reading(1))
        val sweep = SpaceScan.Sweep(reader)
        val slots = listOf(AccountId.A, AccountId.B, AccountId.C)
        assertEquals(listOf(AccountId.A, AccountId.B, AccountId.C, AccountId.A, AccountId.B),
            (1..5).map { sweep.step(slots)!!.space })
        assertEquals("each space is asked once per turn, nothing more", 5, reader.asked.size)
    }

    @Test fun removingASpaceMidSweepNeitherSkipsNorRepeatsAnother() {
        val reader = reader(AccountId.B to reading(1), AccountId.C to reading(1))
        val sweep = SpaceScan.Sweep(reader)
        val slots = listOf(AccountId.A, AccountId.B, AccountId.C)
        assertEquals(AccountId.A, sweep.step(slots)!!.space)
        assertEquals(AccountId.B, sweep.step(slots)!!.space)
        // A is switched off while the sweep is at B. An index-based cursor would land back on B here and
        // leave C unread for a whole turn; identity resumes at C.
        assertEquals(AccountId.C, sweep.step(listOf(AccountId.B, AccountId.C))!!.space)
    }

    @Test fun anEmptySlotListIsNotAStep() {
        val sweep = SpaceScan.Sweep(reader())
        assertNull("there is no space to read, so there is no step", sweep.step(emptyList()))
        assertTrue(SpaceScan.detail(null).contains("idle"))
        // Recovering after every slot was removed: with no remembered space the turn starts at the head
        // of the current list, so a slot list that comes back is swept from the beginning instead of
        // staying stuck on a space that no longer exists.
        assertEquals(AccountId.B, sweep.step(listOf(AccountId.B, AccountId.A))!!.space)
        assertEquals(AccountId.A, sweep.step(listOf(AccountId.B, AccountId.A))!!.space)
        assertNull(sweep.step(emptyList()))
        assertEquals("a fresh sweep starts at the head too",
            AccountId.B, SpaceScan.Sweep(reader(AccountId.B to reading(1))).step(listOf(AccountId.B, AccountId.A))!!.space)
    }

    @Test fun aFirstReadingIsABaselineAndOnlyAGrowingUnmutedCountIsNews() {
        val watch = SpaceScan.Watch()
        assertEquals(SpaceScan.Move.BASELINE, watch.accept(reading(5)).move)
        assertEquals(SpaceScan.Move.NONE, watch.accept(reading(5)).move)
        assertTrue("a growing count is the one thing that may raise a card", watch.accept(reading(6)).alert)
        assertEquals("the same count twice must not alert twice", SpaceScan.Move.NONE, watch.accept(reading(6)).move)
        assertEquals("reading one chat drops unread without claiming an arrival",
            SpaceScan.Move.UPDATED, watch.accept(reading(3)).move)
        assertEquals(SpaceScan.Move.RAISED, watch.accept(reading(4)).move)
        assertEquals(SpaceScan.Move.CLEARED, watch.accept(reading(0)).move)
        assertEquals("a space that stays caught up says nothing more", SpaceScan.Move.NONE, watch.accept(reading(0)).move)
        assertEquals(SpaceScan.Move.RAISED, watch.accept(reading(1)).move)
    }

    @Test fun mutedThreadsAreSubtractedBeforeAnythingIsClaimedAsNews() {
        val watch = SpaceScan.Watch()
        // 5 unread, none of them muted: the baseline.
        assertEquals(SpaceScan.Move.BASELINE, watch.accept(reading(5, muted = 0)).move)
        // A new message lands, but in a muted thread: unmuted stays at 5 and no card is allowed.
        val mutedArrival = watch.accept(reading(6, muted = 1))
        assertEquals(SpaceScan.Move.NONE, mutedArrival.move)
        assertFalse(mutedArrival.alert)
        assertEquals("the product still knows what the real total is", 5, mutedArrival.unmuted)
        // A second muted arrival: still quiet, and still not counted as news.
        assertEquals(SpaceScan.Move.NONE, watch.accept(reading(7, muted = 2)).move)
        // Now an unmuted message: 8 with 2 muted leaves 6, which is the first real increase.
        val real = watch.accept(reading(8, muted = 2))
        assertEquals(SpaceScan.Move.RAISED, real.move)
        assertTrue(real.alert)
        assertEquals(6, real.unmuted)
        // The user mutes one more thread, dropping unmuted back to 5: an update, not an arrival.
        assertEquals(SpaceScan.Move.UPDATED, watch.accept(reading(7, muted = 2)).move)
    }

    @Test fun mutingMoreThanTheSiteReportsCannotInventANegativeNumber() {
        val watch = SpaceScan.Watch()
        val odd = watch.accept(reading(2, muted = 9))
        assertEquals(0, odd.unmuted)
        assertEquals(SpaceScan.Move.BASELINE, odd.move)
        assertEquals("a muted reading of zero is a caught-up space, not an arrival",
            SpaceScan.Move.NONE, watch.accept(reading(0, muted = 9)).move)
    }

    @Test fun aSourceThatCannotSeeMuteStateSaysSoInsteadOfPretending() {
        val title = SpaceScan.Reading(unread = 3, muted = null, source = SpaceScan.Source.TITLE)
        assertFalse(title.mutedKnown)
        assertEquals("an unreadable mute state leaves the raw total, it does not filter it", 3, title.unmuted)
        val sweep = SpaceScan.Sweep(reader(AccountId.A to title))
        val step = sweep.step(listOf(AccountId.A))!!
        assertFalse(step.outcome!!.mutedKnown)
        assertTrue("the status line must admit the limitation", SpaceScan.detail(step).contains("mute state unknown"))
    }

    @Test fun aPageThatCannotBeReadIsNotAReadingAndChangesNothing() {
        val reader = reader(AccountId.A to reading(5))
        val sweep = SpaceScan.Sweep(reader)
        val slots = listOf(AccountId.A)
        assertEquals(SpaceScan.Move.BASELINE, sweep.step(slots)!!.move)
        reader.answers[AccountId.A] = null
        val unavailable = sweep.step(slots)!!
        assertNull(unavailable.reading)
        assertNull(unavailable.outcome)
        assertEquals(SpaceScan.Move.UNAVAILABLE, unavailable.move)
        assertTrue(SpaceScan.detail(unavailable).contains("cannot be read"))
        // The baseline survives: the same count is still NONE, and the next real increase is still news.
        reader.answers[AccountId.A] = reading(5)
        assertEquals(SpaceScan.Move.NONE, sweep.step(slots)!!.move)
        reader.answers[AccountId.A] = reading(6)
        assertEquals(SpaceScan.Move.RAISED, sweep.step(slots)!!.move)
    }

    @Test fun anAdapterThatThrowsIsRecordedByClassNameAndDoesNotStopTheSweep() {
        val reader = object : SpaceScan.Reader {
            override fun read(space: AccountId): SpaceScan.Reading? {
                if (space == AccountId.A) throw IllegalStateException("page said something with a URL in it")
                return SpaceScan.Reading(2, 0, SpaceScan.Source.DOM, 0)
            }
        }
        val sweep = SpaceScan.Sweep(reader)
        val slots = listOf(AccountId.A, AccountId.B)
        val failed = sweep.step(slots)!!
        assertEquals(AccountId.A, failed.space)
        assertEquals(SpaceScan.Move.UNAVAILABLE, failed.move)
        assertEquals("IllegalStateException", failed.failure)
        assertTrue(SpaceScan.detail(failed).contains("IllegalStateException"))
        assertFalse("no message content may reach the status file", SpaceScan.detail(failed).contains("URL"))
        // The next tick still reads the next space: one broken adapter is not a stopped scanner.
        val next = sweep.step(slots)!!
        assertEquals(AccountId.B, next.space)
        assertEquals(SpaceScan.Move.BASELINE, next.move)
    }

    @Test fun eachSpaceKeepsItsOwnBaselineInsideOneSweep() {
        val reader = reader(AccountId.A to reading(3, muted = 0), AccountId.B to reading(9, muted = 0))
        val sweep = SpaceScan.Sweep(reader)
        val slots = listOf(AccountId.A, AccountId.B)
        assertEquals(SpaceScan.Move.BASELINE, sweep.step(slots)!!.move)
        assertEquals(SpaceScan.Move.BASELINE, sweep.step(slots)!!.move)
        reader.answers[AccountId.A] = reading(4, muted = 0)
        assertEquals(SpaceScan.Move.RAISED, sweep.step(slots)!!.move)
        reader.answers[AccountId.B] = reading(9, muted = 0)
        assertEquals("B was untouched by A's arrival", SpaceScan.Move.NONE, sweep.step(slots)!!.move)
    }

    @Test fun forgettingASpaceMakesItsNextReadingABaselineAgain() {
        val reader = reader(AccountId.A to reading(2, muted = 0))
        val sweep = SpaceScan.Sweep(reader)
        val slots = listOf(AccountId.A)
        assertEquals(SpaceScan.Move.BASELINE, sweep.step(slots)!!.move)
        reader.answers[AccountId.A] = reading(3, muted = 0)
        assertEquals(SpaceScan.Move.RAISED, sweep.step(slots)!!.move)
        sweep.forget(AccountId.A)
        assertEquals("unread the freshly loaded page already had is not a new message",
            SpaceScan.Move.BASELINE, sweep.step(slots)!!.move)
    }

    @Test fun anAbsurdBadgeIsCappedExactlyLikeTheTitlePath() {
        // "1000 unread" is not a badge any of these services draws; the cap keeps it out of the state.
        val capped = SpaceScan.Sweep(reader(AccountId.A to reading(1000, muted = 0))).step(listOf(AccountId.A))!!
        assertEquals(WebUnread.MAX, capped.outcome!!.unmuted)
        assertEquals(SpaceScan.Move.BASELINE, capped.move)
    }

    @Test fun aCountThatCannotExistIsRejectedInsteadOfBeingClampedIntoACard() {
        listOf(
            { SpaceScan.Reading(unread = -1) },
            { SpaceScan.Reading(unread = 3, muted = -1) },
        ).forEach { build ->
            try {
                build()
                fail("a negative count must be rejected at construction")
            } catch (_: IllegalArgumentException) {
                // expected
            }
        }
    }

    @Test fun thePagePayloadIsExactlyTheOneTheInjectedReaderWrites() {
        // The literal is pinned on the JavaScript side too (desktop/test/unread-reader.test.js). Changing
        // one side alone fails a test on that side instead of silently reading nothing forever.
        val reading = SpaceScan.decode("unread=7\nmuted=2")!!
        assertEquals(7, reading.unread)
        assertEquals(2, reading.muted)
        assertEquals(SpaceScan.Source.DOM, reading.source)
        assertEquals("only the unmuted five may raise a card", 5, reading.unmuted)
        assertEquals("unread=7\nmuted=2", SpaceScan.encode(reading))
        assertEquals(SpaceScan.encode(reading), SpaceScan.encode(SpaceScan.decode(SpaceScan.encode(reading))!!))
    }

    @Test fun aPayloadThatLosesItsMuteFieldIsARefusalNotAnAssumption() {
        listOf(
            null,
            "",
            "unread=7",
            "muted=2",
            "unread=-1\nmuted=0",
            "unread=7\nmuted=-2",
            "just some page text",
            "=7\nmuted=2",
        ).forEach { payload ->
            assertNull("$payload", SpaceScan.decode(payload))
        }
    }

    @Test fun aDecodedPageReadingDrivesTheSweepWithMuteFiltering() {
        // The page starts with 5 unread, one of them in a thread the user muted: 4 unmuted.
        var payload: String? = "unread=5\nmuted=1"
        val sweep = SpaceScan.Sweep(object : SpaceScan.Reader {
            override fun read(space: AccountId) = SpaceScan.decode(payload)
        })
        val slots = listOf(AccountId.A)
        val baseline = sweep.step(slots)!!
        assertEquals(SpaceScan.Move.BASELINE, baseline.move)
        assertEquals(4, baseline.outcome!!.unmuted)
        // A message arrives in the muted thread: the total grows, the unmuted number does not.
        payload = "unread=6\nmuted=2"
        val mutedArrival = sweep.step(slots)!!
        assertEquals("a message in a muted thread must not raise a card", SpaceScan.Move.NONE, mutedArrival.move)
        assertEquals(4, mutedArrival.outcome!!.unmuted)
        payload = "unread=7\nmuted=2"
        assertEquals(SpaceScan.Move.RAISED, sweep.step(slots)!!.move)
        payload = ""
        assertEquals("a page that stops answering changes nothing", SpaceScan.Move.UNAVAILABLE, sweep.step(slots)!!.move)
    }

    @Test fun theStatusLineStaysOneShortLineInTheKeyValueFile() {
        val lines = listOf(
            SpaceScan.detail(null),
            SpaceScan.detail(SpaceScan.Step(AccountId.A, null, null, "IllegalStateException")),
            SpaceScan.detail(SpaceScan.Step(AccountId.A, null, null, null)),
            SpaceScan.detail(SpaceScan.Step(AccountId.A, reading(4, muted = 0),
                SpaceScan.Outcome(SpaceScan.Move.RAISED, 4, true, 0), null)),
            SpaceScan.detail(SpaceScan.Step(AccountId.A, reading(4, muted = 0),
                SpaceScan.Outcome(SpaceScan.Move.RAISED, 4, false, 0), null)),
        )
        lines.forEach { line ->
            assertTrue(line, line.length <= SpaceScan.DETAIL_LIMIT)
            assertFalse(line, line.contains('\n'))
            assertFalse("the file is parsed as key=value", line.contains('='))
        }
        assertTrue(lines[3].contains("4 unmuted unread"))
        assertTrue(lines[3].contains("not message IDs"))
    }
}
