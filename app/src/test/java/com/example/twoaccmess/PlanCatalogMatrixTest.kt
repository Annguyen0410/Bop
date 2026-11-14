package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Android plan — the catalog contract, one case per entry per rule.
 *
 * A catalog entry is a promise: one https entry point, hosts that are bare names, a main frame that stays
 * on those hosts, and a label + note a person can read. Splitting the rules into separate parameterized
 * cases means a single broken app cannot hide behind nineteen healthy ones.
 */
@RunWith(Parameterized::class)
class PlanCatalogMatrixTest(private val appId: String, private val check: String) {

    @Test
    fun theCatalogEntryHoldsItsContract() {
        val app = HubApps.byId(appId) ?: throw AssertionError("catalog is missing $appId")
        when (check) {
            "home" -> {
                assertTrue("${app.id} home is https", app.home.startsWith("https://"))
                assertTrue("${app.id} home allowed", WebSessionPolicy.allowedFor(app, app.home))
            }
            "hosts" -> {
                assertTrue("${app.id} has hosts", app.hosts.isNotEmpty())
                for (host in app.hosts) {
                    assertEquals("${app.id} $host lowercase", host.lowercase(), host)
                    assertFalse("${app.id} $host no scheme", host.contains("://"))
                    assertFalse("${app.id} $host no path", host.contains('/'))
                    assertFalse("${app.id} $host no port", host.contains(':'))
                }
                assertEquals("${app.id} hosts unique", app.hosts.size, app.hosts.distinct().size)
            }
            "foreign" -> {
                assertFalse("${app.id} refuses a foreign site", WebSessionPolicy.allowedFor(app, "https://example.com/"))
                assertFalse("${app.id} refuses plain http", WebSessionPolicy.allowedFor(app, "http://${app.hosts.first()}/"))
                assertFalse("${app.id} refuses a look-alike", WebSessionPolicy.allowedFor(app, "https://${app.hosts.first()}.evil.com/"))
            }
            "identity" -> {
                assertTrue("${app.id} label", app.label.isNotBlank())
                assertTrue("${app.id} note", app.note.length > 20)
                assertFalse("${app.id} id has no space", app.id.contains(' '))
                assertEquals("${app.id} id shape is stable", app.id.lowercase(), app.id)
            }
            else -> throw AssertionError("unknown check $check")
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{index}: {0} / {1}")
        fun cases(): List<Array<Any>> {
            val rows = ArrayList<Array<Any>>()
            for (app in HubApps.ALL) {
                for (check in listOf("home", "hosts", "foreign", "identity")) rows.add(arrayOf<Any>(app.id, check))
            }
            return rows
        }
    }
}
