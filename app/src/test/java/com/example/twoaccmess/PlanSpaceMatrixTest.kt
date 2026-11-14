package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Android plan — one VIP space per catalog entry.
 *
 * The same two promises are checked for all 28 entries: choosing that app gives the space that app's
 * group, and marking it VIP turns the bubble badge red while its chat is waiting. Doing it per entry is
 * the point — a mailbox that cannot be marked, or a group that quietly resets, shows up as one failing
 * case instead of a footnote.
 */
@RunWith(Parameterized::class)
class PlanSpaceMatrixTest(private val appId: String, private val check: String) {

    private fun waiting(key: String) = AlertKey(AccountId.C, key) to ObservedAlert(
        key = AlertKey(AccountId.C, key),
        conversation = ConversationKey(AccountId.C, "conversation-$key"),
        generation = 0,
        title = "test",
        messages = listOf(ObservedMessage(null, "text", null)),
        postedAt = 1L,
    )

    @Test
    fun theSpaceKeepsItsGroupAndItsVipFlag() {
        var state = HubState(enabledSlots = listOf(AccountId.A, AccountId.B, AccountId.C))
        state = HubReducer.selectApp(state, AccountId.C, appId)
        assertEquals("$appId group", HubApps.orDefault(appId).kind, state.account(AccountId.C).app.kind)
        assertEquals("$appId id", HubApps.orDefault(appId).id, state.account(AccountId.C).appId)

        when (check) {
            "vip" -> {
                val marked = HubReducer.setVip(state, AccountId.C, true)
                assertTrue("$appId marked", marked.account(AccountId.C).vip)
                // A waiting chat in the VIP space is red; the ordinary space alone is not.
                val vipState = marked.copy(alerts = mapOf(waiting("c1")))
                assertEquals(VipBadge.VIP_BACKGROUND, VipBadge.of(vipState).second.background)
                assertEquals("1", VipBadge.of(vipState).first)
                assertEquals(1, VipBadge.vipWaiting(vipState))
                val cleared = HubReducer.setVip(marked, AccountId.C, false)
                val ordinary = cleared.copy(alerts = mapOf(waiting("c1")))
                assertEquals(VipBadge.NORMAL_BACKGROUND, VipBadge.of(ordinary).second.background)
            }
            "rebind" -> {
                val marked = HubReducer.setVip(state, AccountId.C, true)
                val rebound = HubReducer.bind(marked, AccountId.C, serial = 11L, label = "$appId inbox")
                assertTrue("$appId flag survives a rebind", rebound.account(AccountId.C).vip)
                assertEquals("$appId label", "$appId inbox", rebound.account(AccountId.C).label)
                assertEquals("$appId app survives a rebind", HubApps.orDefault(appId).id, rebound.account(AccountId.C).appId)
            }
            else -> throw AssertionError("unknown check $check")
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{index}: {0} / {1}")
        fun cases(): List<Array<Any>> {
            val rows = ArrayList<Array<Any>>()
            for (app in HubApps.ALL) for (check in listOf("vip", "rebind")) rows.add(arrayOf<Any>(app.id, check))
            return rows
        }
    }
}
