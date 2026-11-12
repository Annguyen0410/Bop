package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Account isolation across the two sources the phone can observe: the system notification listener and an
 * open web session's own title.
 *
 * The defect this locks down is a cross-source one. Android drops the notification listener regularly (an
 * update, access revoked and regranted, a memory reclaim). Each reconnect used to clear the whole alert map,
 * which threw away the web-session alert — a source that needs no notification access at all — and forgot
 * every dismissal, so cards the user had already swiped away came back.
 */
class HubReducerTest {
    private fun bound(): HubState {
        var state = HubState(ready = true, disclosureAccepted = true, connected = true,
            enabledSlots = listOf(AccountId.A, AccountId.B), accounts = AccountId.entries.map { AccountBinding(it) })
        state = HubReducer.bind(state, AccountId.A, 0L, "Work", 1_000L)
        state = HubReducer.bind(state, AccountId.B, 1L, "Home", 1_000L)
        return HubReducer.connect(state)
    }

    private fun native(key: String, id: AccountId, thread: String, at: Long, text: String = "hi") =
        ObservedAlert(AlertKey(id, key), ConversationKey(id, thread), 1L, "Ada",
            listOf(ObservedMessage("Ada", text, null)), at)

    @Test fun a_listener_blip_does_not_reopen_a_dismissed_card() {
        val alert = native("0|com.facebook.orca|1|null|100", AccountId.A, "thread-1", 2_000L)
        var state = HubReducer.upsert(bound(), alert)
        state = HubReducer.acknowledge(state, alert.conversation)
        assertTrue("the card starts dismissed", state.alerts.getValue(alert.key).acknowledged)

        val reconnected = HubReducer.connect(HubReducer.disconnect(state))
        assertEquals("the observed alert survives the blip", 1, reconnected.alerts.size)
        val ingestedAgain = HubReducer.upsert(reconnected, alert)
        assertTrue("the same content must stay dismissed after a reconnect",
            ingestedAgain.alerts.getValue(alert.key).acknowledged)
        assertTrue("a dismissed chat is not pending again",
            ingestedAgain.flatten().none { !it.acknowledged })
    }

    private fun HubState.flatten() = alerts.values

    @Test fun a_listener_blip_keeps_the_open_web_session_alert() {
        var state = HubReducer.webReading(bound(), AccountId.A, 3, incoming = true, at = 5_000L)
        val webKey = AlertKey(AccountId.A, WebUnread.sourceKey(AccountId.A))
        assertTrue(state.alerts.containsKey(webKey))

        val reconnected = HubReducer.connect(HubReducer.disconnect(state))
        assertTrue("a web alert does not depend on notification access",
            reconnected.alerts.containsKey(webKey))
        assertEquals(3, reconnected.alerts.getValue(webKey).webUnread)
    }

    @Test fun a_web_reading_only_ever_touches_its_own_slot() {
        var state = HubReducer.webReading(bound(), AccountId.A, 2, incoming = true, at = 5_000L)
        state = HubReducer.webReading(state, AccountId.B, 7, incoming = true, at = 6_000L)
        val a = state.alerts.getValue(AlertKey(AccountId.A, WebUnread.sourceKey(AccountId.A)))
        val b = state.alerts.getValue(AlertKey(AccountId.B, WebUnread.sourceKey(AccountId.B)))
        assertEquals(2, a.webUnread)
        assertEquals(7, b.webUnread)
        assertTrue(a.conversation != b.conversation)
        // Catching up in one account must not silence the other.
        val caughtUp = HubReducer.webReading(state, AccountId.A, 0, incoming = false, at = 7_000L)
        assertFalse(caughtUp.alerts.containsKey(AlertKey(AccountId.A, WebUnread.sourceKey(AccountId.A))))
        assertEquals(7, caughtUp.alerts.getValue(AlertKey(AccountId.B, WebUnread.sourceKey(AccountId.B))).webUnread)
    }

    @Test fun a_silent_reconciliation_keeps_the_dismissal_but_a_new_message_reopens_the_card() {
        var state = HubReducer.webReading(bound(), AccountId.A, 2, incoming = true, at = 5_000L)
        val key = AlertKey(AccountId.A, WebUnread.sourceKey(AccountId.A))
        state = HubReducer.acknowledge(state, state.alerts.getValue(key).conversation)
        assertTrue(state.alerts.getValue(key).acknowledged)

        // Same count reported again (a page re-render): still dismissed.
        state = HubReducer.webReading(state, AccountId.A, 2, incoming = false, at = 6_000L)
        assertTrue("an unchanged count must not reopen a dismissed card", state.alerts.getValue(key).acknowledged)

        // A real increase is a new event and does reopen it.
        state = HubReducer.webReading(state, AccountId.A, 4, incoming = true, at = 7_000L)
        assertFalse("a new arrival is not suppressed by the previous dismissal", state.alerts.getValue(key).acknowledged)
    }

    @Test fun two_slots_of_one_app_are_never_guessed() {
        val state = HubReducer.selectApp(bound(), AccountId.A, HubApps.MESSENGER_ID)
            .let { HubReducer.selectApp(it, AccountId.B, HubApps.MESSENGER_ID) }
        // Messenger is claimed by profile serial, which is unique per slot, so two Messenger slots are
        // still told apart by the profile each notification came from.
        assertEquals(AccountId.A, HubReducer.resolve(state, MESSENGER_PACKAGE, 0L)?.accountId)
        assertEquals(AccountId.B, HubReducer.resolve(state, MESSENGER_PACKAGE, 1L)?.accountId)
        // An app with no Android profile binding cannot tell two identical slots apart, so neither is
        // claimed rather than one being guessed.
        val other = HubApps.observing().firstOrNull { it.id != HubApps.MESSENGER_ID } ?: return
        val packageName = other.packages.first()
        val ambiguous = HubReducer.selectApp(state, AccountId.A, other.id)
            .let { HubReducer.selectApp(it, AccountId.B, other.id) }
        assertNull(HubReducer.resolve(ambiguous, packageName, 0L))
    }

    @Test fun one_slot_of_an_app_beside_an_unrelated_app_still_resolves() {
        val other = HubApps.observing().firstOrNull { it.id != HubApps.MESSENGER_ID } ?: return
        val state = HubReducer.selectApp(bound(), AccountId.B, other.id)
        assertEquals(AccountId.B, HubReducer.resolve(state, other.packages.first(), 0L)?.accountId)
        assertEquals(AccountId.A, HubReducer.resolve(state, MESSENGER_PACKAGE, 0L)?.accountId)
    }
}
