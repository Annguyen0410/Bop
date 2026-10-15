package com.example.twoaccmess

import org.junit.Assert.*
import org.junit.Test

class WebSessionPolicyTest {
    private val packageName = "com.example.twoaccmess"

    @Test fun accountsHaveDistinctProcessesAndBrowserDirectories() {
        // The declared pool replaced 1.5's four fixed slots; every one still needs its own storage.
        assertEquals(16, AccountId.entries.size)
        assertEquals("messenger_a", WebSessionPolicy.dataSuffix(AccountId.A))
        assertEquals("messenger_b", WebSessionPolicy.dataSuffix(AccountId.B))
        assertEquals("messenger_c", WebSessionPolicy.dataSuffix(AccountId.C))
        assertEquals("messenger_d", WebSessionPolicy.dataSuffix(AccountId.D))
        assertEquals("messenger_p", WebSessionPolicy.dataSuffix(AccountId.P))
        assertEquals(AccountId.entries.size, AccountId.entries.map { WebSessionPolicy.processName(packageName, it) }.distinct().size)
        assertEquals(AccountId.entries.size, AccountId.entries.map { WebSessionPolicy.dataSuffix(it) }.distinct().size)
        AccountId.entries.forEach { id ->
            assertEquals(id, WebSessionPolicy.accountForProcess(packageName, WebSessionPolicy.processName(packageName, id)))
        }
    }

    @Test fun slotsCycleInAStableOrderSoAWebSessionCanHandOver() {
        assertEquals(AccountId.B, WebSessionPolicy.next(AccountId.A))
        assertEquals(AccountId.C, WebSessionPolicy.next(AccountId.B))
        assertEquals(AccountId.D, WebSessionPolicy.next(AccountId.C))
        assertEquals(AccountId.A, WebSessionPolicy.next(AccountId.P))
        assertEquals(AccountId.P, WebSessionPolicy.previous(AccountId.A))
        AccountId.entries.forEach { assertEquals(it, WebSessionPolicy.previous(WebSessionPolicy.next(it))) }
        assertNotEquals(WebSessionPolicy.next(AccountId.A), WebSessionPolicy.previous(AccountId.A))
    }

    @Test fun unknownProcessesNeverFallBackToAnyAccount() {
        listOf(packageName, "$packageName:messenger", "$packageName:messenger_q", "$packageName:messenger_aa",
            "$packageName:messenger_z", "$packageName:messenger_A", "$packageName:messenger_a2", "another.app:messenger_a", "").forEach {
            assertNull(WebSessionPolicy.accountForProcess(packageName, it))
        }
    }

    @Test fun acceptsActualHttpsMetaLoginAndMessagingOrigins() {
        assertEquals("https://www.facebook.com/messages/", WebSessionPolicy.HOME)
        listOf(WebSessionPolicy.HOME, "https://facebook.com/", "https://www.facebook.com/login.php?next=%2Fmessages%2F",
            "https://m.facebook.com/checkpoint/", "https://www.messenger.com/", "https://messenger.com/",
            "https://WWW.FACEBOOK.COM:443/messages/").forEach { assertTrue(it, WebSessionPolicy.allowedNavigation(it)) }
    }

    @Test fun rejectsLookalikeDomainsCredentialsPortsAndUntrustedOrigins() {
        listOf("https://facebook.com.evil.example/login", "https://evilfacebook.com/", "https://facebook.com@evil.example/",
            "https://evil.example@facebook.com/", "https://www.facebook.com:8443/", "https://www.facebook.com./",
            "https://facebook.com\\@evil.example/", "https://fаcebook.com/", "https://fbcdn.net/",
            "https://facebook.com%2Fevil.example/", "https://www.facebook.com\n.evil.example/", "not a URL", "").forEach {
            assertFalse(it, WebSessionPolicy.allowedNavigation(it))
        }
    }

    @Test fun blocksCleartextFilesJavascriptAndNativeAppSchemes() {
        listOf("http://facebook.com/messages/", "file:///data/data/app/cookies", "content://facebook.com/",
            "javascript:location='https://facebook.com'", "intent://messages/#Intent;package=com.facebook.orca;end",
            "fb-messenger://user/1", "data:text/html,hello", "//facebook.com/messages/").forEach {
            assertFalse(it, WebSessionPolicy.allowedNavigation(it))
        }
    }

    @Test fun aFreshSpaceUsesTheMobileSiteBecauseThatIsTheLayoutThatFits() {
        // Regression guard. The first release defaulted every space to the desktop agent, so the service
        // served its wide layout: its own dialogs then put their close button outside a phone-sized screen
        // and there was no way to dismiss them. The mobile site is the layout that fits any screen size, so
        // it is the fallback; the desktop agent remains available per space, and [defaultDesktop] overrides
        // the fallback only for the apps measured below.
        assertFalse("a fresh space must not ask for the desktop site by default", WebSessionPolicy.DEFAULT_DESKTOP_MODE)
        val mobile = "Mozilla/5.0 (Linux; Android 15; Device Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.91 Mobile Safari/537.36"
        assertNotEquals("desktop mode must stay available as a real switch", mobile, WebSessionPolicy.desktopAgent(mobile))
    }

    @Test fun onlyAppsWhosePhoneLayoutHasNoMessagesViewStartOnTheDesktopSite() {
        // Measured against the live services on 8 October 2026, phone agent versus desktop agent:
        //   www.tiktok.com/messages -> 302 /foryou (the feed)   vs  302 /login?redirect_url=%2Fmessages
        //   chat.zalo.me            -> 302 market://details?id=com.zing.zalo   vs  200
        //   web.whatsapp.com        -> its phone landing page  vs  the chat list
        // Every other entry point answered the same for both agents, so it keeps the layout that fits.
        assertEquals(setOf("tiktok", "zalo", "whatsapp"),
            HubApps.ALL.filter { WebSessionPolicy.defaultDesktop(it) }.map { it.id }.toSet())
        listOf(HubApps.MESSENGER, HubApps.FACEBOOK, HubApps.INSTAGRAM, HubApps.TELEGRAM, HubApps.DISCORD,
            HubApps.SNAPCHAT, HubApps.SKYPE).forEach {
            assertFalse("${it.id} must keep the phone layout", WebSessionPolicy.defaultDesktop(it))
        }
        // The desktop agent really removes the phone markers, so the service cannot answer with the layout
        // that has no messages page.
        val mobile = "Mozilla/5.0 (Linux; Android 15; Device Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.91 Mobile Safari/537.36"
        listOf(HubApps.TIKTOK, HubApps.ZALO, HubApps.WHATSAPP).forEach {
            assertTrue(it.id, WebSessionPolicy.defaultDesktop(it))
            assertFalse(it.id, WebSessionPolicy.desktopAgent(mobile).contains("Mobile"))
        }
    }

    @Test fun diagnosticsNameTheLayoutASpaceActuallyAskedFor() {
        // This is the line Settings → Session diagnostics shows for a slot, so the owner can confirm the
        // TikTok fix on their own phone: the slot that needs the desktop site must say so.
        assertTrue(WebSessionPolicy.layoutDetail(HubApps.TIKTOK, desktop = true).contains("desktop site"))
        assertTrue(WebSessionPolicy.layoutDetail(HubApps.TIKTOK, desktop = true).contains("TikTok"))
        assertTrue(WebSessionPolicy.layoutDetail(HubApps.MESSENGER, desktop = false).contains("phone site"))
        assertFalse(WebSessionPolicy.layoutDetail(HubApps.MESSENGER, desktop = false).contains("desktop site"))
        // And the two are never confusable, whatever the app.
        HubApps.ALL.forEach { app ->
            assertNotEquals(WebSessionPolicy.layoutDetail(app, true), WebSessionPolicy.layoutDetail(app, false))
            assertTrue(WebSessionPolicy.layoutDetail(app, WebSessionPolicy.defaultDesktop(app)).isNotBlank())
        }
    }

    @Test fun desktopModePreservesEngineVersionWithoutMobileWebviewMarkers() {
        val mobile = "Mozilla/5.0 (Linux; Android 15; Device Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.91 Mobile Safari/537.36"
        val desktop = WebSessionPolicy.desktopAgent(mobile)
        assertTrue(desktop.contains("Chrome/130.0.6723.91"))
        assertTrue(desktop.contains("(X11; Linux x86_64)"))
        assertFalse(desktop.contains("Android"))
        assertFalse(desktop.contains("Mobile"))
        assertFalse(desktop.contains("; wv"))
        assertFalse(desktop.contains("Version/4.0"))
        assertEquals(desktop, WebSessionPolicy.desktopAgent(desktop))
    }
}
