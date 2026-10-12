package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HubAppsTest {
    @Test fun catalogIsStableAndEveryEntryNamesOneHttpsEntryPoint() {
        assertEquals(HubApps.MESSENGER, HubApps.DEFAULT)
        assertEquals(HubApps.DEFAULT_ID, HubApps.DEFAULT.id)
        assertEquals(19, HubApps.ALL.size)
        assertEquals(HubApps.ALL.size, HubApps.ALL.map { it.id }.distinct().size)
        assertTrue(HubApps.ALL.all { it.id == it.id.lowercase() && it.id.none { c -> c == ' ' } })
        assertEquals(HubApps.ALL.size, HubApps.ALL.map { it.label }.distinct().size)
        HubApps.ALL.forEach { app ->
            assertTrue(app.home, app.home.startsWith("https://"))
            assertTrue(app.label, app.label.isNotBlank())
            assertTrue(app.note, app.note.isNotBlank())
            assertTrue(app.id, app.hosts.isNotEmpty() && app.hosts.none { it.startsWith(".") || it.contains('/') })
            assertTrue(app.id, WebSessionPolicy.allowedFor(app, app.home))
        }
        assertNotNull(HubApps.byId("instagram"))
        assertNotNull(HubApps.byId("telegram"))
        assertNull(HubApps.byId("not-an-app"))
        assertNull(HubApps.byId(null))
    }

    @Test fun onlyAppsWithARealListenerAreClaimedAsObserved() {
        // Every catalog app except Facebook ships a phone app here, so it can raise cards. Facebook is
        // web-only on purpose: its notifications mix likes, comments and page posts with messages.
        assertEquals(listOf(HubApps.FACEBOOK), HubApps.webOnly())
        assertEquals(HubApps.ALL.size - 1, HubApps.observingCount())
        assertEquals(HubApps.observingCount(), HubApps.observingLabels().split(", ").size)
        assertTrue(HubApps.observingLabels().contains("WhatsApp"))
        assertTrue(HubApps.observingLabels().contains("Discord"))
        assertFalse(HubApps.FACEBOOK.observed)
        assertTrue(HubApps.WHATSAPP.observed)
        assertTrue(HubApps.ZALO.observed)
        assertTrue(HubApps.DISCORD.observed)
        assertTrue(HubApps.GOOGLE_CHAT.observed)
    }

    @Test fun everyCatalogEntryOwnsItsHostsAndRejectsTheOthers() {
        HubApps.ALL.forEach { app -> assertTrue(app.id, WebSessionPolicy.allowedFor(app, app.home)) }
        // Unrelated apps never open each other's sites. The Meta family is excluded because it
        // deliberately shares facebook.com/messenger.com login hosts.
        val meta = setOf("messenger", "facebook", "instagram")
        val others = listOf(HubApps.TIKTOK, HubApps.TELEGRAM, HubApps.WHATSAPP, HubApps.ZALO, HubApps.X, HubApps.THREADS,
            HubApps.REDDIT, HubApps.DISCORD, HubApps.SNAPCHAT, HubApps.LINKEDIN, HubApps.VIBER, HubApps.SKYPE,
            HubApps.GOOGLE_CHAT, HubApps.VK, HubApps.BLUESKY, HubApps.WECHAT)
        HubApps.ALL.filterNot { it.id in meta }.forEach { app ->
            others.filter { it.id != app.id }.forEach { other ->
                assertFalse("${app.id} must not open ${other.id}", WebSessionPolicy.allowedFor(app, other.home))
            }
        }
        // Lookalike domains, cleartext and odd ports stay blocked for every entry, not just Messenger.
        HubApps.ALL.forEach { app ->
            assertFalse(app.id, WebSessionPolicy.allowedFor(app, "https://${app.hosts.first()}.evil.example/"))
            assertFalse(app.id, WebSessionPolicy.allowedFor(app, "http://${app.hosts.first()}/"))
            assertFalse(app.id, WebSessionPolicy.allowedFor(app, "https://evil.example@${app.hosts.first()}/"))
            assertFalse(app.id, WebSessionPolicy.allowedFor(app, "https://${app.hosts.first()}:8443/"))
        }
    }

    @Test fun everyObservedPackageBelongsToExactlyOneCatalogApp() {
        val packages = HubApps.ALL.flatMap { it.packages }
        assertTrue(packages.isNotEmpty())
        assertEquals(packages.size, packages.distinct().size)
        assertTrue(HubApps.MESSENGER.packages.contains(MESSENGER_PACKAGE))
        assertEquals(HubApps.INSTAGRAM, HubApps.byPackage("com.instagram.android"))
        assertEquals(HubApps.TIKTOK, HubApps.byPackage("com.zhiliaoapp.musically"))
        assertEquals(HubApps.TIKTOK, HubApps.byPackage("com.ss.android.ugc.trill"))
        assertEquals(HubApps.TELEGRAM, HubApps.byPackage("org.telegram.messenger"))
        assertEquals(HubApps.TELEGRAM, HubApps.byPackage("org.thunderdog.challegram"))
        assertEquals(HubApps.WHATSAPP, HubApps.byPackage("com.whatsapp"))
        assertEquals(HubApps.WHATSAPP, HubApps.byPackage("com.whatsapp.w4b"))
        assertEquals(HubApps.ZALO, HubApps.byPackage("com.zing.zalo"))
        assertEquals(HubApps.X, HubApps.byPackage("com.twitter.android"))
        assertEquals(HubApps.THREADS, HubApps.byPackage("com.instagram.barcelona"))
        assertEquals(HubApps.DISCORD, HubApps.byPackage("com.discord"))
        assertEquals(HubApps.SKYPE, HubApps.byPackage("com.skype.raider"))
        assertEquals(HubApps.GOOGLE_CHAT, HubApps.byPackage("com.google.android.apps.dynamite"))
        assertEquals(HubApps.WECHAT, HubApps.byPackage("com.tencent.mm"))
        // Every declared package maps back to the app that declared it: no package is shared or guessed.
        HubApps.observing().forEach { app -> app.packages.forEach { pkg -> assertEquals(app, HubApps.byPackage(pkg)) } }
        // Unknown packages fail closed instead of being guessed into a slot.
        assertNull(HubApps.byPackage("com.example.evil"))
        assertNull(HubApps.byPackage(""))
        assertNull(HubApps.byPackage(null))
        // Web-only apps must never own a package: that would claim alerts they cannot raise.
        assertTrue(HubApps.observing().all { it.packages.isNotEmpty() })
        assertTrue(HubApps.ALL.filterNot { it.observed }.all { it.packages.isEmpty() })
    }

    @Test fun catalogMarksTheAppsWhosePhoneLayoutHasNoMessagesView() {
        // The flag lives on the catalog entry, and the entry's own note has to say so, because the About
        // dialog is where the user learns why this one space does not look like the others. The rule and
        // its measurements are pinned in [WebSessionPolicyTest]; a new app needs evidence before it is
        // added here, not a guess.
        assertEquals(setOf("tiktok", "zalo", "whatsapp"),
            HubApps.ALL.filter { it.desktopSite }.map { it.id }.toSet())
        HubApps.ALL.filter { it.desktopSite }.forEach { app ->
            assertTrue(app.id, app.note.contains("desktop site"))
        }
        assertTrue(HubApps.ALL.filterNot { it.desktopSite }.all { !it.note.contains("desktop site") })
    }

    @Test fun storedAppIdsFallBackInsteadOfHidingASlot() {
        assertEquals("messenger", HubApps.orDefault(null).id)
        assertEquals("messenger", HubApps.orDefault("").id)
        assertEquals("telegram", HubApps.orDefault("telegram").id)
        assertEquals("tiktok", HubApps.orDefault("tiktok").id)
        assertEquals("Zalo", HubApps.label("zalo"))
        assertEquals("Messenger", HubApps.label("unknown-app"))
    }

    @Test fun instagramSessionAcceptsItsOwnHostsAndRejectsLookalikes() {
        val app = HubApps.INSTAGRAM
        listOf(app.home, "https://www.instagram.com/", "https://instagram.com/accounts/login/",
            "https://i.instagram.com/api/", "https://www.facebook.com/login/").forEach {
            assertTrue(it, WebSessionPolicy.allowedFor(app, it))
        }
        listOf("https://instagram.com.evil.example/", "https://evilinstagram.com/", "https://instagram.com@evil.example/",
            "http://instagram.com/", "https://instagram.com:8443/", "https://tiktok.com/", "not a URL").forEach {
            assertFalse(it, WebSessionPolicy.allowedFor(app, it))
        }
    }

    @Test fun telegramSessionAcceptsItsOwnHostsAndRejectsLookalikes() {
        val app = HubApps.TELEGRAM
        listOf(app.home, "https://web.telegram.org/a/", "https://web.telegram.org/k/", "https://t.me/someone",
            "https://telegram.org/faq").forEach {
            assertTrue(it, WebSessionPolicy.allowedFor(app, it))
        }
        listOf("https://telegram.org.evil.example/", "https://eviltelegram.org/", "https://t.me@evil.example/",
            "http://web.telegram.org/", "https://web.telegram.org:8443/", "tg://resolve?domain=x", "not a URL").forEach {
            assertFalse(it, WebSessionPolicy.allowedFor(app, it))
        }
    }

    @Test fun tiktokSessionAllowsItsOwnLoginPagesAndRejectsLookalikes() {
        val app = HubApps.TIKTOK
        listOf(app.home, "https://www.tiktok.com/", "https://www.tiktok.com/login",
            "https://www.tiktok.com/login/phone-or-email/email", "https://www.tiktok.com/@someone/video/1",
            "https://vm.tiktok.com/abc").forEach {
            assertTrue(it, WebSessionPolicy.allowedFor(app, it))
        }
        listOf("https://tiktok.com.evil.example/", "https://eviltiktok.com/", "https://www.tiktok.com@evil.example/",
            "http://www.tiktok.com/", "https://www.tiktok.com:8443/", "https://www.instagram.com/", "not a URL").forEach {
            assertFalse(it, WebSessionPolicy.allowedFor(app, it))
        }
    }

    @Test fun eachAppKeepsItsOwnNeighboursOut() {
        assertTrue(WebSessionPolicy.allowedFor(HubApps.TIKTOK, "https://www.tiktok.com/messages"))
        assertFalse(WebSessionPolicy.allowedFor(HubApps.TIKTOK, "https://www.instagram.com/"))
        assertFalse(WebSessionPolicy.allowedFor(HubApps.TELEGRAM, "https://www.instagram.com/"))
        assertFalse(WebSessionPolicy.allowedFor(HubApps.INSTAGRAM, "https://web.telegram.org/"))
        assertTrue(WebSessionPolicy.allowedFor(HubApps.WHATSAPP, "https://web.whatsapp.com/"))
        assertTrue(WebSessionPolicy.allowedFor(HubApps.WHATSAPP, "https://pps.whatsapp.net/v/t62"))
        assertFalse(WebSessionPolicy.allowedFor(HubApps.WHATSAPP, "https://whatsapp.com.evil.example/"))
        assertTrue(WebSessionPolicy.allowedFor(HubApps.ZALO, "https://id.zalo.me/account"))
        assertFalse(WebSessionPolicy.allowedFor(HubApps.ZALO, "https://zalo.me.evil.example/"))
        // Messenger's own policy must stay exactly what it was before the catalog existed.
        assertTrue(WebSessionPolicy.allowedNavigation(WebSessionPolicy.HOME))
        assertFalse(WebSessionPolicy.allowedNavigation("https://www.instagram.com/"))
    }
}
