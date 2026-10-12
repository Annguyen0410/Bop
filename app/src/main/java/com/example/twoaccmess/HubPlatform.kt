package com.example.twoaccmess

import android.Manifest
import android.app.Activity
import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.LauncherApps
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.os.UserManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.webkit.WebViewCompat

data class MessengerEnvironment(val serial: Long, val title: String, val available: Boolean)

object HubPlatform {
    fun notificationAccess(context: Context) = NotificationManagerCompat.getEnabledListenerPackages(context)
        .contains(context.packageName)
    fun canNotify(context: Context) =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun environments(context: Context): List<MessengerEnvironment> {
        val launcher = context.getSystemService(LauncherApps::class.java)
        val users = context.getSystemService(UserManager::class.java)
        return try {
            (if (Build.VERSION.SDK_INT >= 26) launcher.profiles else users.userProfiles).mapNotNull { user ->
                val serial = users.getSerialNumberForUser(user)
                if (serial < 0 || launcher.getActivityList(MESSENGER_PACKAGE, user).isEmpty()) null else {
                    val title = if (user == android.os.Process.myUserHandle()) "Personal profile" else "Managed profile · $serial"
                    MessengerEnvironment(serial, title, users.isUserUnlocked(user) && !users.isQuietModeEnabled(user))
                }
            }
        } catch (_: SecurityException) { emptyList() }
    }

    fun openInbox(activity: Activity, id: AccountId): String? {
        val binding = HubRepository.state.value.account(id)
        val serial = binding.profileSerial ?: return "Bind this account to a Messenger installation first."
        val launcher = activity.getSystemService(LauncherApps::class.java)
        val users = activity.getSystemService(UserManager::class.java)
        return try {
            val user = (if (Build.VERSION.SDK_INT >= 26) launcher.profiles else users.userProfiles).singleOrNull { users.getSerialNumberForUser(it) == serial }
                ?: return "That profile is no longer accessible. Rebind the account."
            if (users.isQuietModeEnabled(user) || !users.isUserUnlocked(user)) return "Unlock or turn on the selected profile first."
            val target = launcher.getActivityList(MESSENGER_PACKAGE, user).firstOrNull()
                ?: return "Messenger is unavailable in this profile."
            launcher.startMainActivity(target.componentName, user, null, null)
            null
        } catch (_: SecurityException) { "Android or profile policy blocked this launch. No other account was opened." }
        catch (_: android.content.ActivityNotFoundException) { "Messenger's launcher is unavailable. Refresh the binding." }
        catch (_: IllegalStateException) { "The selected profile is unavailable." }
    }

    fun openAlert(activity: Activity, key: AlertKey): String? {
        val route = HubNotificationListener.route(key)
            ?: return "This notification action expired. Open the account's app instead."
        val state = HubRepository.state.value
        val alert = state.alerts[key] ?: return "This alert is no longer available."
        val account = state.account(key.accountId)
        // An app-claimed card comes from this phone's own app, not from a bound Messenger installation,
        // so no profile binding applies; a web-only slot simply has no serial to compare either.
        val appClaimed = route.packageName != MESSENGER_PACKAGE
        val bindingMatches = appClaimed || account.profileSerial == null || route.serial == account.profileSerial
        if (!state.connected || route.generation != account.generation || route.generation != alert.generation ||
            !bindingMatches || HubRepository.isLocked(activity)) return "This account context is unavailable."
        val users = activity.getSystemService(UserManager::class.java)
        val profileReady = try { users.isUserUnlocked(route.user) && !users.isQuietModeEnabled(route.user) }
        catch (_: SecurityException) { false }
        if (!profileReady) return "Unlock or turn on the selected profile before opening this chat."
        val token = route.intent
        if (token.creatorPackage != route.packageName || token.creatorUserHandle != route.user) return "The notification action's identity did not match. Launch cancelled."
        return try {
            val options = ActivityOptions.makeBasic()
            if (Build.VERSION.SDK_INT >= 36) options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE)
            else if (Build.VERSION.SDK_INT >= 34) options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
            token.send(activity, 0, null, null, null, null, options.toBundle())
            null
        } catch (_: PendingIntent.CanceledException) { "${account.app.label} cancelled this notification action. Open its inbox instead." }
        catch (_: SecurityException) { "Android blocked this action. Open the account's app instead." }
    }

    fun requestListenerRebind(context: Context) {
        if (notificationAccess(context)) android.service.notification.NotificationListenerService.requestRebind(
            ComponentName(context, HubNotificationListener::class.java))
    }

    /**
     * True when the battery optimiser may pause Bop. Answers true when the platform refuses to say,
     * so an unreadable value is never reported to the user as a problem to fix.
     */
    fun batteryExempt(context: Context): Boolean = try {
        context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) ?: true
    } catch (_: Throwable) { true }

    /**
     * Prefer the one-tap exemption dialog; fall back to the optimiser list on builds that only expose
     * that screen, so the repair action always lands somewhere useful.
     *
     * Deliberately a user-initiated button: the permission is declared because notifications are the
     * whole point of the hub, and a phone that pauses Bop silently stops alerting. Play policy treats
     * this permission as reviewable, so the direct dialog is only ever opened after the user taps Fix.
     */
    fun batterySettings(context: Context): Intent =
        if (context.checkSelfPermission(Manifest.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) == PackageManager.PERMISSION_GRANTED)
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${context.packageName}".toUri())
        else Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)

    fun listenerSettings() = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)

    fun appDetailsSettings(context: Context) =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${context.packageName}".toUri())

    /**
     * Auto-start and background-activity screens, best effort. These components are undocumented and
     * differ per build, so each is tried in order and a miss falls through to App info rather than
     * showing an error the user cannot act on.
     */
    fun autoStartSettings(key: String): List<Intent> = AUTO_START[key].orEmpty().map { Intent().setComponent(it) }

    /** One-line device fingerprint for the reliability card: brand, Android and the browser engine. */
    fun deviceLabel(context: Context): String {
        val engine = try {
            WebViewCompat.getCurrentWebViewPackage(context)?.let { "${it.packageName} ${it.versionName}" }
        } catch (_: Throwable) { null }
        val device = "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
        return if (engine == null) device else "$device · WebView $engine"
    }

    fun openSettings(context: Context, intent: Intent): Boolean = try {
        context.startActivity(intent)
        true
    } catch (_: android.content.ActivityNotFoundException) { false }
    catch (_: SecurityException) { false }

    fun overlaySettings(context: Context) = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, "package:${context.packageName}".toUri())

    private val AUTO_START: Map<String, List<ComponentName>> = mapOf(
        "xiaomi" to listOf(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")),
        "oppo" to listOf(
            ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
            ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
            ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")),
        "vivo" to listOf(
            ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")),
        "huawei" to listOf(
            ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
            ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")),
        "samsung" to listOf(ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")),
        "oneplus" to listOf(ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")),
        "asus" to listOf(ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity")),
        "transsion" to listOf(ComponentName("com.transsion.phonemaster", "com.transsion.phonemaster.optimize.AutoStartActivity")),
    )
}

