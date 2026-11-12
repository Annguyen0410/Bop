package com.example.twoaccmess

import android.app.AlertDialog
import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebViewDatabase
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebStorageCompat

class MessengerWebAActivity : MessengerWebActivity() { override val slot = AccountId.A }
class MessengerWebBActivity : MessengerWebActivity() { override val slot = AccountId.B }
class MessengerWebCActivity : MessengerWebActivity() { override val slot = AccountId.C }
class MessengerWebDActivity : MessengerWebActivity() { override val slot = AccountId.D }
class MessengerWebEActivity : MessengerWebActivity() { override val slot = AccountId.E }
class MessengerWebFActivity : MessengerWebActivity() { override val slot = AccountId.F }
class MessengerWebGActivity : MessengerWebActivity() { override val slot = AccountId.G }
class MessengerWebHActivity : MessengerWebActivity() { override val slot = AccountId.H }
class MessengerWebIActivity : MessengerWebActivity() { override val slot = AccountId.I }
class MessengerWebJActivity : MessengerWebActivity() { override val slot = AccountId.J }
class MessengerWebKActivity : MessengerWebActivity() { override val slot = AccountId.K }
class MessengerWebLActivity : MessengerWebActivity() { override val slot = AccountId.L }
class MessengerWebMActivity : MessengerWebActivity() { override val slot = AccountId.M }
class MessengerWebNActivity : MessengerWebActivity() { override val slot = AccountId.N }
class MessengerWebOActivity : MessengerWebActivity() { override val slot = AccountId.O }
class MessengerWebPActivity : MessengerWebActivity() { override val slot = AccountId.P }

class DynamicWebActivity : MessengerWebActivity() {
    override val slot: AccountId get() = AccountId.from(intent.getStringExtra(MessengerWeb.EXTRA_SLOT))
        ?.takeIf { !it.legacy } ?: error("Invalid dynamic space identifier")
}

object MessengerWeb {
    const val EXTRA_SLOT = "com.example.twoaccmess.SPACE_ID"
    /** Per-slot preference holding the conversation that slot was last in, so reopening it returns there. */
    const val THREAD_KEY = "thread"
    /** Intent extra naming the catalog app ([HubApps]) a slot should open. */
    const val EXTRA_APP = "com.example.twoaccmess.HUB_APP"
    /** Opens the slot only to erase its browser data, then closes; used when deleting a space. */
    const val EXTRA_CLEAR = "com.example.twoaccmess.CLEAR_SESSION"

    /** Each slot needs its own declared activity so Android gives it its own process and storage. */
    private fun activity(account: AccountId) = when (account) {
        AccountId.A -> MessengerWebAActivity::class.java
        AccountId.B -> MessengerWebBActivity::class.java
        AccountId.C -> MessengerWebCActivity::class.java
        AccountId.D -> MessengerWebDActivity::class.java
        AccountId.E -> MessengerWebEActivity::class.java
        AccountId.F -> MessengerWebFActivity::class.java
        AccountId.G -> MessengerWebGActivity::class.java
        AccountId.H -> MessengerWebHActivity::class.java
        AccountId.I -> MessengerWebIActivity::class.java
        AccountId.J -> MessengerWebJActivity::class.java
        AccountId.K -> MessengerWebKActivity::class.java
        AccountId.L -> MessengerWebLActivity::class.java
        AccountId.M -> MessengerWebMActivity::class.java
        AccountId.N -> MessengerWebNActivity::class.java
        AccountId.O -> MessengerWebOActivity::class.java
        AccountId.P -> MessengerWebPActivity::class.java
        else -> DynamicWebActivity::class.java
    }

    fun intent(context: Context, account: AccountId, app: HubApp = HubApps.DEFAULT) = Intent(context, activity(account)).apply {
        putExtra(EXTRA_APP, app.id)
        putExtra(EXTRA_SLOT, account.name)
        if (context !is android.app.Activity || !account.legacy) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    fun open(context: Context, account: AccountId, app: HubApp = HubApps.DEFAULT): String? {
        if (Build.VERSION.SDK_INT < WebSessionPolicy.MIN_ANDROID) return "Embedded web sessions need Android 9 or newer for separate browser storage."
        return if (HubPlatform.openSettings(context, intent(context, account, app))) null
        else "Android could not open ${app.label} in slot ${account.name}. Open TwoAccMess and try again."
    }

    /**
     * Erases one slot's browser data inside that slot's own process, which is the only place that can
     * reach its cookies and WebView profile. Deleting a space calls this first, then removes the slot;
     * opening a deleted slot is harmless because the activity only clears and finishes.
     */
    fun clear(context: Context, account: AccountId, app: HubApp = HubApps.DEFAULT): String? {
        if (Build.VERSION.SDK_INT < WebSessionPolicy.MIN_ANDROID) return "Embedded web sessions need Android 9 or newer for separate browser storage."
        val target = intent(context, account, app).putExtra(EXTRA_CLEAR, true)
        return if (HubPlatform.openSettings(context, target)) null
        else "Android could not clear ${app.label} in slot ${account.name}. Open TwoAccMess and try again."
    }
}

/**
 * Native WebChromeClient title events supply aggregate unread signals ([WebUnread]). No injected
 * script/bridge, DOM scraping, cookie reads or repeating monitor timer. Off-screen delivery is
 * best-effort only: Android and the website can suspend or terminate this session.
 */
abstract class MessengerWebActivity : ComponentActivity() {
    /** The one slot this declared activity owns; subclasses must name it so a copy-paste slip cannot
     *  quietly open slot A's storage for another slot. */
    abstract val slot: AccountId
    private lateinit var account: AccountId
    private var app: HubApp = HubApps.DEFAULT
    private lateinit var body: LinearLayout
    private lateinit var origin: TextView
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var controls: LinearLayout
    private var browser: WebView? = null
    /** A user-opened popup (Facebook message tools and identity-provider windows) in this slot's profile. */
    private var popup: WebView? = null
    private var popupDialog: Dialog? = null
    private var clearing = false
    private var resumed = false
    /** Starts on the fallback; [configure] then reads the space's own choice or its app's rule. */
    private var desktop = WebSessionPolicy.DEFAULT_DESKTOP_MODE
    private var tlsBlocked = false
    private var pageFailed = false
    /** Baseline established only after document load, not an intermediate login/loading title. */
    private val unread = WebUnread.Watch()
    private var titleReady = false
    private var browserConfigured = false
    /** True when this launch is a deletion: clear this slot's data, then close without reopening it. */
    private var finishAfterClear = false
    /** The conversation this slot was last in, so opening a space goes back to the chat, not to the inbox. */
    private var rememberedThread: String? = null
    private var uploadCallback: android.webkit.ValueCallback<Array<android.net.Uri>>? = null
    private val uploadPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        uploadCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        uploadCallback = null
    }
    private fun preferences() = getSharedPreferences("web-space-${slot.name}", MODE_PRIVATE)
    private fun getSpacePreferences(): android.content.SharedPreferences {
        val current = preferences()
        // Migrate old per-activity settings without touching its cookie directory. The very old build
        // wrote "desktop" only when the user flipped the switch there, so that value is a real choice and
        // its value — not just the fact of a choice — is carried across. Dropping the value would leave the
        // space on the app's default layout while claiming to have honoured the owner's switch.
        if (slot.legacy && !current.contains("migrated")) {
            val old = getPreferences(MODE_PRIVATE)
            val editor = current.edit().putBoolean("web-consent", old.getBoolean("web-consent", false))
                .putString("app", old.getString("app", null))
                .putBoolean("migrated", true)
            WebSessionPolicy.legacyDesktopChoice(old.contains("desktop"), old.getBoolean("desktop", false))
                ?.let { chosen -> editor.putBoolean("desktop", chosen).putBoolean("desktop-choice", true) }
            editor.apply()
        }
        // Layout rules changed (see [WebSessionPolicy.LAYOUT_RULE]). The plan never removes a stored
        // layout: a value the owner set outranks a new default, and a stored value that cannot be proven
        // to be a default is adopted as a choice rather than guessed away.
        val storedDesktop = if (current.contains("desktop")) current.getBoolean("desktop", false) else null
        val plan = WebSessionPolicy.planLayout(
            storedRule = current.getInt("layout-rule", 0),
            storedDesktop = storedDesktop,
            storedChoice = current.getBoolean("desktop-choice", false),
        )
        if (plan != null) {
            val editor = current.edit().putInt("layout-rule", plan.rule)
            if (plan.desktop != null) editor.putBoolean("desktop", plan.desktop)
            if (plan.choice) editor.putBoolean("desktop-choice", true)
            editor.apply()
        }
        return current
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Nothing on this path is allowed to kill the process: a failure must become readable text.
        var startupFailure: Throwable? = null
        try {
            super.onCreate(savedInstanceState)
        } catch (failure: Throwable) {
            startupFailure = failure
        }
        if (startupFailure != null) {
            blocked("Android could not create this screen", "The system refused to start the web session activity.", startupFailure)
            return
        }
        try {
            configure()
        } catch (failure: Throwable) {
            blocked("The web session hit an unexpected error", "This browser was closed before any login was attempted.", failure)
        }
    }

    /**
     * The conversation this slot was last in, read before the browser is created.
     *
     * Only a real conversation is ever restored: it is validated both as a thread address and against the
     * slot's own app, so a value written by another app — or a page that merely looked like one — can never
     * decide where this slot goes. Anything else falls back to the app's own entry point.
     */
    private fun startAddress(): String {
        val remembered = rememberedThread ?: return app.home
        return if (WebSessionPolicy.allowedFor(app, remembered)) remembered else app.home
    }

    /** Remembers a conversation for the next launch of this slot. Inbox, login and redirect pages are not
     *  conversations and never overwrite the one that was remembered. */
    private fun rememberThread(url: String) {
        if (!MessengerThread.isThread(url) || !WebSessionPolicy.allowedFor(app, url)) return
        if (rememberedThread != null && MessengerThread.sameThread(rememberedThread.orEmpty(), url)) return
        rememberedThread = url
        try { preferences().edit().putString(MessengerWeb.THREAD_KEY, url).apply() } catch (_: Exception) { /* a slot that cannot
            remember its place still works; the next launch just starts at the app's entry point */ }
    }

    private fun configure() {
        // No FLAG_SECURE here either: taking a screenshot of a web slot is allowed on purpose.
        val expected = slot
        if (Build.VERSION.SDK_INT < WebSessionPolicy.MIN_ANDROID) {
            blocked("Android version not supported", "Every web slot needs Android 9 or newer for its own browser storage; this device reports Android ${Build.VERSION.RELEASE}.", null)
            return
        }
        // No-op when the process prepared itself in attachBaseContext; still before any WebView here.
        try {
            WebSessionRuntime.prepare(application)
        } catch (failure: Throwable) {
            blocked("Browser storage could not be prepared", "Preparing a private browser directory failed before any page was loaded.", failure)
            return
        }
        val isolationFailure = WebSessionRuntime.isolationFailure
        if (isolationFailure != null) {
            blocked("Browser storage could not be isolated",
                "Android refused a separate WebView data directory ($isolationFailure). This session was not opened because the slots would otherwise share one cookie store.", null)
            return
        }
        if (expected.legacy && WebSessionRuntime.account != expected) {
            blocked("This session did not start in its own process",
                "Expected process ${WebSessionPolicy.processName(packageName, expected)} but found ${WebSessionRuntime.processName()}. The browser was not opened so two accounts cannot share one login.", null)
            return
        }
        if (!expected.legacy && !SpaceSessions.supported()) {
            blocked("Update your browser engine", "Additional spaces need Android System WebView or Chrome with multiple-profile support. No shared login was opened.", null)
            return
        }
        account = expected
        finishAfterClear = intent?.getBooleanExtra(MessengerWeb.EXTRA_CLEAR, false) == true
        // The hub passes the slot's app; its own preferences keep it after a clear or a restart. A
        // deletion launch does not write anything back: its preferences were just removed on purpose.
        app = HubApps.byId(intent?.getStringExtra(MessengerWeb.EXTRA_APP))
            ?: HubApps.byId(getSpacePreferences().getString("app", null))
            ?: HubApps.DEFAULT
        if (!finishAfterClear) getSpacePreferences().edit().putString("app", app.id).apply()
        desktop = getSpacePreferences().getBoolean("desktop", WebSessionPolicy.defaultDesktop(app))
        // The conversation this slot was last in, read before the browser exists so the very first address it
        // loads is that chat rather than the inbox behind it.
        rememberedThread = getSpacePreferences().getString(MessengerWeb.THREAD_KEY, null)?.takeIf { MessengerThread.isThread(it) }
        enableEdgeToEdge()
        createLayout()
        browserConfigured = true
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                popupDialog?.takeIf { it.isShowing }?.let { dialog ->
                    val child = popup
                    if (child?.canGoBack() == true) child.goBack() else dialog.dismiss()
                    return
                }
                val web = browser
                if (!clearing && web != null && web.canGoBack()) web.goBack() else finish()
            }
        })
        // A deletion launch is the one case that does not need the consent card: the slot is already
        // being removed, and clearing must work even though the hub erased its preferences first.
        if (finishAfterClear) {
            createBrowser()
            finishAfterClear = false
            if (browser == null) finish() else clearSession(reopen = false)
        } else if (getSpacePreferences().getBoolean("web-consent", false)) {
            createBrowser()
        } else showConsent()
    }

    /** Anything that stops this browser from working ends here: stored, shown, and copyable. */
    private fun blocked(title: String, message: String, failure: Throwable?) {
        val id = slot
        try {
            WebSessionRuntime.record(this, id, WebSessionReport.STAGE_ERROR, detail = "$title · $message")
        } catch (_: Throwable) {
            // Diagnostics only.
        }
        if (failure != null) {
            try {
                CrashLog.write(this, "web session ${id.name} · $title", failure)
            } catch (_: Throwable) {
                // Diagnostics only.
            }
        }
        val detail = buildString {
            appendLine(title)
            appendLine()
            appendLine(message)
            appendLine()
            append("Process ${WebSessionRuntime.processName()} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine()
            append("WebView ${WebSessionRuntime.engineVersion() ?: "unknown"} · isolation ${WebSessionRuntime.isolationFailure ?: "ok"}")
            if (failure != null) {
                appendLine()
                append("${failure.javaClass.name}: ${failure.message ?: "no message"}")
            }
        }
        if (::status.isInitialized) status.text = detail
        try {
            AlertDialog.Builder(this).setTitle(getString(R.string.web_session_unavailable))
                .setMessage(getString(R.string.web_unavailable_message, detail))
                .setPositiveButton(android.R.string.ok) { _, _ -> finish() }
                .setNeutralButton(getString(R.string.web_copy_details)) { _, _ -> copy(detail) }
                .setOnCancelListener { finish() }.show()
        } catch (_: Throwable) {
            try {
                Toast.makeText(this, detail, Toast.LENGTH_LONG).show()
            } catch (_: Throwable) {
                // Nothing left to show; finish quietly instead of crashing.
            }
            finish()
        }
    }

    private fun watchTitle(web: WebView) {
        if (!titleReady || pageFailed || tlsBlocked || !WebSessionPolicy.allowedFor(app, web.url.orEmpty())) return
        reportTitle(web.title)
        recordWatch(WebUnread.detail(running = resumed))
    }

    /** Diagnostics only: one small status write per install, per decision and per stop. Never content. */
    private fun recordWatch(detail: String) {
        try {
            WebSessionRuntime.record(this, account, WebSessionReport.STAGE_BROWSER, detail = detail)
        } catch (_: Throwable) {
            // Diagnostics must never be a reason for the session to fail.
        }
    }

    private fun reportTitle(title: String?) {
        val count = WebUnread.count(title)
        val move = unread.read(count)
        if (move == WebUnread.Move.NONE) return
        recordWatch(WebUnread.detail(running = resumed, move = move, unread = count))
        try {
            sendBroadcast(Intent(this, WebAlertReceiver::class.java)
                .setAction(WebAlertReceiver.ACTION)
                .putExtra(WebAlertReceiver.EXTRA_SLOT, slot.name)
                .putExtra(WebAlertReceiver.EXTRA_UNREAD, count)
                .putExtra(WebAlertReceiver.EXTRA_INCOMING, move == WebUnread.Move.RAISED))
        } catch (failure: RuntimeException) {
            CrashLog.write(this, "web unread broadcast", failure)
        }
    }

    private fun copy(text: String) {
        try {
            getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(getString(R.string.web_clip_label), text))
            Toast.makeText(this, getString(R.string.web_copied), Toast.LENGTH_SHORT).show()
        } catch (_: Throwable) {
            // Clipboard access is best effort.
        }
    }

    private fun createLayout() {
        val accent = app.accent
        val dark = HubThemeStore.dark(this)
        val palette = HubPalette.of(dark)
        // Accent header: the app and slot are readable before the page finishes loading.
        val headerTint = if (dark) HubPalette.blend(palette.browserBackground, accent, 0.35)
        else HubPalette.blend(Color.WHITE, accent, 0.22)
        body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(palette.browserBackground)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(headerTint)
            setPadding(dp(14), dp(10), dp(14), dp(10))
        }
        val heading = this@MessengerWebActivity.getString(R.string.web_slot_heading, app.label, account.name)
        header.addView(TextView(this).apply {
            text = heading
            textSize = 19f; setTextColor(palette.browserHeaderText); typeface = android.graphics.Typeface.DEFAULT_BOLD
            contentDescription = heading
        })
        origin = TextView(this).apply { textSize = 11f; setTextColor(palette.panelMuted); setPadding(0, dp(2), 0, 0) }
        header.addView(origin)
        body.addView(header)
        controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(8), dp(8), dp(8), 2) }
        button(getString(R.string.web_button_hub)) {
            if (HubPlatform.openSettings(this, Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))) finish()
        }
        button(getString(R.string.web_button_spaces)) { showSpaces() }
        button(getString(R.string.web_button_inbox)) { tlsBlocked = false; browser?.loadUrl(app.home) }
        button(getString(R.string.web_button_reload)) {
            tlsBlocked = false
            if (browser == null) createBrowser() else browser?.reload()
        }
        button(getString(R.string.web_button_options)) { showOptions() }
        body.addView(controls)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = android.content.res.ColorStateList.valueOf(accent)
        }
        body.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))
        status = TextView(this).apply { textSize = 12f; setTextColor(palette.panelMuted); setPadding(dp(14), dp(6), dp(14), dp(6)) }
        body.addView(status)
        setContentView(body)
        ViewCompat.setOnApplyWindowInsetsListener(body) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(body)
        origin.text = getString(R.string.web_origin_empty, app.label, account.name)
        status.text = getString(R.string.web_status_intro, app.label)
        status.visibility = View.GONE
    }

    /** Pill-shaped label instead of a stock button: same tap target, no platform chrome fighting the accent. */
    private fun button(label: String, click: () -> Unit) {
        val palette = HubPalette.of(HubThemeStore.dark(this))
        controls.addView(TextView(this).apply {
            text = label; textSize = 11.5f; gravity = android.view.Gravity.CENTER
            setTextColor(palette.browserControlText); contentDescription = label
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(14).toFloat()
                setColor(palette.browserControl)
                setStroke(dp(1), withAlpha(app.accent, 90))
            }
            isClickable = true; isFocusable = true
            setOnClickListener { click() }
        }, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginStart = dp(3); marginEnd = dp(3) })
    }

    private fun withAlpha(color: Int, alpha: Int) = Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))

    private fun showConsent() {
        AlertDialog.Builder(this).setTitle(getString(R.string.web_consent_title, account.name))
            .setMessage("You will sign in to ${app.label} on its own HTTPS website inside this app. Every slot uses its own browser storage, not the logins from any installed app. ${app.note}\n\nCookies, web cache and encrypted-chat key material may remain in app-private storage until you clear this session. Slots share the app's Android UID; this is not work-profile isolation.\n\nThe app does not read passwords, cookies or message contents. Login, encrypted history and messaging may not work in WebView. Off-screen web monitoring is best-effort only; Android may suspend or kill the session. No calls or full-history guarantee. Check the domain shown above the page. Never send your password or recovery PIN to us.")
            .setPositiveButton("Continue") { _, _ ->
                getSpacePreferences().edit().putBoolean("web-consent", true).apply()
                createBrowser()
            }.setNegativeButton("Cancel") { _, _ -> finish() }
            .setOnCancelListener { finish() }.show()
    }

    private fun createBrowser() {
        if (isFinishing || isDestroyed || browser != null) return
        val web = try {
            WebView(this)
        } catch (failure: Throwable) {
            blocked("The browser engine could not start",
                "Android could not create a WebView in this process. Check that Android System WebView (or Chrome) is enabled and up to date, then reopen this session.", failure)
            return
        }
        try { SpaceSessions.attach(web, account) }
        catch (failure: RuntimeException) {
            web.destroy()
            blocked("Browser profile unavailable", "The engine could not isolate this space. No login was opened.", failure)
            return
        }
        browser = web
        // Breadcrumb: if the process dies natively later, the stored status shows how far it got.
        WebSessionRuntime.record(this, account, WebSessionReport.STAGE_ENGINE, detail = "WebView instance created")
        try {
            prepare(web)
        } catch (failure: Throwable) {
            discardBrowser()
            blocked("The web session could not be set up", "Configuring the embedded browser failed before Meta's page finished loading.", failure)
            return
        }
        // The layout this slot really asked for, so the phone's own diagnostics can confirm it.
        WebSessionRuntime.record(this, account, WebSessionReport.STAGE_BROWSER, detail = WebSessionPolicy.layoutDetail(app, desktop))
    }

    private fun prepare(web: WebView) {
        web.setBackgroundColor(Color.WHITE)
        with(web.settings) {
            javaScriptEnabled = true // Meta's website requires JS; no native bridge is installed.
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            if (Build.VERSION.SDK_INT >= 26) safeBrowsingEnabled = true
            setSupportMultipleWindows(true) // Popups blocked; do not forward them to another account/browser.
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = true
            // Fit rules, in order of who wins:
            //  - the page's own viewport meta decides the layout width (device-width on the mobile site);
            //  - a page with no viewport meta is laid out wide and then scaled down to fit, never clipped;
            //  - textZoom is pinned so a device with a large system font or display size cannot inflate
            //    the layout past the screen — the page must fit whatever the phone's settings are;
            //  - pinch-zoom stays available as the last resort for anything that still overflows.
            useWideViewPort = true
            loadWithOverviewMode = true
            textZoom = 100
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            // AI sign-in providers reject embedded WebViews. Do not disguise the Android WebView as
            // desktop Chrome for those sites; the supported fallback opens the official site outside Bop.
            if (desktop && app.kind != HubApps.KIND_AI) userAgentString = WebSessionPolicy.desktopAgent(userAgentString)
        }
        SpaceSessions.cookies(web, account).apply { setAcceptCookie(true); setAcceptThirdPartyCookies(web, false) }
        web.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean,
                                       resultMsg: android.os.Message): Boolean {
                // Do not let a page open popups in the background. A real tap can open a bounded
                // in-app window, attached to this slot's WebView profile, so auth cookies and the
                // window.opener flow stay inside the correct account.
                if (view !== browser || clearing) return false
                if (!isUserGesture) return false
                if (popup != null) {
                    // One at a time. Say why the tap did nothing instead of dropping it silently, because
                    // the tap the user just made is the one an auth dialog asked for.
                    status.visibility = View.VISIBLE
                    status.text = "Close the sign-in window that is already open, then tap again."
                    return false
                }
                return try {
                    showPopup(resultMsg)
                    true
                } catch (failure: Throwable) {
                    status.visibility = View.VISIBLE
                    status.text = "This page's sign-in window could not open. Use Options → Open outside Bop."
                    WebSessionRuntime.failure(this@MessengerWebActivity, account, "opening a site popup", failure)
                    false
                }
            }
            override fun onCloseWindow(window: WebView) {
                if (window === popup) popupDialog?.dismiss()
            }
            override fun onReceivedTitle(view: WebView, title: String?) {
                if (view === browser && titleReady && !pageFailed && !tlsBlocked &&
                    WebSessionPolicy.allowedFor(app, view.url.orEmpty())) reportTitle(title)
            }
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress < 100) View.VISIBLE else View.INVISIBLE
            }
            override fun onShowFileChooser(view: WebView, callback: android.webkit.ValueCallback<Array<android.net.Uri>>,
                                           parameters: FileChooserParams): Boolean {
                uploadCallback?.onReceiveValue(null)
                uploadCallback = callback
                try { uploadPicker.launch(parameters.createIntent()) }
                catch (_: android.content.ActivityNotFoundException) {
                    uploadCallback?.onReceiveValue(null); uploadCallback = null
                    status.visibility = View.VISIBLE; status.text = getString(R.string.web_picker_unavailable)
                }
                return true
            }
            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny()
                status.visibility = View.VISIBLE
                status.text = getString(R.string.web_status_media_disabled)
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (WebSessionPolicy.allowedFor(app, request.url.toString())) return false
                if (WebSessionPolicy.isSafeExternalHttps(request.url.toString())) {
                    openOutside(request.url.toString())
                    return true
                }
                status.visibility = View.VISIBLE
                status.text = "This destination cannot open inside Bop. Use Options → Open outside Bop for a web link."
                return true
            }
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.isForMainFrame && !WebSessionPolicy.allowedFor(app, request.url.toString())) {
                    return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(),
                        "Only HTTPS pages of ${app.label} are allowed in this slot.".byteInputStream())
                }
                return null
            }
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                pageFailed = false
                status.setOnClickListener(null)
                // A new page starts its own baseline, so unread it already had is not "just arrived".
                unread.forget()
                titleReady = false
                status.visibility = View.VISIBLE
                if (!WebSessionPolicy.allowedFor(app, url)) {
                    view.stopLoading(); pageFailed = true
                    origin.text = getString(R.string.web_origin_blocked, app.label, account.name)
                    status.text = getString(R.string.web_status_blocked_page, app.label)
                } else {
                    // Display origin only: query parameters can contain authentication secrets.
                    origin.text = getString(R.string.web_origin_page, java.net.URI(url).host)
                    status.text = getString(R.string.web_status_loading, app.label)
                }
            }
            override fun onPageFinished(view: WebView, url: String) {
                rememberThread(url)
                if (!pageFailed && !tlsBlocked && WebSessionPolicy.allowedFor(app, url)) {
                    titleReady = true;
                    if (WebSessionPolicy.isEmbeddedSigninRefusal(app, url, view.title)) {
                        status.visibility = View.VISIBLE
                        status.text = "This provider blocks embedded sign-in. Tap here to open ${app.label} in your browser."
                        status.setOnClickListener { confirmOpenAiInBrowser() }
                        return
                    }
                    status.text = getString(R.string.web_status_ready, app.label, account.name)
                    status.visibility = View.GONE
                    watchTitle(view)
                }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                if (request.isForMainFrame) {
                    pageFailed = true
                    status.text = getString(R.string.web_status_page_failed)
                }
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame) {
                    pageFailed = true
                    if (WebSessionPolicy.isGoogleMalformedAuthResponse(app, request.url.toString(), response.statusCode)) {
                        status.visibility = View.VISIBLE
                        status.text = "Google rejected this sign-in request (400). Tap here to restart ${app.label} in your system browser."
                        status.setOnClickListener { openOutside(app.home) }
                    } else {
                        status.text = getString(R.string.web_status_http_error, response.statusCode)
                    }
                }
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                tlsBlocked = true; pageFailed = true
                status.visibility = View.VISIBLE
                status.text = getString(R.string.web_status_tls)
            }
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                popupDialog?.dismiss()
                discardBrowser()
                status.visibility = View.VISIBLE
                status.text = getString(R.string.web_status_renderer_gone)
                return true
            }
        }
        web.setDownloadListener { _, _, _, _, _ ->
            status.visibility = View.VISIBLE
            status.text = getString(R.string.web_status_downloads_disabled)
        }
        body.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        web.loadUrl(startAddress())
        if (resumed) web.onResume() else web.onPause()
        if (resumed && account.legacy) web.resumeTimers()
    }

    /** Displays one popup at a time, with the same isolated profile and the same HTTPS host policy. */
    private fun showPopup(resultMsg: android.os.Message) {
        val child = WebView(this)
        try {
            SpaceSessions.attach(child, account)
            child.settings.javaScriptEnabled = true
            child.settings.domStorageEnabled = true
            child.settings.allowFileAccess = false
            child.settings.allowContentAccess = false
            child.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            child.settings.setSupportMultipleWindows(false)
            child.settings.javaScriptCanOpenWindowsAutomatically = false
            child.settings.useWideViewPort = true
            child.settings.loadWithOverviewMode = true
            child.settings.textZoom = 100
            if (desktop && app.kind != HubApps.KIND_AI) child.settings.userAgentString = WebSessionPolicy.desktopAgent(child.settings.userAgentString)
            SpaceSessions.cookies(child, account).apply { setAcceptCookie(true); setAcceptThirdPartyCookies(child, false) }
        } catch (failure: Throwable) {
            child.destroy()
            throw failure
        }
        val frame = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val heading = TextView(this).apply {
            text = "${app.label} · Space ${account.name} · Sign-in window"
            textSize = 14f
            setPadding(dp(16), dp(12), dp(8), dp(12))
        }
        val close = TextView(this).apply {
            text = "Close"
            textSize = 14f
            gravity = android.view.Gravity.CENTER
            setPadding(dp(16), dp(8), dp(16), dp(8))
            setOnClickListener { popupDialog?.dismiss() }
        }
        frame.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(heading, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(close)
        })
        frame.addView(child, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        val dialog = Dialog(this).apply {
            setContentView(frame)
            setOnDismissListener { disposePopup(child) }
        }
        popup = child
        popupDialog = dialog
        child.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (WebSessionPolicy.allowedFor(app, request.url.toString())) return false
                if (WebSessionPolicy.isSafeExternalHttps(request.url.toString())) openOutside(request.url.toString())
                else {
                    status.visibility = View.VISIBLE
                    status.text = "The sign-in window tried to open an unsupported destination."
                }
                dialog.dismiss()
                return true
            }
            override fun onReceivedSslError(view: WebView, handler: android.webkit.SslErrorHandler, error: SslError) {
                handler.cancel()
                status.visibility = View.VISIBLE
                status.text = getString(R.string.web_status_tls)
                dialog.dismiss()
            }
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                dialog.dismiss()
                return true
            }
        }
        @Suppress("DEPRECATION")
        (resultMsg.obj as WebView.WebViewTransport).webView = child
        resultMsg.sendToTarget()
        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, (resources.displayMetrics.heightPixels * 0.82f).toInt())
    }

    private fun disposePopup(child: WebView) {
        if (popup === child) popup = null
        if (popupDialog?.isShowing != true) popupDialog = null
        try {
            child.stopLoading()
            (child.parent as? ViewGroup)?.removeView(child)
            child.destroy()
        } catch (_: Throwable) {
            // Popup cleanup must not take down the owning account session.
        }
    }

    private fun openOutside(url: String) {
        if (!WebSessionPolicy.isSafeExternalHttps(url)) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)))
        } catch (_: android.content.ActivityNotFoundException) {
            status.visibility = View.VISIBLE
            status.text = "No browser can open this link."
        }
    }

    private fun showOptions() {
        if (clearing) return
        try {
            AlertDialog.Builder(this).setTitle(getString(R.string.web_options_title, account.name))
                .setItems((listOf(
                    getString(R.string.web_options_fit),
                    if (app.kind == HubApps.KIND_AI) "Sign-in limitation"
                    else getString(if (desktop) R.string.web_options_mobile else R.string.web_options_desktop),
                    getString(R.string.web_options_clear, account.name),
                    getString(R.string.web_options_copy),
                    getString(R.string.web_options_about)) + when {
                    app.id == HubApps.MESSENGER_ID -> listOf("Open Messenger app", "Open outside Bop")
                    app.kind == HubApps.KIND_AI -> listOf("Open AI site in browser")
                    else -> listOf("Open outside Bop")
                }).toTypedArray()) { _, index ->
                    when (index) {
                        0 -> fitToScreen()
                        1 -> if (app.kind == HubApps.KIND_AI) {
                            AlertDialog.Builder(this)
                                .setTitle("Embedded sign-in is restricted")
                                .setMessage("Google and some other providers do not allow sign-in inside embedded browsers. Open the official site in your browser; its account session cannot be transferred into this Bop space.")
                                .setPositiveButton("Open AI site in browser") { _, _ -> openOutside(app.home) }
                                .setNegativeButton(android.R.string.cancel, null)
                                .show()
                        } else {
                            desktop = !desktop
                            getSpacePreferences().edit().putBoolean("desktop", desktop)
                                .putBoolean("desktop-choice", true).apply()
                            browser?.settings?.userAgentString = if (desktop)
                                WebSessionPolicy.desktopAgent(android.webkit.WebSettings.getDefaultUserAgent(this))
                            else android.webkit.WebSettings.getDefaultUserAgent(this)
                            tlsBlocked = false; browser?.reload()
                        }
                        2 -> confirmClear()
                        3 -> copy(WebSessionReport.diagnostics(platformLine(), CrashLog.read(this),
                            SpaceSessions.index(this).map { it.first to WebSessionRuntime.read(this, it.first) }))
                        4 -> AlertDialog.Builder(this).setTitle(getString(R.string.web_options_about_title))
                            .setMessage(getString(R.string.web_options_about_message, app.label, app.note))
                            .setPositiveButton(android.R.string.ok, null).show()
                        5 -> when {
                            app.id == HubApps.MESSENGER_ID -> openOfficialMessenger()
                            app.kind == HubApps.KIND_AI -> confirmOpenAiInBrowser()
                            else -> openOutside(browser?.url ?: app.home)
                        }
                        6 -> if (app.id == HubApps.MESSENGER_ID) openOutside(browser?.url ?: app.home)
                    }
                }.show()
        } catch (failure: Throwable) {
            WebSessionRuntime.failure(this, account, "opening options", failure)
            status.text = getString(R.string.web_status_options_failed, failure.javaClass.simpleName)
        }
    }

    private fun openOfficialMessenger() {
        val launch = try { packageManager.getLaunchIntentForPackage("com.facebook.orca") } catch (_: Throwable) { null }
        if (launch != null) {
            try { startActivity(launch) } catch (_: android.content.ActivityNotFoundException) { openOutside(browser?.url ?: app.home) }
        } else openOutside(browser?.url ?: app.home)
    }

    private fun confirmOpenAiInBrowser() {
        AlertDialog.Builder(this)
            .setTitle("Open ${app.label} in your browser?")
            .setMessage("Google and some other sign-in providers block embedded browsers. This opens the official ${app.label} home page in your browser. Start a fresh sign-in there; do not retry the old Google callback URL. The browser's session cannot be transferred into this Bop space.")
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton("Open browser") { _, _ -> openOutside(app.home) }
            .show()
    }

    /**
     * The escape hatch for "the page's own dialog put its close button outside my screen". It restores
     * every fit rule, drops text inflation, and then loads the page fresh: a new document is what clears
     * a pinch-zoom that survived across a reload, which is why this is not just `reload()`.
     */
    private fun fitToScreen() {
        val web = browser ?: return
        try {
            with(web.settings) {
                useWideViewPort = true
                loadWithOverviewMode = true
                textZoom = 100
                setSupportZoom(true)
                builtInZoomControls = true
            }
            web.setInitialScale(0)
            tlsBlocked = false
            status.visibility = View.VISIBLE
            status.text = getString(R.string.web_status_fitted)
            web.loadUrl(web.url ?: app.home)
        } catch (failure: Throwable) {
            WebSessionRuntime.failure(this, account, "fitting the page to the screen", failure)
            status.visibility = View.VISIBLE
            status.text = getString(R.string.web_status_options_failed, failure.javaClass.simpleName)
        }
    }

    private fun platformLine(): String {
        val version = try {
            packageManager.getPackageInfo(packageName, 0).versionName
        } catch (_: Throwable) {
            "unknown"
        }
        return "Bop $version · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL}"
    }

    private fun confirmClear() {
        AlertDialog.Builder(this).setTitle(getString(R.string.web_clear_title, account.name))
            .setMessage(getString(R.string.web_clear_message))
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(getString(R.string.web_clear_confirm)) { _, _ -> clearSession() }.show()
    }

    /** `reopen = false` is the deletion path: erase, then close instead of showing a fresh sign-in page. */
    private fun clearSession(reopen: Boolean = true) {
        clearing = true
        popupDialog?.dismiss()
        for (index in 0 until controls.childCount) controls.getChildAt(index).isEnabled = false
        status.text = getString(R.string.web_clearing, account.name)
        if (!account.legacy) {
            clearProfileSession(reopen)
            return
        }
        try {
            browser?.apply { stopLoading(); clearCache(true); clearHistory(); clearSslPreferences() }
        } catch (failure: Throwable) {
            WebSessionRuntime.failure(this, account, "clearing the browser cache", failure)
        }
        discardBrowser()
        // Each step is independent: one failing API must not leave the other stores behind.
        for (step in listOf<Pair<String, () -> Unit>>(
            "website storage" to { WebStorage.getInstance().deleteAllData() },
            "HTTP authentication cache" to { WebViewDatabase.getInstance(this).clearHttpAuthUsernamePassword() },
        )) {
            try {
                step.second()
            } catch (failure: Throwable) {
                WebSessionRuntime.failure(this, account, "clearing ${step.first}", failure)
            }
        }
        try {
            CookieManager.getInstance().removeAllCookies {
                try {
                    CookieManager.getInstance().flush()
                } catch (_: Throwable) {
                    // Flush is best effort.
                }
                clearing = false
                if (!reopen) {
                    if (!isFinishing && !isDestroyed) finish()
                    return@removeAllCookies
                }
                if (!isFinishing && !isDestroyed) {
                    for (index in 0 until controls.childCount) controls.getChildAt(index).isEnabled = true
                    tlsBlocked = false
                    try {
                        createBrowser()
                    } catch (failure: Throwable) {
                        blocked("The web session could not be reopened", "Clearing finished, but the browser did not restart.", failure)
                    }
                    Toast.makeText(this, "Local web session ${account.name} cleared", Toast.LENGTH_SHORT).show()
                }
            }
        } catch (failure: Throwable) {
            WebSessionRuntime.failure(this, account, "clearing cookies", failure)
            clearing = false
            if (!reopen) { if (!isFinishing && !isDestroyed) finish(); return }
            blocked("Cookies could not be cleared", "Stop using this session until you can clear it from Setup, or clear the app's storage in Android settings.", failure)
        }
    }

    private fun showSpaces() {
        val spaces = SpaceSessions.index(this)
        if (spaces.isEmpty()) { status.visibility = View.VISIBLE; status.text = getString(R.string.web_spaces_empty); return }
        AlertDialog.Builder(this).setTitle("Your spaces")
            .setItems(spaces.map { (id, app) -> "${id.name} · ${app.label}" }.toTypedArray()) { _, index ->
                val (id, targetApp) = spaces[index]
                if (id != account) {
                    val error = MessengerWeb.open(this, id, targetApp)
                    if (error != null) { status.visibility = View.VISIBLE; status.text = error }
                    else if (account.legacy || id.legacy) finish()
                }
            }.show()
    }

    private fun clearProfileSession(reopen: Boolean = true) {
        val web = browser
        if (web == null) {
            clearing = false
            for (i in 0 until controls.childCount) controls.getChildAt(i).isEnabled = true
            if (!reopen && !isFinishing && !isDestroyed) finish()
            return
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
            val storage = WebViewCompat.getProfile(web).webStorage
            discardBrowser()
            try {
                if (WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
                    WebStorageCompat.deleteBrowsingData(storage) {
                        clearing = false
                        if (!reopen) {
                            if (!isFinishing && !isDestroyed) finish()
                            return@deleteBrowsingData
                        }
                        if (!isFinishing && !isDestroyed) {
                            for (i in 0 until controls.childCount) controls.getChildAt(i).isEnabled = true
                            tlsBlocked = false; createBrowser()
                            Toast.makeText(this, getString(R.string.web_space_cleared, account.name), Toast.LENGTH_SHORT).show()
                        }
                    }
                } else error("Profile-specific deletion became unavailable")
            } catch (failure: RuntimeException) {
                clearing = false
                if (!reopen) { if (!isFinishing && !isDestroyed) finish(); return }
                blocked("Space could not be cleared", "The browser engine refused profile-specific deletion. Other spaces were not touched.", failure)
            }
        } else {
            clearing = false
            for (i in 0 until controls.childCount) controls.getChildAt(i).isEnabled = true
            if (!reopen) { if (!isFinishing && !isDestroyed) finish(); return }
            status.visibility = View.VISIBLE
            status.text = getString(R.string.web_clear_update_required)
        }
    }

    private fun discardBrowser() {
        val web = browser ?: return
        browser = null
        titleReady = false
        try {
            web.stopLoading()
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        } catch (_: Throwable) {
            // A half-destroyed WebView must not take the process down with it.
        }
    }

    override fun onResume() {
        super.onResume(); resumed = true
        // A crashed/destroyed renderer can be reopened with the same cookie/profile on user return.
        // No off-screen retry timer or process keepalive is introduced.
        if (browserConfigured && !clearing && browser == null &&
            getSpacePreferences().getBoolean("web-consent", false)) createBrowser()
        try {
            popup?.onResume()
            browser?.apply {
                onResume(); if (account.legacy) resumeTimers()
                // Back on screen: one reading from wherever the marker stands now, so a message that
                // arrived during the break is still reported as new rather than as unread seen before.
                watchTitle(this)
            }
        } catch (_: Throwable) {
            // Rendering can restart with the next Reload.
        }
    }
    override fun onPause() {
        // Native callbacks have no repeating Bop work to stop. WebView background delivery remains
        // best-effort and is not promised by keeping cookies/profile metadata.
        try {
            popup?.onPause()
            browser?.apply {
                recordWatch(WebUnread.detail(running = false))
                // Pause rendering; do not globally pause every profile's website timers. No Bop timer
                // remains. Android/WebView decides what survives off screen; no wake lock/service.
                onPause(); SpaceSessions.cookies(this, account).flush()
            }
        } catch (_: Throwable) {
            // Ignore; the session keeps its cookies on disk.
        }
        resumed = false; super.onPause()
    }
    override fun onStop() {
        // Do not abort another account's in-flight load just because its Activity is hidden.
        // There is still no guarantee that Android keeps this WebView/process alive.
        super.onStop()
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        uploadCallback?.onReceiveValue(null); uploadCallback = null
        popupDialog?.dismiss()
        discardBrowser()
        setIntent(intent)
        recreate()
    }
    override fun onDestroy() {
        uploadCallback?.onReceiveValue(null); uploadCallback = null
        popupDialog?.dismiss()
        discardBrowser()
        super.onDestroy()
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
}
