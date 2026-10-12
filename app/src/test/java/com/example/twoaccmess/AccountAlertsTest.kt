package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountAlertsTest {
    @Test fun everySlotNamesItselfInTheTitle() {
        assertEquals("Account A has a message", AccountAlerts.title(AccountId.A, 1))
        assertEquals("Account B has a message", AccountAlerts.title(AccountId.B, 1))
        assertEquals("Account C has a message", AccountAlerts.title(AccountId.C, 1))
        assertEquals("Account D has a message", AccountAlerts.title(AccountId.D, 1))
        assertEquals("Account P has a message", AccountAlerts.title(AccountId.P, 1))
        AccountId.entries.forEach { id ->
            assertTrue(AccountAlerts.title(id, 2).startsWith("Account ${id.name} has messages in 2"))
            assertEquals("Account ${id.name}", AccountAlerts.title(id, 0))
        }
    }

    @Test fun summaryTextCarriesTheUserLabelAndNeverInventsContent() {
        assertEquals("Work phone · 1 observed chat", AccountAlerts.summaryText(AccountId.C, "Work phone", 1))
        assertEquals("Work phone · 3 observed chats", AccountAlerts.summaryText(AccountId.C, "Work phone", 3))
        assertTrue(AccountAlerts.summaryText(AccountId.D, "", 1).startsWith("Account D"))
        assertTrue(AccountAlerts.summaryText(AccountId.D, "", 0).contains("No observed messages"))
    }

    @Test fun everyCardHasItsOwnIdAndNeverTheLeftoverSummaryId() {
        val cards = AccountId.entries.map { HubNotifications.cardId(it) }
        assertEquals(AccountId.entries.size, cards.toSet().size)
        assertTrue(cards.none { it == AccountAlerts.SUMMARY_ID })
        assertTrue(cards.all { it > 0 })
        // One stable id per slot: re-posting an update replaces the same card instead of stacking.
        AccountId.entries.forEach { assertEquals(HubNotifications.cardId(it), HubNotifications.cardId(it)) }
        assertEquals(AccountId.entries.size, AccountId.entries.map { HubNotifications.tag(it) }.distinct().size)
        assertEquals(AccountId.entries.size, AccountId.entries.map { HubNotifications.channel(it) }.distinct().size)
    }

    @Test fun badgeOnlyAppearsWithObservedChats() {
        assertNull(AccountAlerts.badge(0))
        assertNull(AccountAlerts.badge(-3))
        assertEquals("1", AccountAlerts.badge(1))
        assertEquals("9", AccountAlerts.badge(9))
        assertEquals("99+", AccountAlerts.badge(120))
    }

    @Test fun eachSlotHasItsOwnAccentAndTestCard() {
        assertEquals(AccountId.entries.size, AccountId.entries.map { AccountAlerts.accent(it) }.distinct().size)
        AccountId.entries.forEach { id ->
            assertNotEquals(AccountAlerts.testCard(id), AccountAlerts.testCard(WebSessionPolicy.next(id)))
            assertTrue(AccountAlerts.testCard(id).contains("Account ${id.name} has a message"))
            assertTrue(AccountAlerts.testCard(id).contains("no message was read"))
        }
        // The test card names the slot's app and the exact rule that would produce a real card for it.
        assertTrue(AccountAlerts.testCard(AccountId.A, HubApps.INSTAGRAM).contains("Slot A opens Instagram"))
        assertTrue(AccountAlerts.testCard(AccountId.A, HubApps.INSTAGRAM).contains("exactly one slot"))
        // WhatsApp and Zalo do own a phone app, so their rule is the one-slot rule, not "cannot".
        assertTrue(AccountAlerts.testCard(AccountId.A, HubApps.WHATSAPP).contains("exactly one slot"))
        assertTrue(AccountAlerts.testCard(AccountId.A, HubApps.ZALO).contains("message-like notification"))
        // Facebook is the catalog's only web-only entry: no phone-app listener, so its notifications
        // raise nothing — but its own open web session can still badge the slot off its tab title.
        assertTrue(AccountAlerts.testCard(AccountId.A, HubApps.FACEBOOK).contains("raises no card from notifications"))
        assertTrue(AccountAlerts.testCard(AccountId.A, HubApps.FACEBOOK).contains("own tab title"))
        assertTrue(AccountAlerts.testCard(AccountId.A, HubApps.FACEBOOK).contains("${HubApps.observingCount()} catalog apps"))
        assertTrue(AccountAlerts.testCard(AccountId.B).contains("Messenger installation bound to this slot"))
    }
}
