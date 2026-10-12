package com.example.twoaccmess

import java.util.Locale

/**
 * Why this exists: the hub only works when the phone keeps delivering message notifications, and
 * every manufacturer enforces that differently. On real devices the failures are always one of a few:
 * a notification permission the user turned off, notification access revoked during an update, an
 * overlay permission the OEM dropped, an aggressive battery optimiser pausing the app, or a WebView
 * engine too old for parallel profiles. Each becomes one visible check with one repair action.
 *
 * Kept free of Android types so every rule and every recommendation is unit-tested on the JVM.
 */
data class ReliabilityCheck(
    val key: Key,
    val title: String,
    val ok: Boolean,
    val status: String,
    val advice: String,
) {
    enum class Key { Notifications, Listener, ListenerAlive, Overlay, Battery, WebProfiles }
}

/** One phone family's extra survival steps. [key] is also what the settings deep-links are chosen by. */
data class OemAdvice(val key: String, val label: String, val steps: List<String>)

object HubReliability {
    /** Steps worth showing when the brand has no special entry; never empty, so the card always helps. */
    val GENERIC_STEPS = listOf(
        "Set Bop's battery usage to Unrestricted.",
        "Keep notifications and floating windows allowed for Bop.",
        "Reconnect notification access if alerts ever stop arriving.",
    )

    private val ALIASES = linkedMapOf(
        "xiaomi" to "xiaomi", "redmi" to "xiaomi", "poco" to "xiaomi",
        "oppo" to "oppo", "realme" to "oppo",
        "oneplus" to "oneplus",
        "vivo" to "vivo", "iqoo" to "vivo",
        "huawei" to "huawei", "honor" to "huawei",
        "samsung" to "samsung",
        "asus" to "asus",
        "tecno" to "transsion", "infinix" to "transsion", "itel" to "transsion",
        "motorola" to "motorola", "lenovo" to "motorola",
    )

    private val ADVICE = mapOf(
        "xiaomi" to OemAdvice("xiaomi", "Xiaomi / Redmi / POCO", listOf(
            "Turn on Autostart for Bop.",
            "Set Bop's battery saver to No restrictions.",
            "Keep Bop in Recents (lock it) so MIUI/HyperOS does not clear it.",
        )),
        "oppo" to OemAdvice("oppo", "OPPO / realme", listOf(
            "Allow Auto-launch / Startup for Bop.",
            "Allow background running for Bop.",
            "Turn off \"Sleep\" for Bop under Battery.",
        )),
        "vivo" to OemAdvice("vivo", "vivo / iQOO", listOf(
            "Allow Bop in Autostart.",
            "Turn off battery optimisation for Bop.",
            "Allow high background power consumption.",
        )),
        "huawei" to OemAdvice("huawei", "Huawei / Honor", listOf(
            "Set App launch for Bop to Manage manually and turn on all three switches.",
            "Ignore battery optimisation for Bop.",
        )),
        "samsung" to OemAdvice("samsung", "Samsung One UI", listOf(
            "Set Bop's battery usage to Unrestricted.",
            "Turn off \"Put unused apps to sleep\" under Battery.",
            "Add Bop to \"Never sleeping apps\" if alerts pause overnight.",
        )),
        "oneplus" to OemAdvice("oneplus", "OnePlus / OxygenOS", listOf(
            "Allow Auto-launch for Bop.",
            "Set battery optimisation to Don't optimise.",
            "Allow background activity for Bop.",
        )),
        "asus" to OemAdvice("asus", "ASUS", listOf(
            "Allow Auto-start Manager for Bop.",
            "Turn off battery optimisation for Bop.",
        )),
        "motorola" to OemAdvice("motorola", "Motorola / Lenovo", listOf(
            "Turn off battery optimisation for Bop.",
            "Allow background data and background activity.",
        )),
        "transsion" to OemAdvice("transsion", "Tecno / Infinix / itel", listOf(
            "Allow Bop to auto-start.",
            "Turn off power saving for Bop.",
            "Turn off battery optimisation for Bop.",
        )),
    )

    /**
     * One check per thing that actually breaks on real phones, in the order a user should fix them.
     * [webProfiles] is nullable because the engine probe is asynchronous: an unknown answer must not
     * be drawn as a failure, only as "still checking".
     */
    fun checks(
        notifyAllowed: Boolean,
        listenerAccess: Boolean,
        listenerConnected: Boolean,
        overlayAllowed: Boolean,
        batteryExempt: Boolean,
        webProfiles: Boolean?,
    ): List<ReliabilityCheck> = listOf(
        ReliabilityCheck(ReliabilityCheck.Key.Notifications, "Bop notifications", notifyAllowed,
            if (notifyAllowed) "Allowed" else "Off",
            "Allow Bop notifications, or message cards and the floating bubble never appear."),
        ReliabilityCheck(ReliabilityCheck.Key.Listener, "Notification access", listenerAccess,
            if (listenerAccess) "Allowed" else "Off",
            "Turn on notification access for Bop so it can read supported message alerts."),
        ReliabilityCheck(ReliabilityCheck.Key.ListenerAlive, "Listener connected",
            listenerAccess && listenerConnected,
            when {
                !listenerAccess -> "Waiting for access"
                listenerConnected -> "Connected"
                else -> "Disconnected"
            },
            if (listenerAccess && !listenerConnected)
                "Android has dropped Bop's listener. Reconnect it — this is the usual \"it stopped alerting\" cause."
            else "Connect notification access first, then reconnect if alerts stop."),
        ReliabilityCheck(ReliabilityCheck.Key.Overlay, "Float over apps", overlayAllowed,
            if (overlayAllowed) "Allowed" else "Off",
            "Allow floating windows for the draggable bubble."),
        ReliabilityCheck(ReliabilityCheck.Key.Battery, "Battery optimisation", batteryExempt,
            if (batteryExempt) "Unrestricted" else "Optimised",
            "Set Bop to Unrestricted so the phone stops pausing its alerts."),
        ReliabilityCheck(ReliabilityCheck.Key.WebProfiles, "Parallel web sessions", webProfiles != false,
            when (webProfiles) {
                true -> "Supported"
                false -> "Not supported"
                null -> "Checking…"
            },
            if (webProfiles == false)
                "Update Android System WebView/Chrome to keep more than sixteen parallel logins working."
            else "Extra spaces need a current WebView engine."),
    )

    fun pending(checks: List<ReliabilityCheck>): Int = checks.count { !it.ok }

    fun allOk(checks: List<ReliabilityCheck>): Boolean = checks.all { it.ok }

    fun statusLine(checks: List<ReliabilityCheck>): String = if (allOk(checks))
        "All ${checks.size} checks pass" else "${pending(checks)} of ${checks.size} checks need attention"

    /** The [ADVICE] key for a phone family, or null when it needs no special steps (e.g. Pixel). */
    fun oemKey(manufacturer: String?, brand: String?): String? {
        val names = listOf(manufacturer, brand)
            .mapNotNull { it?.trim()?.lowercase(Locale.ROOT)?.takeIf(String::isNotEmpty) }
        return names.firstNotNullOfOrNull { name ->
            ALIASES.entries.firstOrNull { (alias, _) -> name.contains(alias) }?.value
        }
    }

    fun oemAdvice(manufacturer: String?, brand: String?): OemAdvice? =
        oemKey(manufacturer, brand)?.let(ADVICE::get)
}
