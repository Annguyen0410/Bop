package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The "runs on every phone" card is the difference between "it works on my phone" and "it works on
 * the user's phone". These tests pin the rules down: one failing input must never hide, an unknown
 * browser-engine answer must never be reported as a failure, and every brand that gets advice must get
 * real steps rather than an empty heading.
 */
class HubReliabilityTest {
    private fun checks(
        notifyAllowed: Boolean = true,
        listenerAccess: Boolean = true,
        listenerConnected: Boolean = true,
        overlayAllowed: Boolean = true,
        batteryExempt: Boolean = true,
        webProfiles: Boolean? = true,
    ) = HubReliability.checks(notifyAllowed, listenerAccess, listenerConnected, overlayAllowed, batteryExempt, webProfiles)

    private fun check(key: ReliabilityCheck.Key, list: List<ReliabilityCheck>) =
        list.single { it.key == key }

    @Test fun aHealthyPhonePassesEveryCheck() {
        val list = checks()
        assertEquals(ReliabilityCheck.Key.entries.size, list.size)
        assertEquals(list.size, list.map { it.key }.distinct().size)
        assertTrue(HubReliability.allOk(list))
        assertEquals(0, HubReliability.pending(list))
        assertEquals("All ${list.size} checks pass", HubReliability.statusLine(list))
        list.forEach { assertTrue(it.title.isNotBlank() && it.status.isNotBlank() && it.advice.isNotBlank()) }
    }

    @Test fun everyFailingCheckIsVisibleWithItsOwnAdvice() {
        // Break one input at a time. Losing notification access also loses the listener connection,
        // so that case is expected to fail twice; nothing else may fail or hide behind another row.
        val cases = listOf(
            listOf(ReliabilityCheck.Key.Notifications) to checks(notifyAllowed = false),
            listOf(ReliabilityCheck.Key.Listener, ReliabilityCheck.Key.ListenerAlive) to checks(listenerAccess = false),
            listOf(ReliabilityCheck.Key.Overlay) to checks(overlayAllowed = false),
            listOf(ReliabilityCheck.Key.Battery) to checks(batteryExempt = false),
            listOf(ReliabilityCheck.Key.WebProfiles) to checks(webProfiles = false),
        )
        cases.forEach { (expected, list) ->
            assertEquals("$expected", expected, list.filter { !it.ok }.map { it.key })
            assertFalse(HubReliability.statusLine(list).contains("pass"))
            assertTrue(HubReliability.statusLine(list).startsWith("${expected.size} of ${list.size}"))
            expected.forEach { key -> assertTrue("$key advice", check(key, list).advice.length > 20) }
        }
    }

    @Test fun grantedAccessWithoutAConnectedListenerIsTheSilentFailureCase() {
        val list = checks(listenerConnected = false)
        val alive = check(ReliabilityCheck.Key.ListenerAlive, list)
        assertFalse(alive.ok)
        assertEquals("Disconnected", alive.status)
        assertTrue(alive.advice.contains("stopped alerting"))
        // Access itself is fine, so that check must stay green: the repair is a rebind, not a permission.
        assertTrue(check(ReliabilityCheck.Key.Listener, list).ok)
        assertEquals(1, HubReliability.pending(list))
    }

    @Test fun anUnreadableBrowserEngineIsNotReportedAsAFailure() {
        val stillChecking = check(ReliabilityCheck.Key.WebProfiles, checks(webProfiles = null))
        assertTrue(stillChecking.ok)
        assertEquals("Checking…", stillChecking.status)
        val unsupported = check(ReliabilityCheck.Key.WebProfiles, checks(webProfiles = false))
        assertFalse(unsupported.ok)
        assertEquals("Not supported", unsupported.status)
        assertTrue(unsupported.advice.contains("WebView"))
    }

    @Test fun manufacturerAliasesShareOneAdviceEntry() {
        listOf(
            Triple("Xiaomi", "Redmi", "xiaomi"), Triple("POCO", "POCO", "xiaomi"),
            Triple("OPPO", "OPPO", "oppo"), Triple("realme", "realme", "oppo"),
            Triple("vivo", "iQOO", "vivo"), Triple("HUAWEI", "HONOR", "huawei"),
            Triple("samsung", "samsung", "samsung"), Triple("OnePlus", "OnePlus", "oneplus"),
            Triple("TECNO", "TECNO", "transsion"), Triple("motorola", "motorola", "motorola"),
        ).forEach { (manufacturer, brand, expected) ->
            assertEquals("$manufacturer/$brand", expected, HubReliability.oemKey(manufacturer, brand))
        }
        // Unknown or absent brands are not an error: the card falls back to the generic steps.
        assertNull(HubReliability.oemKey("Google", "Pixel"))
        assertNull(HubReliability.oemKey(null, null))
        assertNull(HubReliability.oemKey("", "  "))
        assertFalse(HubReliability.GENERIC_STEPS.isEmpty())
    }

    @Test fun everyBrandWithAdviceHasRealStepsAndADeepLinkKey() {
        listOf("Xiaomi", "OPPO", "vivo", "HUAWEI", "samsung", "OnePlus", "ASUS", "motorola", "TECNO").forEach { brand ->
            val advice = HubReliability.oemAdvice(brand, brand)
            assertNotNull(brand, advice)
            assertEquals(brand, advice!!.key, HubReliability.oemKey(brand, brand))
            assertTrue("$brand label", advice.label.isNotBlank())
            assertTrue("$brand needs steps", advice.steps.size >= 2)
            advice.steps.forEach { assertTrue("$brand step", it.length > 10) }
        }
    }
}
