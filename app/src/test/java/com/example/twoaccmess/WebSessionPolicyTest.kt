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

    @Test fun externalFallbackAcceptsOnlyOrdinaryCredentialFreeHttpsLinks() {
        listOf("https://www.facebook.com/messages/", "https://m.me/", "https://example.org/path?q=1",
            "https://example.org:443/").forEach { assertTrue(it, WebSessionPolicy.isSafeExternalHttps(it)) }
        listOf("http://example.org/", "javascript:alert(1)", "intent://messages/#Intent;end",
            "https://user:pass@example.org/", "https://example.org:444/", "not a URL", "").forEach {
            assertFalse(it, WebSessionPolicy.isSafeExternalHttps(it))
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

    @Test fun googleEmbeddedBrowserRefusalIsRecognizedOnlyForAiProviderPages() {
        val title = "This browser or app may not be secure"
        assertTrue(WebSessionPolicy.isEmbeddedSigninRefusal(HubApps.CHATGPT,
            "https://accounts.google.com/signin", title))
        assertFalse(WebSessionPolicy.isEmbeddedSigninRefusal(HubApps.CHATGPT,
            "https://accounts.google.com.evil.example/signin", title))
        assertFalse(WebSessionPolicy.isEmbeddedSigninRefusal(HubApps.FACEBOOK,
            "https://accounts.google.com/signin", title))
        assertFalse(WebSessionPolicy.isEmbeddedSigninRefusal(HubApps.GEMINI,
            "https://gemini.google.com/app", title))
    }

    @Test fun malformedGoogleAuthResponseGetsTheBrowserFallbackOnlyOnAllowedAuthRoutes() {
        assertTrue(WebSessionPolicy.isGoogleMalformedAuthResponse(HubApps.CHATGPT,
            "https://accounts.google.com/signin/oauth/v2", 400))
        assertFalse(WebSessionPolicy.isGoogleMalformedAuthResponse(HubApps.CHATGPT,
            "https://accounts.google.com/signin/oauth/v2", 403))
        assertFalse(WebSessionPolicy.isGoogleMalformedAuthResponse(HubApps.CHATGPT,
            "https://accounts.google.com.evil.example/signin/oauth/v2", 400))
        assertFalse(WebSessionPolicy.isGoogleMalformedAuthResponse(HubApps.CHATGPT,
            "https://accounts.google.com/", 400))
        assertFalse(WebSessionPolicy.isGoogleMalformedAuthResponse(HubApps.FACEBOOK,
            "https://accounts.google.com/signin/oauth/v2", 400))
    }

    @Test fun appsNeedingTheDesktopSiteStartThere() {
        // Measured against the live services, phone agent versus desktop agent:
        //   www.tiktok.com/messages  -> 302 /foryou (the feed)   vs  302 /login?redirect_url=%2Fmessages
        //   chat.zalo.me             -> 302 market://details?id=com.zing.zalo   vs  200
        //   web.whatsapp.com         -> its phone landing page  vs  the chat list
        //   www.facebook.com/messages/ -> 302 https://m.facebook.com/messages/ (the legacy mobile route,
        //                                 which answers login.php?…&refsrc=deprecated)  vs  no redirect
        // The last one is the Messenger regression: the phone layout does not render the messages page, it
        // leaves it. Instagram's phone web build has no direct inbox at all, so it is in this group too.
        // AI sign-in providers reject embedded WebViews, and changing the agent does not make them safe.
        // Keep AI on its responsive layout and expose the external-browser fallback instead.
        assertEquals(setOf("messenger", "instagram", "tiktok", "zalo", "whatsapp"),
            HubApps.ALL.filter { WebSessionPolicy.defaultDesktop(it) }.map { it.id }.toSet())
        listOf(HubApps.CHATGPT, HubApps.CLAUDE, HubApps.GEMINI).forEach {
            assertFalse("${it.id} must not disguise an embedded login as desktop Chrome", WebSessionPolicy.defaultDesktop(it))
        }
        listOf(HubApps.FACEBOOK, HubApps.TELEGRAM, HubApps.DISCORD,
            HubApps.SNAPCHAT, HubApps.SKYPE, HubApps.LINKEDIN, HubApps.REDDIT).forEach {
            assertFalse("${it.id} must keep the phone layout", WebSessionPolicy.defaultDesktop(it))
        }
        // The desktop agent really removes the phone markers, so the service cannot answer with the layout
        // that has no messages page.
        val mobile = "Mozilla/5.0 (Linux; Android 15; Device Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.91 Mobile Safari/537.36"
        listOf(HubApps.MESSENGER, HubApps.INSTAGRAM, HubApps.TIKTOK, HubApps.ZALO, HubApps.WHATSAPP).forEach {
            assertTrue(it.id, WebSessionPolicy.defaultDesktop(it))
            assertFalse(it.id, WebSessionPolicy.desktopAgent(mobile).contains("Mobile"))
            assertFalse(it.id, WebSessionPolicy.desktopAgent(mobile).contains("; wv"))
        }
    }

    @Test fun theMessengerRouteItselfIsUnchanged() {
        // messenger.com was retired; Facebook's own messages page is the route that still exists.
        assertEquals("https://www.facebook.com/messages/", HubApps.MESSENGER.home)
        assertEquals("https://www.instagram.com/direct/inbox/", HubApps.INSTAGRAM.home)
        assertTrue(WebSessionPolicy.allowedFor(HubApps.MESSENGER, HubApps.MESSENGER.home))
        assertTrue(WebSessionPolicy.allowedFor(HubApps.INSTAGRAM, HubApps.INSTAGRAM.home))
        // The phone UA's bounce target stays inside the same slot instead of being blocked as foreign.
        assertTrue(WebSessionPolicy.allowedFor(HubApps.MESSENGER, "https://m.facebook.com/messages/"))
    }

    @Test fun aStoredLayoutIsNeverDiscardedByTheMigration() {
        // The promise: a switch the owner flipped outranks a new default. A value stored before the
        // choice marker existed cannot be proven to be a default, so it is adopted, not deleted.
        val explicitDesktop = WebSessionPolicy.planLayout(storedRule = 0, storedDesktop = true, storedChoice = false)
        assertNotNull(explicitDesktop)
        assertEquals(true, explicitDesktop!!.desktop)
        assertTrue(explicitDesktop.choice)
        val explicitMobile = WebSessionPolicy.planLayout(storedRule = 1, storedDesktop = false, storedChoice = false)
        assertEquals(false, explicitMobile!!.desktop)
        assertTrue(explicitMobile.choice)
        // A space that never stored a layout is the only one the rule may move.
        val untouched = WebSessionPolicy.planLayout(storedRule = 0, storedDesktop = null, storedChoice = false)
        assertNull(untouched!!.desktop)
        assertFalse(untouched.choice)
        // No plan ever deletes a value: the plan type has no way to express a removal.
        assertEquals(WebSessionPolicy.LAYOUT_RULE, untouched.rule)
        assertEquals(WebSessionPolicy.LAYOUT_RULE, explicitDesktop.rule)
    }

    @Test fun theLayoutMigrationRunsOnceAndOnlyOnce() {
        assertEquals(WebSessionPolicy.LAYOUT_RULE, WebSessionPolicy.planLayout(0, true, false)!!.rule)
        // Already migrated: the second call must be a no-op, or reopening a space would rewrite its
        // preferences on every launch.
        assertNull(WebSessionPolicy.planLayout(WebSessionPolicy.LAYOUT_RULE, true, false))
        assertNull(WebSessionPolicy.planLayout(WebSessionPolicy.LAYOUT_RULE + 1, null, false))
    }

    @Test fun theOldPerActivitySwitchCarriesItsValueAcross() {
        // The very old build wrote "desktop" only on a flip. Keeping the flag but not the value left the
        // space on the app's default layout while the app reported that it had kept the choice.
        assertNull(WebSessionPolicy.legacyDesktopChoice(oldHasDesktop = false, oldDesktop = false))
        assertEquals(false, WebSessionPolicy.legacyDesktopChoice(true, false))
        assertEquals(true, WebSessionPolicy.legacyDesktopChoice(true, true))
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
