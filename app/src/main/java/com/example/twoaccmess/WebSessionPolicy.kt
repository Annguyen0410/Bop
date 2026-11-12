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
     * Measured against the live services by requesting each entry point with a phone user agent and with a
     * desktop one:
     *
     *  - `tiktok.com/messages` → `302 /foryou` (the feed, no messages page) versus `302 /login` with the
     *    messages page as the post-login target;
     *  - `chat.zalo.me` → `302 market://details?id=com.zing.zalo` (the phone is sent to the Play Store,
     *    so the chat never loads) versus a normal `200`;
     *  - WhatsApp Web serves its phone landing page instead of the chat list;
     *  - **`www.facebook.com/messages/` with the phone agent → `302 https://m.facebook.com/messages/`**, the
     *    legacy mobile route (it then answers `login.php?…&refsrc=deprecated`), while the desktop agent is
     *    not redirected at all and keeps the full messages page. Re-measured 12 November 2026. Messenger was
     *    reported to have stopped working here, and this redirect is why: the phone layout leaves the
     *    messages page instead of rendering it.
     *
     * Instagram answers both agents with the same accounts/login redirect before sign-in, so its phone
     * layout is not distinguishable from the response alone; it is in this group because Instagram's phone
     * web build hands the user off to the phone app and has no direct inbox to render.
     *
     * A layout the user switched by hand always wins; see [HubApp.desktopSite].
     */
    fun defaultDesktop(app: HubApp): Boolean = app.desktopSite

    /**
     * Version of the rules that decide a fresh space's layout, stored per space as `layout-rule`.
     *
     * It exists so a later change of default can be applied once to spaces that never chose, without ever
     * being applied to the ones that did. Bump this — never the stored values' meaning — when a rule changes.
     */
    const val LAYOUT_RULE = 2

    /**
     * What the one-time layout migration must persist for one space, or `null` when it is already current.
     *
     * [desktop] is the value to store (`null` leaves the key alone) and [choice] says whether to record it
     * as the user's own decision.
     */
    data class LayoutPlan(val rule: Int, val desktop: Boolean?, val choice: Boolean)

    /**
     * Decides the layout migration for a space from what it already stores.
     *
     * The rule this encodes is the one the product promises: **a stored layout is never discarded.** Every
     * release so far writes `desktop-choice` at the same moment it writes `desktop`, so a `desktop` value
     * with no marker came from a build that predates the marker — and a default it wrote cannot be told
     * apart from a switch the owner flipped. Deleting it on that guess is how a migration silently moves a
     * space onto a layout its owner rejected, so the value is adopted as a choice instead. A space that has
     * never stored a layout gets the app's rule, which is the only case the migration may influence.
     *
     * Idempotent by construction: once `layout-rule` has been written, the next call returns `null`.
     */
    fun planLayout(storedRule: Int, storedDesktop: Boolean?, storedChoice: Boolean): LayoutPlan? {
        if (storedRule >= LAYOUT_RULE) return null
        return LayoutPlan(LAYOUT_RULE, storedDesktop, storedChoice || storedDesktop != null)
    }

    /**
     * What the hub's session diagnostics prints for the layout a space actually asked for, so the owner
     * can confirm on their own phone which site a slot opened without a debugger attached.
     */
    fun layoutDetail(app: HubApp, desktop: Boolean) =
        "${app.label} · " + if (desktop) "desktop site" else "phone site"

    /** Google's embedded-browser refusal, recognized from the page title without reading its body. */
    fun isEmbeddedSigninRefusal(app: HubApp, url: String, title: String?): Boolean {
        if (app.kind != HubApps.KIND_AI || !title.orEmpty().contains("browser", ignoreCase = true)) return false
        val host = try { URI(url).host?.lowercase(Locale.ROOT) } catch (_: Exception) { null }
        val heading = title.orEmpty()
        return host == "accounts.google.com" &&
            (heading.contains("not be secure", ignoreCase = true) ||
                heading.contains("not supported", ignoreCase = true) ||
                heading.contains("disallowed", ignoreCase = true))
    }

    fun isGoogleAuthRequest(url: String): Boolean = try {
        val uri = URI(url)
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals("accounts.google.com", ignoreCase = true) &&
            uri.rawUserInfo == null && (uri.port == -1 || uri.port == 443) &&
            uri.path.lowercase(Locale.ROOT).let { path ->
                path.startsWith("/signin") || path.startsWith("/servicelogin") || path.contains("/oauth")
            }
    } catch (_: Exception) { false }

    fun isGoogleMalformedAuthResponse(app: HubApp, url: String, statusCode: Int): Boolean =
        statusCode == 400 && allowedFor(app, url) && isGoogleAuthRequest(url)

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

    /**
     * The value an old per-activity preference file carries into a space's own preferences.
     *
     * The very old build wrote `desktop` only when the switch was flipped, so its presence is a real
     * choice; its *value* has to move across with it, or the space falls back to the app's default and the
     * owner's layout is lost while the app claims to have kept their choice.
     */
    fun legacyDesktopChoice(oldHasDesktop: Boolean, oldDesktop: Boolean): Boolean? =
        if (oldHasDesktop) oldDesktop else null

    /** Messenger's own allowlist, kept for callers that predate the per-app catalog. */
    fun allowedNavigation(url: String) = allowedFor(HubApps.MESSENGER, url)

    /** HTTPS links outside the embedded service stay out of the slot and may be handed to Android. */
    fun isSafeExternalHttps(url: String): Boolean = try {
        val uri = URI(url)
        uri.scheme.equals("https", ignoreCase = true) && uri.rawUserInfo == null &&
            (uri.port == -1 || uri.port == 443) && !uri.host.isNullOrBlank()
    } catch (_: Exception) { false }

    /** Keep the installed engine version; request the desktop site without inventing a Chrome version. */
    fun desktopAgent(defaultAgent: String): String = defaultAgent
        .replace(Regex("\\(Linux; Android[^)]*\\)"), "(X11; Linux x86_64)")
        .replace("; wv", "")
        .replace(Regex("Version/[0-9.]+ ?"), "")
        .replace(" Mobile", "")
}
