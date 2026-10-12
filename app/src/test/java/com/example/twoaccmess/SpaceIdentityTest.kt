package com.example.twoaccmess

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class SpaceIdentityTest {
    @Test fun namesRemainStableBeyondPAndRoundTripWithoutCollisions() {
        assertEquals("Q", AccountId(16).name)
        assertEquals("Z", AccountId(25).name)
        assertEquals("AA", AccountId(26).name)
        assertEquals("BL", AccountId(63).name)
        val ids = (0 until 10000).map(::AccountId)
        assertEquals(ids.size, ids.map { it.name }.distinct().size)
        ids.forEach { assertEquals(it, AccountId.from(it.name)) }
        listOf("", "../A", "a", "A1", "ZZZZZZZ", "AAAAAAAA").forEach { assertNull(it, AccountId.from(it)) }
    }
    @Test fun twoHundredSpacesHaveSeparateStorageAndNotificationIdentities() {
        var state = HubState()
        repeat(198) { state = HubReducer.enableSlot(state, HubReducer.nextFree(state)!!) }
        assertEquals(200, state.slots.size)
        assertEquals(200, state.slots.map { WebSessionPolicy.dataSuffix(it) }.distinct().size)
        assertEquals(200, state.slots.map { HubNotifications.tag(it) }.distinct().size)
        assertEquals(200, state.slots.map { HubNotifications.channel(it) }.distinct().size)
        assertEquals(200, state.slots.map { AvatarPolicy.slot(it) }.distinct().size)
        assertEquals(200, state.slots.map { WebSessionReport.file(it) }.distinct().size)
    }
    @Test fun renamingNeverDropsLoginBindingOrNotificationGeneration() {
        val original = HubReducer.bind(HubState(), AccountId.A, 0, "Old")
        val renamed = HubReducer.rename(original, AccountId.A, "  Friends  ")
        assertEquals("Friends", renamed.account(AccountId.A).label)
        assertEquals(original.account(AccountId.A).generation, renamed.account(AccountId.A).generation)
        assertEquals(0L, renamed.account(AccountId.A).profileSerial)
    }
    @Test fun removedAndRecreatedSpacesRejectOldAlerts() {
        val id = AccountId(16)
        val active = HubReducer.enableSlot(HubState(connected = true), id)
        val alert = ObservedAlert(AlertKey(id, "old"), ConversationKey(id, "chat"), 0, "Hi", emptyList(), 1)
        assertEquals(1, HubReducer.upsert(active, alert).pending(id))
        val removed = HubReducer.disableSlot(active, id)
        assertEquals(removed, HubReducer.upsert(removed, alert))
        val recreated = HubReducer.enableSlot(removed, id)
        assertEquals(recreated, HubReducer.upsert(recreated, alert))
        assertTrue(recreated.account(id).generation > alert.generation)
    }
    @Test fun notificationRefreshPreservesAcknowledgementAndDropsVanishedSources() {
        val id = AccountId.A
        val original = ObservedAlert(AlertKey(id, "active"), ConversationKey(id, "thread"), 0, "Hi", emptyList(), 1)
        val active = HubReducer.upsert(HubState(connected = true), original)
        val dismissed = HubReducer.acknowledge(active, original.conversation)
        val refreshed = HubReducer.upsert(HubReducer.retainSources(dismissed, setOf("active")), original)
        assertEquals(0, refreshed.pending(id))
        assertTrue(refreshed.alerts[original.key]!!.acknowledged)
        assertTrue(HubReducer.retainSources(refreshed, emptySet()).alerts.isEmpty())
    }

    @Test fun dynamicBrowserIsPrivateAndLegacyProcessesStayDeclared() {
        val file = listOf(File("src/main/AndroidManifest.xml"), File("app/src/main/AndroidManifest.xml")).first { it.isFile }
        val xml = file.readText()
        val element = Regex("<activity\\s+android:name=\".DynamicWebActivity\"[\\s\\S]*?/>").find(xml)!!.value
        assertTrue(element.contains("android:exported=\"false\""))
        assertFalse(element.contains("android:process="))
        assertFalse(AccountId(16).legacy)
        assertTrue(AccountId.P.legacy)
    }
}
