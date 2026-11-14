package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Android plan — the badge matrix, as real cases rather than one loop.
 *
 * `Parameterized` gives every row its own entry in the test report, so "1 000 cases" is a number you can
 * read back from `app/build/test-results` instead of a claim. The rows are the decision surface: every
 * waiting count from 0 to 99, each with no VIP, exactly one VIP, every card VIP, more VIP than cards, and
 * a negative VIP count. The last two are the clamp, which is a rule like any other.
 */
@RunWith(Parameterized::class)
class PlanBadgeMatrixTest(private val total: Int, private val vipWaiting: Int) {

    @Test
    fun theBadgeFollowsTheRule() {
        val honest = vipWaiting.coerceIn(0, total.coerceAtLeast(0))
        val expectedLabel = when {
            total <= 0 -> null
            total > VipBadge.CAP -> "${VipBadge.CAP}+"
            else -> total.toString()
        }
        assertEquals("label for total=$total", expectedLabel, VipBadge.label(total))

        val style = VipBadge.style(total, vipWaiting)
        if (honest > 0) {
            assertEquals("tone for $total/$vipWaiting", VipBadge.Tone.VIP, style.tone)
            assertEquals(VipBadge.VIP_BACKGROUND, style.background)
            assertEquals(VipBadge.VIP_TEXT, style.text)
        } else {
            assertEquals("tone for $total/$vipWaiting", VipBadge.Tone.NORMAL, style.tone)
            assertEquals(VipBadge.NORMAL_BACKGROUND, style.background)
            assertEquals(VipBadge.NORMAL_TEXT, style.text)
        }

        // A badge that draws nothing is never red, and a clamped negative cannot invent a VIP.
        if (total <= 0) assertEquals(VipBadge.Tone.NORMAL, style.tone)
        if (vipWaiting < 0) assertEquals(VipBadge.Tone.NORMAL, style.tone)
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{index}: total={0} vip={1}")
        fun cases(): List<Array<Any>> {
            val rows = ArrayList<Array<Any>>()
            for (total in 0..99) {
                // 0 VIP, one VIP, every card VIP, more VIP than cards, a negative count.
                for (vip in listOf(0, minOf(1, total), total, total + 5, -3)) {
                    rows.add(arrayOf<Any>(total, vip))
                }
            }
            // Past the cap the digits stop growing; the tone must keep working.
            for (total in listOf(100, 101, 150, 500, 1000, 9999, 100000)) {
                for (vip in listOf(0, 1, total)) rows.add(arrayOf<Any>(total, vip))
            }
            return rows
        }
    }
}
