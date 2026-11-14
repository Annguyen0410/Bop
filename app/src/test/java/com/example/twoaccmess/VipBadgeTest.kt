package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The VIP badge, case by case.
 *
 * The numbers here are the test plan's BADGE-01..28 and VIP-01..18: the count, the digits, the colour
 * decision and the persisted flag. Kept on the JVM so a regression in the badge is caught without a phone
 * in hand — the overlay is a plain Android view and cannot be asserted in a unit test at all.
 */
class VipBadgeTest {

    // ---- the two palettes the requirement names -------------------------------------------------

    @Test fun ordinaryBadgeIsBlueWithBlackDigits() {
        assertEquals(0xFF1976D2.toInt(), VipBadge.NORMAL_BACKGROUND)
        assertEquals(0xFF000000.toInt(), VipBadge.NORMAL_TEXT)
        val style = VipBadge.style(total = 3, vipWaiting = 0)
        assertEquals(VipBadge.Tone.NORMAL, style.tone)
        assertEquals(VipBadge.NORMAL_BACKGROUND, style.background)
        assertEquals(VipBadge.NORMAL_TEXT, style.text)
    }

    @Test fun vipBadgeIsRedWithWhiteDigits() {
        assertEquals(0xFFD32F2F.toInt(), VipBadge.VIP_BACKGROUND)
        assertEquals(0xFFFFFFFF.toInt(), VipBadge.VIP_TEXT)
        val style = VipBadge.style(total = 1, vipWaiting = 1)
        assertEquals(VipBadge.Tone.VIP, style.tone)
        assertEquals(VipBadge.VIP_BACKGROUND, style.background)
        assertEquals(VipBadge.VIP_TEXT, style.text)
    }

    @Test fun bothPalettesAreOpaqueAndFullyDistinct() {
        listOf(VipBadge.NORMAL_BACKGROUND, VipBadge.VIP_BACKGROUND, VipBadge.NORMAL_TEXT, VipBadge.VIP_TEXT)
            .forEach { colour -> assertEquals("$colour must be opaque", 255, HubPalette.alpha(colour)) }
        assertTrue(VipBadge.NORMAL_BACKGROUND != VipBadge.VIP_BACKGROUND)
        assertTrue(VipBadge.NORMAL_TEXT != VipBadge.VIP_TEXT)
    }

    @Test fun digitContrastStaysAboveWcagAa() {
        fun ratio(one: Int, other: Int): Double {
            val a = HubPalette.luminance(one)
            val b = HubPalette.luminance(other)
            return (maxOf(a, b) + 0.05) / (minOf(a, b) + 0.05)
        }
        listOf(
            VipBadge.NORMAL_BACKGROUND to VipBadge.NORMAL_TEXT,
            VipBadge.VIP_BACKGROUND to VipBadge.VIP_TEXT,
        ).forEach { (background, text) ->
            val measured = ratio(background, text)
            assertTrue("contrast $measured", measured >= 4.5)
        }
    }

    // ---- BADGE-07..09: the digits ----------------------------------------------------------------

    @Test fun theLabelCountsFromOneAndStopsAtNinetyNine() {
        val cases = listOf(
            -5 to null, 0 to null, 1 to "1", 2 to "2", 9 to "9", 10 to "10", 11 to "11",
            42 to "42", 97 to "97", 98 to "98", 99 to "99", 100 to "99+", 101 to "99+",
            250 to "99+", 9999 to "99+", Int.MAX_VALUE to "99+",
        )
        for ((total, expected) in cases) assertEquals("total $total", expected, VipBadge.label(total))
    }

    @Test fun theCapIsNinetyNine() {
        assertEquals(99, VipBadge.CAP)
        assertEquals("99", VipBadge.label(VipBadge.CAP))
        assertEquals("99+", VipBadge.label(VipBadge.CAP + 1))
    }

    @Test fun zeroWaitingChatsDrawsNoBadgeAtAll() {
        assertNull(VipBadge.label(0))
        assertEquals(VipBadge.Tone.NORMAL, VipBadge.style(total = 0, vipWaiting = 0).tone)
    }

    // ---- BADGE-01..06, 21..23, 26..28: the tone truth table --------------------------------------

    @Test fun theToneTable() {
        data class Row(val total: Int, val vipWaiting: Int, val expected: VipBadge.Tone, val why: String)
        val rows = listOf(
            Row(0, 0, VipBadge.Tone.NORMAL, "nothing waiting"),
            Row(1, 0, VipBadge.Tone.NORMAL, "one ordinary chat"),
            Row(1, 1, VipBadge.Tone.VIP, "one VIP chat"),
            Row(5, 1, VipBadge.Tone.VIP, "one VIP among five"),
            Row(5, 4, VipBadge.Tone.VIP, "four VIP among five"),
            Row(5, 5, VipBadge.Tone.VIP, "all VIP"),
            Row(2, 0, VipBadge.Tone.NORMAL, "two ordinary chats"),
            Row(99, 0, VipBadge.Tone.NORMAL, "99 ordinary chats"),
            Row(100, 0, VipBadge.Tone.NORMAL, "100 ordinary chats"),
            Row(100, 1, VipBadge.Tone.VIP, "100 chats, one VIP"),
            Row(9999, 1, VipBadge.Tone.VIP, "a capped VIP count"),
            Row(1, -1, VipBadge.Tone.NORMAL, "an impossible VIP count cannot turn it red"),
            Row(0, 3, VipBadge.Tone.NORMAL, "VIP chats that are not waiting"),
            Row(10, 11, VipBadge.Tone.VIP, "more VIP than total is still VIP"),
        )
        for (row in rows) {
            // The style is the API the overlay and the tests share, and it is the one that clamps.
            assertEquals(row.why, row.expected, VipBadge.style(row.total, row.vipWaiting).tone)
        }
    }

    @Test fun theBareToneRuleIsOneVipForRed() {
        assertEquals(VipBadge.Tone.NORMAL, VipBadge.tone(0))
        assertEquals(VipBadge.Tone.VIP, VipBadge.tone(1))
        assertEquals(VipBadge.Tone.VIP, VipBadge.tone(99))
    }

    @Test fun oneVipArrivalOutranksEveryOrdinaryOne() {
        // BADGE-04: the badge has one colour, and the VIP must not hide behind the ordinary blue.
        val style = VipBadge.style(total = 40, vipWaiting = 1)
        assertEquals(VipBadge.VIP_BACKGROUND, style.background)
        assertEquals(VipBadge.VIP_TEXT, style.text)
    }

    @Test fun readingTheVipMailTurnsTheBadgeBackToBlue() {
        // BADGE-05: the VIP mail is read, an ordinary one is still waiting.
        val after = VipBadge.style(total = 1, vipWaiting = 0)
        assertEquals(VipBadge.NORMAL_BACKGROUND, after.background)
        assertEquals(VipBadge.NORMAL_TEXT, after.text)
    }

    // ---- BADGE-21..22 / VIP-10: counts come from the state ---------------------------------------

    private fun alert(id: AccountId, source: String, acknowledged: Boolean = false) =
        AlertKey(id, source) to ObservedAlert(
            key = AlertKey(id, source),
            conversation = ConversationKey(id, "conversation-$source"),
            generation = 0,
            title = "test",
            messages = listOf(ObservedMessage(null, "text", null)),
            postedAt = 1L,
            acknowledged = acknowledged,
        )

    private fun stateWith(vip: Set<AccountId>, vararg alerts: Pair<AlertKey, ObservedAlert>): HubState = HubState(
        accounts = AccountId.entries.map { AccountBinding(it, vip = it in vip) },
        alerts = alerts.toMap(),
        enabledSlots = listOf(AccountId.A, AccountId.B, AccountId.C),
    )

    @Test fun onlyVipSpacesContributeToTheVipCount() {
        val state = stateWith(setOf(AccountId.B), alert(AccountId.A, "a1"), alert(AccountId.B, "b1"), alert(AccountId.C, "c1"))
        assertEquals(3, VipBadge.total(state))
        assertEquals(1, VipBadge.vipWaiting(state))
        assertEquals(VipBadge.Tone.VIP, VipBadge.of(state).second.tone)
    }

    @Test fun aVipSpaceWithNothingWaitingLeavesTheBadgeBlue() {
        val state = stateWith(setOf(AccountId.B), alert(AccountId.A, "a1"))
        assertEquals(1, VipBadge.total(state))
        assertEquals(0, VipBadge.vipWaiting(state))
        assertEquals(VipBadge.NORMAL_BACKGROUND, VipBadge.of(state).second.background)
    }

    @Test fun anAcknowledgedVipCardNoLongerTurnsTheBadgeRed() {
        val state = stateWith(setOf(AccountId.B), alert(AccountId.A, "a1"), alert(AccountId.B, "b1", acknowledged = true))
        assertEquals(1, VipBadge.total(state))
        assertEquals(0, VipBadge.vipWaiting(state))
        assertEquals(VipBadge.Tone.NORMAL, VipBadge.of(state).second.tone)
    }

    @Test fun aVipSpaceThatIsNotEnabledIsNotCounted() {
        // The flag lives on the binding, but only enabled spaces are on screen or in the badge.
        val state = HubState(
            accounts = AccountId.entries.map { AccountBinding(it, vip = it == AccountId.D) },
            alerts = mapOf(alert(AccountId.D, "d1")),
            enabledSlots = listOf(AccountId.A, AccountId.B),
        )
        assertEquals(0, VipBadge.total(state))
        assertEquals(0, VipBadge.vipWaiting(state))
    }

    @Test fun theBadgeDisappearsWhenEverythingIsRead() {
        val state = stateWith(setOf(AccountId.A), alert(AccountId.A, "a1", acknowledged = true))
        val (label, style) = VipBadge.of(state)
        assertNull(label)
        assertEquals(VipBadge.Tone.NORMAL, style.tone)
    }

    // ---- VIP-01..09: the flag on a space ---------------------------------------------------------

    @Test fun aSpaceIsNotVipUntilItIsMarked() {
        assertFalse(AccountBinding(AccountId.A).vip)
        assertFalse(HubState().account(AccountId.A).vip)
    }

    @Test fun markingOneSpaceLeavesTheOthersAlone() {
        val state = HubReducer.setVip(HubState(), AccountId.B, true)
        assertTrue(state.account(AccountId.B).vip)
        assertFalse(state.account(AccountId.A).vip)
        assertFalse(state.account(AccountId.C).vip)
    }

    @Test fun markingTheSameValueAgainReturnsTheSameState() {
        val marked = HubReducer.setVip(HubState(), AccountId.B, true)
        assertTrue(marked === HubReducer.setVip(marked, AccountId.B, true))
        val cleared = HubReducer.setVip(marked, AccountId.B, false)
        assertTrue(cleared === HubReducer.setVip(cleared, AccountId.B, false))
    }

    @Test fun clearingTheFlagBringsTheBlueBack() {
        val marked = HubReducer.setVip(HubState(), AccountId.A, true)
        val cleared = HubReducer.setVip(marked, AccountId.A, false)
        assertFalse(cleared.account(AccountId.A).vip)
    }

    @Test fun markingASpaceNeverClearsItsAlerts() {
        // VIP-09: the flag is about how an arrival is shown, not about what arrived.
        val state = stateWith(emptySet(), alert(AccountId.A, "a1"))
        val marked = HubReducer.setVip(state, AccountId.A, true)
        assertEquals(state.alerts, marked.alerts)
        assertEquals(1, marked.pending(AccountId.A))
    }

    @Test fun aSpaceThatIsNotEnabledCannotBeMarked() {
        val state = HubState(enabledSlots = listOf(AccountId.A, AccountId.B))
        assertTrue(state === HubReducer.setVip(state, AccountId.E, true))
    }

    @Test fun rebindingKeepsTheFlagItDoesNotReset() {
        // `bind` replaces the label and serial; the VIP choice belongs to the space, not to the binding.
        val marked = HubReducer.setVip(HubReducer.enableSlot(HubState(), AccountId.C), AccountId.C, true)
        val rebound = HubReducer.bind(marked, AccountId.C, serial = 7L, label = "Work mail")
        assertTrue(rebound.account(AccountId.C).vip)
        assertEquals("Work mail", rebound.account(AccountId.C).label)
    }

    @Test fun switchingTheAppKeepsTheFlag() {
        val marked = HubReducer.setVip(HubReducer.enableSlot(HubState(), AccountId.C), AccountId.C, true)
        val switched = HubReducer.selectApp(marked, AccountId.C, HubApps.GMAIL.id)
        assertTrue(switched.account(AccountId.C).vip)
        assertEquals("gmail", switched.account(AccountId.C).appId)
    }

    // ---- the mailboxes the feature adds ----------------------------------------------------------

    @Test fun theMailCatalogHasSixProvidersAndItsOwnKind() {
        assertEquals(listOf("gmail", "outlook", "yahoomail", "icloudmail", "protonmail", "zohomail"),
            HubApps.mail().map { it.id })
        assertTrue(HubApps.mail().all { it.kind == HubApps.KIND_MAIL })
        assertFalse("a mailbox raises cards from its own tab title only", HubApps.mail().any { it.observed })
    }

    @Test fun everyMailboxOpensHttpsAndAllowsOnlyItsOwnHosts() {
        for (app in HubApps.mail()) {
            assertTrue("${app.id} home", app.home.startsWith("https://"))
            assertTrue("${app.id} hosts", app.hosts.isNotEmpty())
            assertTrue("${app.id} home allowed", WebSessionPolicy.allowedFor(app, app.home))
            assertFalse("${app.id} foreign host", WebSessionPolicy.allowedFor(app, "https://example.com/"))
        }
    }

    @Test fun theIdentityHostsAreScopedToTheirOwnMailbox() {
        assertTrue(WebSessionPolicy.allowedFor(HubApps.GMAIL, "https://accounts.google.com/signin"))
        assertFalse(WebSessionPolicy.allowedFor(HubApps.GMAIL, "https://login.microsoftonline.com/common/oauth2"))
        assertTrue(WebSessionPolicy.allowedFor(HubApps.OUTLOOK, "https://login.microsoftonline.com/common/oauth2"))
        assertFalse(WebSessionPolicy.allowedFor(HubApps.OUTLOOK, "https://accounts.google.com/signin"))
    }

    @Test fun aSelectedMailboxKeepsItsKind() {
        assertEquals("mail", HubApps.orDefault("gmail").kind)
        assertEquals("mail", HubApps.orDefault("outlook").kind)
        assertEquals("mail", HubApps.orDefault("protonmail").kind)
        // An unknown id still falls back to the base app rather than hiding the space.
        assertEquals(HubApps.DEFAULT_ID, HubApps.orDefault("not-a-mailbox").id)
    }
}
