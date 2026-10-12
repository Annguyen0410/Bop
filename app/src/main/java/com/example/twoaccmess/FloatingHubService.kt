package com.example.twoaccmess

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.min

/**
 * The user-started overlay: a small round bubble that opens one embedded web session per slot.
 * It shows the picture the user picked (or the account letter), a badge with the number of observed
 * chats, and a menu that names each account. It never keeps an app alive and never scrapes a page.
 *
 * Two overlay windows keep the promise the user asked for in 1.6: the bubble lives in its own window
 * whose position is only ever changed by a drag, and the account menu is a second window placed next
 * to it. Opening or closing the menu (or a web session, or any state refresh) therefore cannot move
 * the bubble; it stays exactly where it was left and that spot is what gets persisted.
 */
class FloatingHubService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var manager: WindowManager
    private var bubble: FrameLayout? = null
    private var bubbleParameters: WindowManager.LayoutParams? = null
    private var panel: LinearLayout? = null
    private var panelParameters: WindowManager.LayoutParams? = null
    private var anchor = BubbleSpot(0, 0)
    private var expanded = false
    private var receiverRegistered = false
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF) {
                HubRepository.clearPreviews()
                HubNotifications.clear(context)
                setExpanded(false)
                bubble?.visibility = View.GONE
            } else if (!HubRepository.isLocked(context)) {
                bubble?.visibility = View.VISIBLE
                HubNotificationListener.refresh()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        manager = getSystemService(WindowManager::class.java)
        scope.launch { HubRepository.state.collect { if (bubble != null) render(it) } }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) { stopSelf(); return START_NOT_STICKY }
        // REFRESH only re-reads the stored bubble picture; it is sent while the bubble is running.
        if (intent?.action != START && intent?.action != REFRESH || !HubRepository.state.value.ready ||
            !HubRepository.state.value.disclosureAccepted || !Settings.canDrawOverlays(this) || !HubPlatform.canNotify(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            HubNotifications.createChannels(this, HubRepository.state.value.slots)
            if (Build.VERSION.SDK_INT >= 34) startForeground(900, controlNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(900, controlNotification())
            if (bubble == null) attach()
            // A picture change arrives as REFRESH with no state change, so re-render on purpose.
            else if (intent?.action == REFRESH) render(HubRepository.state.value)
            HubRepository.overlay(true)
        } catch (_: SecurityException) { stopSelf() }
        catch (_: WindowManager.BadTokenException) { stopSelf() }
        if (!receiverRegistered && bubble != null) {
            ContextCompat.registerReceiver(this, screenReceiver, IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_USER_PRESENT)
            }, ContextCompat.RECEIVER_EXPORTED)
            receiverRegistered = true
        }
        return START_NOT_STICKY
    }

    /** Rotation or a display-size change: keep the bubble on screen at the same relative spot. */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val moved = BubbleGeometry.dock(anchor, dp(BUBBLE_DP), screenWidth, screenHeight, dp(MARGIN_DP))
        applyAnchor(moved)
        store(moved)
        if (expanded) render(HubRepository.state.value)
    }

    private fun controlNotification(): Notification {
        val stop = PendingIntent.getService(this, 900, Intent(this, FloatingHubService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 901, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, HubNotifications.CONTROL_CHANNEL)
            .setSmallIcon(R.drawable.ic_hub).setContentTitle(getString(R.string.bubble_control_title))
            .setContentText(getString(R.string.bubble_control_text))
            .setOngoing(true).setSilent(true).setContentIntent(open)
            .addAction(0, getString(R.string.bubble_control_stop), stop).build()
    }

    private fun attach() {
        val preferences = getSharedPreferences(BUBBLE_PREFERENCES, MODE_PRIVATE)
        val restored = BubbleGeometry.dock(BubbleGeometry.restore(preferences.getFloat("x", DEFAULT_X), preferences.getFloat("y", DEFAULT_Y),
            dp(BUBBLE_DP), screenWidth, screenHeight), dp(BUBBLE_DP), screenWidth, screenHeight, dp(MARGIN_DP))
        val handle = FrameLayout(this)
        bubble = handle
        bubbleParameters = WindowManager.LayoutParams(
            dp(BUBBLE_DP), dp(BUBBLE_DP),
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START; flags = flags or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN }
        dragHandle(handle)
        handle.visibility = if (HubRepository.isLocked(this)) View.GONE else View.VISIBLE
        applyAnchor(restored)
        // Persist the very first spot too, so a restart cannot fall back to a default while the user
        // believes the bubble already remembers where it is.
        store(restored)
        try {
            manager.addView(handle, bubbleParameters)
        } catch (_: SecurityException) { stopSelf(); return }
        catch (_: WindowManager.BadTokenException) { stopSelf(); return }
        render(HubRepository.state.value)
    }

    private fun render(state: HubState) {
        val handle = bubble ?: return
        if (!Settings.canDrawOverlays(this) || !HubPlatform.canNotify(this)) { stopSelf(); return }
        renderBubble(handle, state)
        if (expanded) showPanel(state) else hidePanel()
    }

    /** Small round handle: the user's picture when set, otherwise the letter of the loudest account. */
    private fun renderBubble(handle: FrameLayout, state: HubState) {
        handle.removeAllViews()
        val palette = HubPalette.of(HubThemeStore.dark(this))
        val total = state.slots.sumOf { state.pending(it) }
        val loudest = state.slots.firstOrNull { state.pending(it) > 0 }
        handle.contentDescription = resources.getQuantityString(R.plurals.bubble_content_description, total, total)
        handle.elevation = dp(8).toFloat()
        handle.setPadding(0, 0, 0, 0)
        handle.background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(palette.bubble)
            // A ring in the loudest account's colour doubles as the frame of the picture.
            setStroke(dp(2), if (total > 0 && loudest != null) AccountAlerts.accent(loudest) else palette.bubbleRing)
        }
        val picture = AvatarStore.read(this, AvatarPolicy.BUBBLE)
        if (picture != null) {
            handle.addView(ImageView(this).apply {
                setImageDrawable(AvatarStore.circular(this@FloatingHubService, picture))
                // Center crop inside a square frame: the picture is never stretched to fit.
                scaleType = ImageView.ScaleType.CENTER_CROP
                contentDescription = null
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        } else {
            handle.addView(ImageView(this).apply {
                setImageResource(R.drawable.bop_avatar)
                scaleType = ImageView.ScaleType.CENTER_CROP
                clipToOutline = true
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(palette.bubble) }
                contentDescription = null
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        AccountAlerts.badge(total)?.let { label ->
            handle.addView(TextView(this).apply {
                text = label; setTextColor(palette.badgeText); textSize = 10f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL; setColor(palette.badge); setStroke(dp(1), Color.WHITE)
                }
                contentDescription = null
            }, FrameLayout.LayoutParams(dp(19), dp(19), Gravity.TOP or Gravity.END))
        }
    }

    /** The account menu: its own window, placed next to the bubble, never moving the bubble itself. */
    private fun showPanel(state: HubState) {
        val palette = HubPalette.of(HubThemeStore.dark(this))
        val host = panel ?: LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), dp(8), dp(10), dp(8))
            elevation = dp(14).toFloat()
        }
        host.background = GradientDrawable().apply { setColor(palette.panel); cornerRadius = dp(20).toFloat() }
        panel = host
        host.removeAllViews()
        host.addView(panelHeader(state), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34)))
        val used = state.slots.size
        val rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        state.slots.forEach { id ->
            rows.addView(accountRow(state, state.account(id)), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(ROW_DP)))
        }
        host.addView(ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            addView(rows, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(min(used, MAX_ROWS) * ROW_DP)))
        host.addView(Button(this).apply {
            text = getString(R.string.bubble_open_hub); textSize = 13f; minHeight = 0; minimumHeight = 0
            setTextColor(HubPalette.onColor(AccountAlerts.accent(state.slots.firstOrNull() ?: AccountId.A)))
            background = pill(AccountAlerts.accent(state.slots.firstOrNull() ?: AccountId.A))
            // Platform themes tint stock buttons; the pill colour above is deliberate.
            backgroundTintList = null
            setOnClickListener {
                setExpanded(false)
                HubPlatform.openSettings(this@FloatingHubService,
                    Intent(this@FloatingHubService, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)).apply { topMargin = dp(6) })
        host.addView(Button(this).apply {
            text = getString(R.string.bubble_stop); textSize = 13f; minHeight = 0; minimumHeight = 0
            setTextColor(palette.panelMuted)
            background = pill(palette.panelSecondary)
            backgroundTintList = null
            setOnClickListener { stopSelf() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)).apply { topMargin = dp(4) })
        placePanel(host)
    }

    private fun panelHeader(state: HubState): View = LinearLayout(this).apply {
        val palette = HubPalette.of(HubThemeStore.dark(this@FloatingHubService))
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(TextView(this@FloatingHubService).apply {
            text = getString(R.string.bubble_menu_title, state.slots.size)
            setTextColor(palette.panelText); textSize = 12f; typeface = Typeface.DEFAULT_BOLD
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(TextView(this@FloatingHubService).apply {
            text = "✕"; setTextColor(palette.panelMuted); textSize = 15f; gravity = Gravity.CENTER
            contentDescription = getString(R.string.bubble_menu_close)
            setPadding(dp(10), 0, dp(4), 0)
            setOnClickListener { setExpanded(false) }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    /** Measures the panel, then parks it beside the bubble without ever touching the bubble's window. */
    private fun placePanel(host: LinearLayout) {
        val width = min(dp(PANEL_DP), (screenWidth - 2 * dp(8)).coerceAtLeast(1))
        host.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
        val height = min(host.measuredHeight, (screenHeight - 2 * dp(MARGIN_DP)).coerceAtLeast(dp(160)))
        val spot = BubbleGeometry.panel(anchor, dp(BUBBLE_DP), width, height, dp(PANEL_GAP_DP), screenWidth, screenHeight, dp(MARGIN_DP))
        val params = panelParameters ?: WindowManager.LayoutParams(
            width, ViewGroup.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START }.also { panelParameters = it }
        params.height = height
        params.x = windowX(spot.x, width)
        params.y = spot.y
        try {
            if (host.isAttachedToWindow) manager.updateViewLayout(host, params) else manager.addView(host, params)
        } catch (_: SecurityException) { stopSelf() }
        catch (_: WindowManager.BadTokenException) { stopSelf() }
    }

    private fun hidePanel() {
        val host = panel ?: return
        panel = null
        try {
            if (host.isAttachedToWindow) manager.removeView(host)
        } catch (_: SecurityException) { stopSelf() }
        catch (_: WindowManager.BadTokenException) { stopSelf() }
    }

    /** One tappable row per slot: avatar, account name, and how many chats it is holding. */
    private fun accountRow(state: HubState, account: AccountBinding): View {
        val id = account.accountId
        val palette = HubPalette.of(HubThemeStore.dark(this))
        val pending = state.pending(id)
        val accent = AccountAlerts.accent(id)
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isClickable = true
            setPadding(dp(6), 0, dp(6), 0)
            contentDescription = if (pending > 0)
                resources.getQuantityString(R.plurals.bubble_row_description_pending, pending, account.app.label, id.name, pending)
            else getString(R.string.bubble_row_description, account.app.label, id.name)
            background = GradientDrawable().apply {
                cornerRadius = dp(14).toFloat()
                setColor(if (pending > 0) withAlpha(accent, (255 * palette.rowHighlight).toInt()) else Color.TRANSPARENT)
            }
            setOnClickListener {
                setExpanded(false)
                val error = MessengerWeb.open(this@FloatingHubService, id, account.app)
                if (error != null) Toast.makeText(this@FloatingHubService, error, Toast.LENGTH_LONG).show()
            }
        }
        row.addView(avatarChip(id, accent), LinearLayout.LayoutParams(dp(30), dp(30)))
        row.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), 0, 0, 0)
            addView(TextView(this@FloatingHubService).apply {
                text = account.label
                maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
                setTextColor(palette.panelText); textSize = 14f; typeface = Typeface.DEFAULT_BOLD
            })
            addView(TextView(this@FloatingHubService).apply {
                text = when {
                    pending > 0 -> resources.getQuantityString(R.plurals.bubble_row_new_chats, pending, pending)
                    account.profileSerial != null -> getString(R.string.bubble_row_bound)
                    else -> account.app.label
                }
                setTextColor(if (pending > 0) palette.badge else palette.panelMuted); textSize = 11f
            })
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        return row
    }

    private fun avatarChip(id: AccountId, accent: Int): View {
        val picture = AvatarStore.read(this, AvatarPolicy.slot(id))
        return if (picture != null) ImageView(this).apply {
            setImageDrawable(AvatarStore.circular(this@FloatingHubService, picture))
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setStroke(dp(1), withAlpha(accent, 150)) }
            contentDescription = getString(R.string.bubble_avatar_description, id.name)
        } else TextView(this).apply {
            // The letter is painted in whichever of black/white stays readable on this accent.
            text = id.name; setTextColor(HubPalette.onColor(accent)); textSize = 13f
            typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(accent) }
        }
    }

    private fun dragHandle(handle: View) {
        var startX = 0; var startY = 0; var downX = 0f; var downY = 0f; var dragged = false
        handle.setOnTouchListener { _, event ->
            val params = bubbleParameters ?: return@setOnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = anchor.x; startY = anchor.y; downX = event.rawX; downY = event.rawY; dragged = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaX = event.rawX - downX; val deltaY = event.rawY - downY
                    if (abs(deltaX) + abs(deltaY) > dp(8)) dragged = true
                    if (dragged) {
                        // Moving the handle closes the menu: the panel is placed next to the bubble, and
                        // following it around the screen is more distracting than reopening it.
                        if (expanded) setExpanded(false)
                        applyAnchor(BubbleGeometry.drag(startX + deltaX.toInt(), startY + deltaY.toInt(),
                            dp(BUBBLE_DP), screenWidth, screenHeight, dp(MARGIN_DP)))
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (dragged) {
                        applyAnchor(BubbleGeometry.dock(anchor, dp(BUBBLE_DP), screenWidth, screenHeight, dp(MARGIN_DP)))
                        store(anchor)
                    } else handle.performClick()
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    applyAnchor(BubbleGeometry.dock(anchor, dp(BUBBLE_DP), screenWidth, screenHeight, dp(MARGIN_DP)))
                    store(anchor); true
                }
                else -> false
            }
        }
        handle.setOnClickListener { setExpanded(!expanded) }
    }

    private fun setExpanded(next: Boolean) {
        if (expanded == next) return
        expanded = next
        if (next) showPanel(HubRepository.state.value) else hidePanel()
    }

    /** The bubble window is moved here and nowhere else: no render, refresh or menu ever moves it. */
    private fun applyAnchor(spot: BubbleSpot) {
        anchor = spot
        val params = bubbleParameters ?: return
        params.x = windowX(spot.x, dp(BUBBLE_DP))
        params.y = spot.y
        try {
            bubble?.let { if (it.isAttachedToWindow) manager.updateViewLayout(it, params) }
        } catch (_: SecurityException) { stopSelf() }
        catch (_: WindowManager.BadTokenException) { stopSelf() }
    }

    /**
     * [BubbleGeometry] works in absolute screen coordinates, while a START-gravity window is placed
     * from the layout's start edge, so a right-to-left locale mirrors the horizontal offset here. The
     * drag deltas stay in screen coordinates, which is why the conversion lives in one place instead of
     * inside the placement maths.
     */
    private fun windowX(left: Int, width: Int): Int = if (rtl) screenWidth - left - width else left

    private val rtl get() = resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL

    private fun store(spot: BubbleSpot) {
        getSharedPreferences(BUBBLE_PREFERENCES, MODE_PRIVATE).edit()
            .putFloat("x", BubbleGeometry.fraction(spot.x, screenWidth))
            .putFloat("y", BubbleGeometry.fraction(spot.y, screenHeight)).apply()
    }

    private fun pill(color: Int) = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(color) }

    private fun withAlpha(color: Int, alpha: Int) = Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))

    private val screenWidth get() = if (Build.VERSION.SDK_INT >= 30) manager.currentWindowMetrics.bounds.width() else resources.displayMetrics.widthPixels
    private val screenHeight get() = if (Build.VERSION.SDK_INT >= 30) manager.currentWindowMetrics.bounds.height() else resources.displayMetrics.heightPixels
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        if (receiverRegistered) unregisterReceiver(screenReceiver)
        panel?.let { if (it.isAttachedToWindow) try { manager.removeView(it) } catch (_: WindowManager.BadTokenException) { } catch (_: IllegalArgumentException) { } }
        panel = null
        panelParameters = null
        bubble?.let { if (it.isAttachedToWindow) try { manager.removeView(it) } catch (_: Throwable) { } }
        bubble = null
        scope.cancel()
        HubRepository.overlay(false)
        super.onDestroy()
    }

    companion object {
        const val START = "com.example.twoaccmess.START_HUB"
        const val STOP = "com.example.twoaccmess.STOP_HUB"
        const val REFRESH = "com.example.twoaccmess.REFRESH_HUB"
        const val BUBBLE_PREFERENCES = "bubble-position"
        /** Classic floating-bubble size: still a full 48dp touch target, and round. */
        private const val BUBBLE_DP = 48
        /** Account menu width. Tall lists scroll instead of growing the panel. */
        private const val PANEL_DP = 236
        private const val ROW_DP = 50
        private const val MAX_ROWS = 4
        private const val PANEL_GAP_DP = 8
        /** Keeps the bubble clear of the status and navigation bars. */
        private const val MARGIN_DP = 28
        private const val DEFAULT_X = 0.84f
        private const val DEFAULT_Y = 0.32f
    }
}
