package com.example.twoaccmess

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Android plan — the host allow-list, one case per (entry, host).
 *
 * Every host an entry lists gets the four navigations that decide whether an embedded browser is safe: the
 * page itself, a subdomain of it (how nearly every sign-in flow works), a look-alike that only shares the
 * suffix, and plain http. A host that is allowed when it should not be is the failure this whole list
 * exists to prevent.
 */
@RunWith(Parameterized::class)
class PlanHostMatrixTest(private val appId: String, private val host: String) {

    @Test
    fun theHostIsAllowedOnlyForItsOwnEntry() {
        val app = HubApps.byId(appId) ?: throw AssertionError("catalog is missing $appId")
        assertTrue("$host allowed in $appId", WebSessionPolicy.allowedFor(app, "https://$host/"))
        assertTrue("sub.$host allowed in $appId", WebSessionPolicy.allowedFor(app, "https://sub.$host/deep/path?x=1#top"))
        assertFalse("$host look-alike refused", WebSessionPolicy.allowedFor(app, "https://$host.evil.com/"))
        assertFalse("$host look-alike path refused", WebSessionPolicy.allowedFor(app, "https://$host.evil.com/login"))
        assertFalse("$host plain http refused", WebSessionPolicy.allowedFor(app, "http://$host/"))
        // Nothing that carries credentials in the URL may open inside a space.
        assertFalse("$host userinfo refused", WebSessionPolicy.allowedFor(app, "https://user:secret@$host/"))
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{index}: {0} / {1}")
        fun cases(): List<Array<Any>> {
            val rows = ArrayList<Array<Any>>()
            for (app in HubApps.ALL) for (host in app.hosts) rows.add(arrayOf<Any>(app.id, host))
            return rows
        }
    }
}
