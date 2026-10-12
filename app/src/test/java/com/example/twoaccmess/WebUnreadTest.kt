package com.example.twoaccmess

import org.junit.Assert.*
import org.junit.Test

/**
 * The realtime web-session source, pinned with the shapes the live services actually use. Everything
 * here is pure text and counters, which is the point: what crosses the process boundary is a slot and
 * a small number, never anything a page contains.
 */
class WebUnreadTest {

    @Test fun readsTheUnreadMarkerTheseServicesDrawInTheirOwnTitle() {
        assertEquals(3, WebUnread.count("(3) Messenger"))
        assertEquals(1, WebUnread.count("(1) WhatsApp | WhatsApp"))
        assertEquals(12, WebUnread.count("Messenger (12)"))
        assertEquals(2, WebUnread.count("2 · Telegram"))
        assertEquals(5, WebUnread.count("5 unread · Messenger"))
        assertEquals(7, WebUnread.count("  7  TikTok  "))
        assertEquals(1, WebUnread.count("• Discord"))
        assertEquals(1, WebUnread.count("● Zalo"))
    }

    @Test fun aTitleWithoutAMarkerIsNeverACount() {
        listOf(null, "", "   ", "Messenger", "WhatsApp Web", "TikTok - Make Your Day",
            "Chats", "(no number)", "Messenger (web)", "Settings", "1,234 members").forEach {
            assertEquals("$it", 0, WebUnread.count(it))
        }
    }

    @Test fun aNumberTooLargeToBeABadgeIsNotACount() {
        // "365 days" is a count of nothing, and these services cap their own badge far below it.
        assertEquals(0, WebUnread.count("365 days of Messenger"))
        assertEquals(0, WebUnread.count("(1000) Messenger"))
        assertEquals(0, WebUnread.count("1200 unread · Fandom"))
        assertEquals(WebUnread.MAX, WebUnread.count("(99) Messenger"))
    }

    @Test fun aPageThatLoadsWithUnreadAlreadyDoesNotClaimAMessageJustArrived() {
        val watch = WebUnread.Watch()
        assertEquals(WebUnread.Move.BASELINE, watch.read(5))
        assertEquals(WebUnread.Move.NONE, watch.read(5))
    }

    @Test fun onlyAGrowingMarkerRaisesAndOnlyZeroClears() {
        val watch = WebUnread.Watch()
        watch.read(2)
        assertEquals(WebUnread.Move.RAISED, watch.read(3))
        assertEquals("the same count twice must not alert twice", WebUnread.Move.NONE, watch.read(3))
        assertEquals("reading one chat updates unread without claiming a new arrival", WebUnread.Move.UPDATED, watch.read(1))
        assertEquals(WebUnread.Move.RAISED, watch.read(4))
        assertEquals(WebUnread.Move.CLEARED, watch.read(0))
        assertEquals("a page that stays caught up says nothing more", WebUnread.Move.NONE, watch.read(0))
        assertEquals(WebUnread.Move.RAISED, watch.read(1))
    }

    @Test fun aNewPageStartsWithItsOwnBaseline() {
        val watch = WebUnread.Watch()
        watch.read(2)
        assertEquals(WebUnread.Move.RAISED, watch.read(4))
        watch.forget()
        assertEquals("unread the loaded page already had is not a new message", WebUnread.Move.BASELINE, watch.read(9))
        assertEquals(WebUnread.Move.RAISED, watch.read(10))
    }

    @Test fun aDotOnlyMarkerCountsOneReadingPerSessionAndIsHonestAboutIt() {
        // Some clients draw a marker with no number at all ("• Discord"). That is one unread state, not a
        // count, so the second message of an already-marked session cannot be told from the first here.
        // Recording it deliberately is the point: the card then stays quiet instead of claiming a new
        // message every time the page redraws the same dot.
        val watch = WebUnread.Watch()
        assertEquals(1, WebUnread.count("• Discord"))
        // Baseline: the page already showed its dot when it loaded.
        assertEquals(WebUnread.Move.BASELINE, watch.read(WebUnread.count("• Discord")))
        // The same dot again is the limitation, pinned here on purpose: a second message of a session that
        // is still marked produces no second card. The alternative would be claiming a message on every
        // redraw, which is worse than staying quiet.
        assertEquals(WebUnread.Move.NONE, watch.read(WebUnread.count("• Discord")))
        // Caught up, then marked again: that is news the hub can stand behind.
        assertEquals(WebUnread.Move.CLEARED, watch.read(WebUnread.count("Discord")))
        assertEquals(WebUnread.Move.RAISED, watch.read(WebUnread.count("• Discord")))
    }

    @Test fun aBlankTitleClearsAMarkerThatWentAway() {
        val watch = WebUnread.Watch()
        watch.read(3)
        assertEquals(WebUnread.Move.CLEARED, watch.read(WebUnread.count("Messenger")))
    }

    @Test fun threeAccountsHaveIndependentNativeTitleState() {
        val a = WebUnread.Watch(); val b = WebUnread.Watch(); val c = WebUnread.Watch()
        listOf(a, b, c).forEach { assertEquals(WebUnread.Move.BASELINE, it.read(2)) }
        assertEquals(WebUnread.Move.RAISED, b.read(3))
        assertEquals(WebUnread.Move.RAISED, c.read(4))
        assertEquals(WebUnread.Move.NONE, a.read(2))
        b.forget()
        assertEquals(WebUnread.Move.BASELINE, b.read(10))
        assertEquals(WebUnread.Move.RAISED, c.read(5))
    }

    @Test fun aSurvivingSessionReconcilesOnceOnResume() {
        val watch = WebUnread.Watch()
        watch.read(1)
        assertEquals(WebUnread.Move.RAISED, watch.read(2))
        assertEquals(WebUnread.Move.NONE, watch.read(2))
    }

    @Test fun unreadBaselinesDecreasesAndDuplicateBroadcastsDoNotRealert() {
        var state = HubState()
        state = HubReducer.webReading(state, AccountId.A, 5, incoming = false, at = 1)
        assertEquals(0, state.pending(AccountId.A))
        state = HubReducer.webReading(state, AccountId.A, 6, incoming = true, at = 2)
        assertEquals(1, state.pending(AccountId.A))
        val alert = state.alerts.values.single()
        state = HubReducer.webReading(state, AccountId.A, 6, incoming = true, at = 3)
        assertEquals(alert, state.alerts.values.single())
        state = HubReducer.acknowledge(state, alert.conversation)
        state = HubReducer.webReading(state, AccountId.A, 3, incoming = false, at = 4)
        assertEquals(0, state.pending(AccountId.A))
        assertEquals(3, state.alerts.values.single().webUnread)
        assertEquals(2L, state.alerts.values.single().postedAt)
        state = HubReducer.webReading(state, AccountId.A, 4, incoming = true, at = 5)
        assertEquals(1, state.pending(AccountId.A))
        assertEquals(5L, state.alerts.values.single().postedAt)
        assertEquals(1, HubReducer.disconnect(state).alerts.size)
        assertTrue(HubReducer.webReading(state, AccountId.A, 0, incoming = false, at = 6).alerts.isEmpty())
    }

    @Test fun theDiagnosticsLineSaysWhatTheWatcherDidAndNothingMore() {
        assertTrue(WebUnread.detail(running = true).contains("native title events armed"))
        assertTrue(WebUnread.detail(running = false).contains("may suspend/kill"))
        val raised = WebUnread.detail(running = true, move = WebUnread.Move.RAISED, unread = 4)
        assertTrue(raised.contains("unread increase seen"))
        assertTrue(raised.contains("4 unread"))
        assertTrue(WebUnread.detail(running = true, move = WebUnread.Move.CLEARED).contains("caught up"))
        // It goes into a status file that is line-based, so it has to stay one short line, and it must
        // never be a place where a page's text could end up.
        listOf(WebUnread.detail(running = true), WebUnread.detail(running = false), raised).forEach {
            assertTrue(it.length <= 400)
            assertFalse(it.contains('\n'))
            assertFalse(it.contains('='))
        }
    }

    @Test fun theCardSaysWhatWasSeenAndHowLittleWasSeen() {
        assertEquals(WebUnread.cardTitle(AccountId.A), AccountAlerts.title(AccountId.A, 1))
        assertFalse(WebUnread.cardText(HubApps.TIKTOK, 3).contains(":"))
        assertTrue(WebUnread.cardText(HubApps.TIKTOK, 3).contains("TikTok"))
        assertTrue(WebUnread.cardText(HubApps.TIKTOK, 3).contains("3 unread"))
        assertTrue(WebUnread.cardText(HubApps.TIKTOK, 1).contains("1 unread"))
        assertEquals(WebUnread.sourceKey(AccountId.C), "web:C")
        assertTrue(WebUnread.isSource(WebUnread.sourceKey(AccountId.C)))
        assertFalse(WebUnread.isSource("com.facebook.orca|tag"))
    }

    @Test fun aWebAlertCountsWithoutNotificationAccessButOnlyForItsOwnSlot() {
        val connected = HubState(connected = true)
        val alert = ObservedAlert(
            key = AlertKey(AccountId.A, WebUnread.sourceKey(AccountId.A)),
            conversation = ConversationKey(AccountId.A, WebUnread.CONVERSATION),
            generation = 0, title = WebUnread.cardTitle(AccountId.A),
            messages = listOf(ObservedMessage(null, WebUnread.cardText(HubApps.MESSENGER, 2), null)),
            postedAt = 1_000L,
        )
        // No phone-notification access at all: the app's own open page must still raise its slot.
        val offline = HubState(connected = false)
        assertEquals(1, HubReducer.upsert(offline, alert, fromWebSession = true).alerts.size)
        assertEquals("a listener alert still needs the connection", 0, HubReducer.upsert(offline, alert).alerts.size)
        assertEquals(1, HubReducer.upsert(connected, alert).alerts.size)
        // A slot that is not in use keeps no alert, web or not.
        assertEquals(0, HubReducer.upsert(HubState(enabledSlots = listOf(AccountId.B)),
            alert.copy(key = AlertKey(AccountId.P, WebUnread.sourceKey(AccountId.P)),
                conversation = ConversationKey(AccountId.P, WebUnread.CONVERSATION))).alerts.size)
    }

    @Test fun theNotificationRefreshNeverWipesAnOpenSessionsAlert() {
        val web = ObservedAlert(
            key = AlertKey(AccountId.A, WebUnread.sourceKey(AccountId.A)),
            conversation = ConversationKey(AccountId.A, WebUnread.CONVERSATION),
            generation = 0, title = WebUnread.cardTitle(AccountId.A),
            messages = listOf(ObservedMessage(null, WebUnread.cardText(HubApps.TIKTOK, 1), null)), postedAt = 10L,
        )
        val phone = ObservedAlert(
            key = AlertKey(AccountId.B, "com.facebook.orca|tag"),
            conversation = ConversationKey(AccountId.B, "thread"), generation = 0,
            title = "Account B has a message", messages = listOf(ObservedMessage("Dana", "hi", null)), postedAt = 20L,
        )
        val both = HubState(connected = true, alerts = mapOf(web.key to web, phone.key to phone))
        // The listener reports which phone notifications are still live; the web alert is not one.
        val refreshed = HubReducer.retainSources(both, setOf(phone.key.sourceKey))
        assertEquals(2, refreshed.alerts.size)
        assertTrue(refreshed.alerts.containsKey(web.key))
        // A vanished phone notification still goes away.
        assertEquals(1, HubReducer.retainSources(both, emptySet()).alerts.size)
    }

    @Test fun aDismissedWebCardStillKnowsTheSameReading() {
        val alert = ObservedAlert(
            key = AlertKey(AccountId.A, WebUnread.sourceKey(AccountId.A)),
            conversation = ConversationKey(AccountId.A, WebUnread.CONVERSATION),
            generation = 0, title = WebUnread.cardTitle(AccountId.A),
            messages = listOf(ObservedMessage(null, WebUnread.cardText(HubApps.MESSENGER, 3), null)), postedAt = 5L,
        )
        val first = HubReducer.upsert(HubState(connected = true), alert, fromWebSession = true)
        val dismissed = HubReducer.acknowledge(first, alert.conversation)
        assertTrue(dismissed.pending(AccountId.A) < 1)
        assertEquals("the same reading must not reappear", 0, dismissed.pending(AccountId.A))
        // A genuinely new message (a new timestamp) is a new card again.
        val newer = HubReducer.upsert(dismissed, alert.copy(postedAt = 9L), fromWebSession = true)
        assertEquals(1, newer.pending(AccountId.A))
    }
}
