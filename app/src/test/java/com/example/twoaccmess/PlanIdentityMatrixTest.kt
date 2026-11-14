package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Android plan — the slot names, which are the same bijective base-26 names the desktop build uses.
 *
 * A slot name is persisted, printed on a card and used to derive a WebView profile, so "A..Z, AA.., no
 * ceiling" has to hold at the edges as well as in the middle. Each ordinal and each rejected string is its
 * own case.
 */
@RunWith(Parameterized::class)
class PlanIdentityMatrixTest(private val ordinal: Int) {

    @Test
    fun theNameRoundTrips() {
        val id = AccountId(ordinal)
        val name = id.name
        assertTrue("$ordinal is A-Z", name.all { it in 'A'..'Z' })
        assertTrue("$ordinal fits the stored name", name.length <= 7)
        assertEquals("$ordinal round trip", id, AccountId.from(name))
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{index}: ordinal {0}")
        fun cases(): List<Array<Any>> {
            val rows = ArrayList<Array<Any>>()
            val ordinals = listOf(
                0, 1, 2, 12, 23, 24, 25, 26, 27, 51, 52, 53, 100, 675, 676, 677,
                701, 702, 1000, 12345, 17575, 17576, 1_000_000, Int.MAX_VALUE - 1,
            )
            for (ordinal in ordinals) rows.add(arrayOf<Any>(ordinal))
            return rows
        }
    }
}

/** Shapes a stored or hand-edited name must never be accepted as. */
class PlanIdentityRejectsTest {

    private val rejected = listOf(
        "", "a", "abc", "A1", "1A", "A-", "A_", "ABCDEFGH", " A", "A ", "Ä", "AA\t", "ZZZZZZZZ",
    )

    @Test
    fun aBadStoredNameIsRefused() {
        for (value in rejected) assertNull("'$value' must not parse", AccountId.from(value))
    }

    @Test
    fun missingNamesAreRefused() {
        assertNull(AccountId.from(null))
    }

    @Test
    fun aNegativeOrdinalCannotBeConstructed() {
        var threw = false
        try {
            AccountId(-1)
        } catch (_: IllegalArgumentException) {
            threw = true
        }
        assertTrue("AccountId(-1) must be refused", threw)
    }

    @Test
    fun theLowestOrdinalsAreThePermanentSpaces() {
        assertEquals("A", AccountId(0).name)
        assertEquals("B", AccountId(1).name)
        assertEquals("Z", AccountId(25).name)
        assertEquals("AA", AccountId(26).name)
        assertEquals("AB", AccountId(27).name)
        assertEquals(AccountId.A, AccountId.from("A"))
        assertEquals(AccountId.B, AccountId.from("B"))
    }
}
