package com.example.twoaccmess

import org.junit.Assert.*
import org.junit.Test

class ExampleUnitTest {
    /** Every slot exists in the model, exactly like the app state; only A and B carry installations. */
    private fun connected(): HubState = HubState(ready = true, disclosureAccepted = true, connected = true,
        accounts = AccountId.entries.map { id -> when (id) {
            AccountId.A -> AccountBinding(id, "Alice", 0, 1)
            AccountId.B -> AccountBinding(id, "Bob", 10, 1)
            else -> AccountBinding(id)
        } })
    private fun alert(id: AccountId, source: String = "same-key", text: String = "hello", generation: Long = 1, time: Long = 1) =
        ObservedAlert(AlertKey(id, source), ConversationKey(id, "same-thread"), generation, "Alex",
            listOf(ObservedMessage("Alex", text, time)), time)

    @Test fun routesOnlyVettedPackagesAndExactlyOneBinding() {
        val state = connected()
        assertEquals(AccountId.A, HubReducer.resolve(state, MESSENGER_PACKAGE, 0)?.accountId)
        assertEquals(AccountId.B, HubReducer.resolve(state, MESSENGER_PACKAGE, 10)?.accountId)
        assertNull(HubReducer.resolve(state, "another.app", 0))
        assertNull(HubReducer.resolve(state, MESSENGER_PACKAGE, -1))
        assertNull(HubReducer.resolve(state, MESSENGER_PACKAGE, 99))
        assertNull(HubReducer.resolve(state.copy(disclosureAccepted = false), MESSENGER_PACKAGE, 0))
        assertNull(HubReducer.resolve(state.copy(ready = false), MESSENGER_PACKAGE, 0))
        assertNull(HubReducer.resolve(state.copy(accounts = state.accounts.map { it.copy(profileSerial = 0) }), MESSENGER_PACKAGE, 0))
    }

    @Test fun sameConversationAndMessageDoNotCollideAcrossAccounts() {
        val state = HubReducer.upsert(HubReducer.upsert(connected(), alert(AccountId.A)), alert(AccountId.B))
        assertEquals(2, state.alerts.size)
        assertEquals(1, state.pending(AccountId.A))
        assertEquals(1, state.pending(AccountId.B))
        assertNotEquals(state.conversations(AccountId.A).first().conversation, state.conversations(AccountId.B).first().conversation)
    }

    @Test fun notificationUpdatesAreSnapshotsNotUnreadMessageIncrements() {
        val first = HubReducer.upsert(connected(), alert(AccountId.A))
        val repeated = HubReducer.upsert(first, alert(AccountId.A))
        assertEquals(1, repeated.alerts.size)
        assertEquals(1, repeated.pending(AccountId.A))
        val multipleCards = HubReducer.upsert(repeated, alert(AccountId.A, "another-key"))
        assertEquals(1, multipleCards.pending(AccountId.A))
    }

    @Test fun localAcknowledgementIsAccountScopedAndNewContentAlertsAgain() {
        val both = HubReducer.upsert(HubReducer.upsert(connected(), alert(AccountId.A)), alert(AccountId.B))
        val acknowledged = HubReducer.acknowledge(both, ConversationKey(AccountId.A, "same-thread"))
        assertEquals(0, acknowledged.pending(AccountId.A))
        assertEquals(1, acknowledged.pending(AccountId.B))
        assertEquals(0, HubReducer.upsert(acknowledged, alert(AccountId.A)).pending(AccountId.A))
        assertEquals(1, HubReducer.upsert(acknowledged, alert(AccountId.A, text = "new", time = 2)).pending(AccountId.A))
    }

    @Test fun rebindInvalidatesAllOldAccountEventsEvenToTheSameProfile() {
        val both = HubReducer.upsert(HubReducer.upsert(connected(), alert(AccountId.A)), alert(AccountId.B))
        val rebound = HubReducer.bind(both, AccountId.A, 0, "New Alice")
        assertEquals(2, rebound.account(AccountId.A).generation)
        assertEquals(0, rebound.pending(AccountId.A))
        assertEquals(1, rebound.pending(AccountId.B))
        assertEquals(rebound, HubReducer.upsert(rebound, alert(AccountId.A)))
        assertEquals(1, HubReducer.upsert(rebound, alert(AccountId.A, generation = 2)).pending(AccountId.A))
    }

    @Test fun aNewerAcknowledgedCardDoesNotHideAnOlderPendingCardInTheSameConversation() {
        val older = alert(AccountId.A, "older", time = 1)
        val newer = alert(AccountId.A, "newer", time = 2)
        val both = HubReducer.upsert(HubReducer.upsert(connected(), older), newer)
        val mixed = both.copy(alerts = both.alerts + (newer.key to newer.copy(acknowledged = true)))
        assertEquals(1, mixed.pending(AccountId.A))
        assertFalse(mixed.conversations(AccountId.A).single().acknowledged)
    }

    @Test fun notificationsOlderThanTheAccountBindingCannotRepopulateIt() {
        val rebound = HubReducer.bind(connected(), AccountId.A, 0, "New login", boundAt = 500)
        assertEquals(rebound, HubReducer.upsert(rebound, alert(AccountId.A, generation = 2, time = 499)))
        assertEquals(1, HubReducer.upsert(rebound, alert(AccountId.A, generation = 2, time = 500)).pending(AccountId.A))
    }

    @Test fun bindingSameInstallationToBothSlotsFailsClosed() {
        assertThrows(IllegalArgumentException::class.java) { HubReducer.bind(connected(), AccountId.B, 0, "Wrong") }
        assertThrows(IllegalArgumentException::class.java) { HubReducer.bind(connected(), AccountId.B, -1, "Wrong") }
    }

    @Test fun onlyTwoSlotsAreVisibleUntilTheUserAddsOne() {
        val initial = HubState()
        assertEquals(listOf(AccountId.A, AccountId.B), initial.slots)
        assertEquals(listOf(AccountId.A, AccountId.B), HubState(enabledSlots = listOf(AccountId.B)).slots)
        assertEquals(listOf(AccountId.A, AccountId.B), HubState(enabledSlots = emptyList()).slots)
        val added = HubReducer.enableSlot(HubReducer.enableSlot(initial, AccountId.C), AccountId.D)
        assertEquals(listOf(AccountId.A, AccountId.B, AccountId.C, AccountId.D), added.slots)
        assertEquals(added, HubReducer.enableSlot(added, AccountId.C))
        // The two base slots stay: a user cannot end up with a hub that shows nothing.
        assertEquals(added, HubReducer.disableSlot(added, AccountId.A))
        assertEquals(added, HubReducer.disableSlot(added, AccountId.B))
    }

    @Test fun slotsContinueBeyondTheLegacyPoolAndRemovedSpacesCanBeReused() {
        assertEquals(AccountId.C, HubReducer.nextFree(HubState()))
        var state = HubState()
        AccountId.entries.forEach { id -> state = HubReducer.enableSlot(state, id) }
        assertEquals(AccountId.entries.toList(), state.slots)
        assertEquals(AccountId(16), HubReducer.nextFree(state))
        repeat(48) { state = HubReducer.enableSlot(state, HubReducer.nextFree(state)!!) }
        assertEquals(64, state.slots.size)
        assertEquals("BL", state.slots.last().name)
        assertEquals(64, state.accounts.size)
        assertEquals(64, state.slots.map { WebSessionPolicy.dataSuffix(it) }.distinct().size)
        // A removed slot returns its letter to the pool, in enum order, and keeps its app choice.
        val removed = HubReducer.disableSlot(HubReducer.selectApp(state, AccountId.G, "telegram"), AccountId.G)
        assertEquals(AccountId.G, HubReducer.nextFree(removed))
        assertFalse(removed.slots.contains(AccountId.G))
        assertEquals("telegram", removed.account(AccountId.G).appId)
        assertEquals("messenger", removed.account(AccountId.H).appId)
        assertEquals(state.slots.size - 1, removed.slots.size)
        // Removing never reorders: every remaining slot keeps its own letters and bindings.
        assertEquals(state.slots.filter { it != AccountId.G }, removed.slots)
    }

    @Test fun everySlotInThePoolHasItsOwnAccentAndOwnAlertIdentity() {
        val accents = AccountId.entries.map { AccountAlerts.accent(it) }
        assertEquals(AccountId.entries.size, accents.distinct().size)
        assertEquals(AccountId.entries.size, AccountId.entries.map { HubNotifications.cardId(it) }.distinct().size)
        assertEquals(AccountId.entries.size, AccountId.entries.map { HubNotifications.channel(it) }.distinct().size)
        assertEquals(AccountId.entries.size, AccountId.entries.map { AvatarPolicy.slot(it) }.distinct().size)
        assertEquals(AccountId.entries.size, AccountId.entries.map { WebSessionReport.file(it) }.distinct().size)
    }

    @Test fun removingAnAddedSlotClearsItsBindingAndAlertsOnly() {
        var state = HubReducer.enableSlot(connected(), AccountId.C)
        state = HubReducer.bind(state, AccountId.C, 20, "Work phone")
        assertEquals(20L, state.account(AccountId.C).profileSerial)
        val withAlert = HubReducer.upsert(state, alert(AccountId.B))
        val removed = HubReducer.disableSlot(withAlert, AccountId.C)
        assertFalse(removed.slots.contains(AccountId.C))
        assertNull(removed.account(AccountId.C).profileSerial)
        assertEquals("Account C", removed.account(AccountId.C).label)
        assertEquals(1, removed.pending(AccountId.B))
        // Its app choice survives, so re-adding the slot is predictable.
        val withApp = HubReducer.disableSlot(HubReducer.selectApp(removed, AccountId.C, "instagram"), AccountId.C)
        assertEquals("instagram", withApp.account(AccountId.C).appId)
        assertFalse(withApp.slots.contains(AccountId.C))
    }

    @Test fun appSelectionIsValidatedPerSlotAndDoesNotTouchNativeBindings() {
        val bound = HubReducer.bind(connected(), AccountId.A, 0, "Alice")
        val switched = HubReducer.selectApp(bound, AccountId.A, "tiktok")
        assertEquals("tiktok", switched.account(AccountId.A).appId)
        assertEquals("TikTok", switched.account(AccountId.A).app.label)
        assertEquals(0L, switched.account(AccountId.A).profileSerial)
        assertEquals(bound.account(AccountId.A).generation, switched.account(AccountId.A).generation)
        // An app that is not in the catalog changes nothing at all.
        assertEquals(switched, HubReducer.selectApp(switched, AccountId.A, "not-an-app"))
        assertEquals("messenger", switched.account(AccountId.B).appId)
        assertEquals("Instagram", HubReducer.selectApp(switched, AccountId.B, "instagram").account(AccountId.B).app.label)
    }

    @Test fun webSlotsAreClaimedByTheirAppChoiceAndAmbiguityFailsClosed() {
        // Messenger keeps its 1.4 rule: with no bound installation anywhere, a web login claims nothing.
        assertNull(HubReducer.resolve(HubState(ready = true, disclosureAccepted = true, connected = true), MESSENGER_PACKAGE, 0))
        // Instagram has no Android binding, so its single unbound slot claims it.
        val state = HubReducer.selectApp(HubReducer.enableSlot(connected(), AccountId.C), AccountId.C, "instagram")
        assertEquals(AccountId.C, HubReducer.resolve(state, "com.instagram.android", 0)?.accountId)
        assertEquals(AccountId.C, HubReducer.resolve(state, "com.instagram.android", 10)?.accountId)
        // A bound slot still counts for its chosen app: the binding is about Messenger, not the web app.
        assertEquals(AccountId.A, HubReducer.resolve(HubReducer.selectApp(connected(), AccountId.A, "instagram"), "com.instagram.android", 0)?.accountId)
        // One bound and one web slot on the same app are still two slots for that app, so neither is claimed.
        val boundAndWeb = HubReducer.selectApp(
            HubReducer.selectApp(HubReducer.enableSlot(connected(), AccountId.C), AccountId.A, "instagram"),
            AccountId.C, "instagram")
        assertNull(HubReducer.resolve(boundAndWeb, "com.instagram.android", 0))
        // Two slots of one app cannot be told apart, so neither gets the card.
        val twice = HubReducer.selectApp(HubReducer.enableSlot(state, AccountId.D), AccountId.D, "instagram")
        assertNull(HubReducer.resolve(twice, "com.instagram.android", 0))
        assertEquals(AccountId.C, HubReducer.resolve(HubReducer.disableSlot(twice, AccountId.D), "com.instagram.android", 0)?.accountId)
        // The package-to-app mapping drives the claim, and unknown packages never resolve.
        assertEquals(AccountId.C, HubReducer.resolve(HubReducer.selectApp(state, AccountId.C, "telegram"), "org.telegram.messenger", 0)?.accountId)
        assertNull(HubReducer.resolve(state, "com.example.evil", 0))
        assertNull(HubReducer.resolve(state.copy(connected = false), "com.instagram.android", 0))
        // Removing the slot it was claimed for also ends the claim.
        assertNull(HubReducer.resolve(HubReducer.disableSlot(state, AccountId.C), "com.instagram.android", 0))
    }

    @Test fun switchingASlotAppClearsOnlyThatSlotsAlerts() {
        var state = HubReducer.upsert(connected(), alert(AccountId.A))
        state = HubReducer.selectApp(HubReducer.enableSlot(state, AccountId.C), AccountId.C, "instagram")
        state = HubReducer.upsert(state, alert(AccountId.C, generation = 0))
        assertEquals(1, state.pending(AccountId.C))
        assertEquals(1, state.pending(AccountId.A))
        val switched = HubReducer.selectApp(state, AccountId.C, "telegram")
        assertEquals(0, switched.pending(AccountId.C))
        assertEquals(1, switched.pending(AccountId.A))
        assertEquals("telegram", switched.account(AccountId.C).appId)
        assertEquals(state, HubReducer.selectApp(state, AccountId.C, "instagram"))
    }

    @Test fun dismissingACardAcknowledgesExactlyTheChatsItNamed() {
        val state = HubReducer.upsert(HubReducer.upsert(connected(), alert(AccountId.A, "one")), alert(AccountId.A, "two"))
        // Both cards describe the same observed chat here, so the chat clears only when both are named.
        assertEquals(1, state.pending(AccountId.A))
        assertEquals(state, HubReducer.acknowledgeSources(state, AccountId.A, emptyList()))
        assertEquals(1, HubReducer.acknowledgeSources(state, AccountId.A, listOf("one")).pending(AccountId.A))
        assertEquals(0, HubReducer.acknowledgeSources(state, AccountId.A, listOf("one", "two")).pending(AccountId.A))
        assertEquals(1, HubReducer.acknowledgeSources(state, AccountId.A, listOf("test-A")).pending(AccountId.A))
        assertEquals(1, HubReducer.acknowledgeSources(state, AccountId.B, listOf("one")).pending(AccountId.A))
    }

    @Test fun everyPoolSlotResolvesIndependentlyAndAlertsIndependently() {
        val state = HubState(ready = true, disclosureAccepted = true, connected = true,
            accounts = AccountId.entries.mapIndexed { index, id -> AccountBinding(id, "Slot ${id.name}", index * 10L, 1) },
            enabledSlots = AccountId.entries.toList())
        assertEquals(AccountId.entries.size, state.accounts.size)
        // A slot the user removed is not resolvable, even if a stale binding ever existed for it.
        assertNull(HubReducer.resolve(state.copy(enabledSlots = listOf(AccountId.A, AccountId.B)), MESSENGER_PACKAGE, 20))
        AccountId.entries.forEach { id ->
            val serial = state.account(id).profileSerial
            assertNotNull(serial)
            assertEquals(id, HubReducer.resolve(state, MESSENGER_PACKAGE, serial!!)?.accountId)
        }
        assertNull(HubReducer.resolve(state, MESSENGER_PACKAGE, 99))
        assertThrows(IllegalArgumentException::class.java) { HubReducer.bind(state, AccountId.D, 0L, "Reuses A's profile") }
        var mixed = state
        AccountId.entries.forEach { id -> mixed = HubReducer.upsert(mixed, alert(id)) }
        assertEquals(AccountId.entries.size, mixed.alerts.size)
        AccountId.entries.forEach { id -> assertEquals(1, mixed.pending(id)) }
        val acknowledged = HubReducer.acknowledge(mixed, ConversationKey(AccountId.C, "same-thread"))
        assertEquals(0, acknowledged.pending(AccountId.C))
        assertEquals(1, acknowledged.pending(AccountId.D))
        assertEquals(1, acknowledged.pending(AccountId.P))
    }

    @Test fun mismatchedConversationAccountAndDisconnectedEventsAreRejected() {
        val invalid = alert(AccountId.A).copy(conversation = ConversationKey(AccountId.B, "wrong"))
        assertEquals(connected(), HubReducer.upsert(connected(), invalid))
        val disconnected = HubReducer.disconnect(HubReducer.upsert(connected(), alert(AccountId.A)))
        assertFalse(disconnected.connected)
        assertTrue(disconnected.alerts.isEmpty())
        assertEquals(disconnected, HubReducer.upsert(disconnected, alert(AccountId.A)))
    }

    @Test fun retentionIsBoundedPerAccountWithoutEvictingTheOtherAccount() {
        var state = HubReducer.upsert(connected(), alert(AccountId.B))
        repeat(120) { index -> state = HubReducer.upsert(state, alert(AccountId.A, "key-$index", time = index.toLong())) }
        assertEquals(100, state.alerts.keys.count { it.accountId == AccountId.A })
        assertEquals(1, state.alerts.keys.count { it.accountId == AccountId.B })
        assertFalse(state.alerts.containsKey(AlertKey(AccountId.A, "key-0")))
        assertTrue(state.alerts.containsKey(AlertKey(AccountId.A, "key-119")))
    }

    @Test fun interleavedArrivalsNeverMutateOtherAccountContext() {
        var state = connected()
        repeat(1000) { index ->
            val id = if (index % 2 == 0) AccountId.A else AccountId.B
            val other = if (id == AccountId.A) AccountId.B else AccountId.A
            val before = state.conversations(other)
            state = HubReducer.upsert(state, alert(id, "key-${index % 17}", "$index", time = index.toLong()))
            assertEquals(before, state.conversations(other))
            assertTrue(state.alerts.all { (key, value) -> key.accountId == value.conversation.accountId })
        }
    }
}
