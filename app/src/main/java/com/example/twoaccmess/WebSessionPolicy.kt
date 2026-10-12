package com.example.twoaccmess

import java.net.URI
import java.util.Locale

/** Browser storage isolation, not a separate Android UID/security sandbox. */
object WebSessionPolicy {
    const val HOME = "https://www.facebook.com/messages/"
    const val MIN_ANDROID = 28

    /**
     * The fallback for an app with no measured rule: the *mobile* website, which is the only layout built
     * to fit an arbitrary screen size. Asking for the desktop site makes the service serve its wide
     * layout, whose fixed-width dialogs push their own close button outside the visible area — and then
     * there is no way to dismiss them, which is exactly the bug this default fixes. Desktop mode stays
     * available per space from the Options menu, and [defaultDesktop] overrides this fallback only where
     * the phone layout provably has no messages view at all.
     */
    const val DEFAULT_DESKTOP_MODE = false

    /**
     * Which layout a fresh space for [app] must start on.
     *
     * Measured against the live services on 8 October 2026 by requesting each entry point with a phone
     * user agent and with a desktop one:
     *
     *  - `tiktok.com/messages` → `302 /foryou` (the feed, no messages page) versus `302 /login` with the
     *    messages page as the post-login target;
     *  - `chat.zalo.me` → `302 market://details?id=com.zing.zalo` (the phone is sent to the Play Store,
     *    so the chat never loads) versus a normal `200`;
     *  - WhatsApp Web serves its phone landing page instead of the chat list.
     *
     * Telegram, Instagram, Discord, Facebook and Messenger answered identically for both agents, so they
     * keep the layout that fits. A layout the user switched by hand always wins; see [HubApp.desktopSite].
     */
    fun defaultDesktop(app: HubApp): Boolean = app.desktopSite

    /**
     * What the hub's session diagnostics prints for the layout a space actually asked for, so the owner
     * can confirm on their own phone which site a slot opened without a debugger attached.
     */
    fun layoutDetail(app: HubApp, desktop: Boolean) =
        "${app.label} · " + if (desktop) "desktop site" else "phone site"

    fun processName(packageName: String, account: AccountId) =
        "$packageName:messenger_${account.name.lowercase(Locale.ROOT)}"

    fun dataSuffix(account: AccountId) = "messenger_${account.name.lowercase(Locale.ROOT)}"

    fun accountForProcess(packageName: String, process: String): AccountId? =
        AccountId.entries.singleOrNull { processName(packageName, it) == process }

    /** Ordered slots so a web session can hand over to the next account without a shared session. */
    fun next(account: AccountId): AccountId = AccountId.entries[(account.ordinal + 1) % AccountId.entries.size]

    fun previous(account: AccountId): AccountId = AccountId.entries[(account.ordinal + AccountId.entries.size - 1) % AccountId.entries.size]

    // Do not embed arbitrary domains, intent: links or fake login pages.
    // Resource requests are left to Chromium: these sites serve media from multiple CDNs.
    fun allowedFor(app: HubApp, url: String): Boolean = try {
        val uri = URI(url)
        val host = uri.host?.lowercase(Locale.ROOT)
        uri.scheme.equals("https", ignoreCase = true) && uri.rawUserInfo == null &&
            (uri.port == -1 || uri.port == 443) && host != null &&
            app.hosts.any { host == it || host.endsWith(".$it") }
    } catch (_: Exception) {
        false
    }

    /** Messenger's own allowlist, kept for callers that predate the per-app catalog. */
    fun allowedNavigation(url: String) = allowedFor(HubApps.MESSENGER, url)

    /** Keep the installed engine version; request the desktop site without inventing a Chrome version. */
    fun desktopAgent(defaultAgent: String): String = defaultAgent
        .replace(Regex("\\(Linux; Android[^)]*\\)"), "(X11; Linux x86_64)")
        .replace("; wv", "")
        .replace(Regex("Version/[0-9.]+ ?"), "")
        .replace(" Mobile", "")
}
