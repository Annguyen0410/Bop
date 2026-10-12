package com.example.twoaccmess

import android.content.Context
import androidx.compose.ui.graphics.Color as ComposeColor

/**
 * Cross-process mirror of the appearance choice. The overlay service, the browser activities and the
 * main process each need the palette before/without the encrypted settings file, so the value also
 * lives in an ordinary preference file that any of them can read at any time.
 */
object HubThemeStore {
    const val PREFERENCES = "hub-theme"
    const val KEY = "choice"

    fun write(context: Context, choice: ThemeChoice) {
        try {
            android.util.AtomicFile(java.io.File(context.filesDir, "appearance.txt")).let { file ->
                val stream = file.startWrite()
                try { stream.write(choice.name.toByteArray()); file.finishWrite(stream) }
                catch (failure: Exception) { file.failWrite(stream); throw failure }
            }
        } catch (_: Throwable) {
            // A preference write failure only costs the mirrored value; the encrypted copy remains.
        }
    }

    fun read(context: Context, fallback: ThemeChoice = ThemeChoice.DEFAULT): ThemeChoice = try {
        val file = java.io.File(context.filesDir, "appearance.txt")
        if (file.isFile) ThemeChoice.from(file.readText()) else {
            val stored = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(KEY, null)
            if (stored == null) fallback else ThemeChoice.from(stored)
        }
    } catch (_: Throwable) {
        fallback
    }

    /** True when the overlay and the browser should paint dark right now. */
    fun dark(context: Context): Boolean = ThemeChoice.dark(context, read(context))
}

/** Which appearance the user picked in Setup. Stored next to the other hub settings. */
enum class ThemeChoice {
    SYSTEM, LIGHT, DARK;

    companion object {
        val DEFAULT = SYSTEM

        fun from(value: String?): ThemeChoice = entries.firstOrNull { it.name == value } ?: DEFAULT

        /** True when [choice] wants the dark palette on this device right now. */
        fun dark(context: Context, choice: ThemeChoice): Boolean = when (choice) {
            DARK -> true
            LIGHT -> false
            SYSTEM -> (context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
                android.content.res.Configuration.UI_MODE_NIGHT_YES
        }
    }
}

/**
 * One palette for the two screens that are still plain Android views (the overlay bubble and the
 * embedded browser), so light/dark does not stop at the Compose cockpit.
 *
 * Colours are plain ARGB integers and the maths is done with bit operations, so this object stays
 * pure Kotlin and its contrast rule is unit-tested on the JVM instead of on a device.
 */
object HubPalette {
    private const val BLACK = -0x1000000 // 0xFF000000
    private const val WHITE = -0x1        // 0xFFFFFFFF

    fun alpha(color: Int): Int = (color ushr 24) and 0xFF
    fun red(color: Int): Int = (color ushr 16) and 0xFF
    fun green(color: Int): Int = (color ushr 8) and 0xFF
    fun blue(color: Int): Int = color and 0xFF

    fun argb(a: Int, r: Int, g: Int, b: Int): Int =
        (a.coerceIn(0, 255) shl 24) or (r.coerceIn(0, 255) shl 16) or (g.coerceIn(0, 255) shl 8) or b.coerceIn(0, 255)

    fun rgb(r: Int, g: Int, b: Int): Int = argb(255, r, g, b)

    /** sRGB relative luminance (WCAG 2.x), used to decide black or white text on a colour. */
    fun luminance(color: Int): Double {
        fun channel(value: Int): Double {
            val c = value / 255.0
            return if (c <= 0.03928) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(red(color)) + 0.7152 * channel(green(color)) + 0.0722 * channel(blue(color))
    }

    /** Readable text colour for [background], so a slot accent never hides its own label. */
    fun onColor(background: Int): Int = if (luminance(background) > 0.35) BLACK else WHITE

    fun withAlpha(color: Int, alpha: Int): Int = argb(alpha, red(color), green(color), blue(color))

    /** Mixes [over] into [base]; [ratio] is clamped, so a caller cannot produce an invalid colour. */
    fun blend(base: Int, over: Int, ratio: Double): Int {
        val amount = ratio.coerceIn(0.0, 1.0)
        fun mix(a: Int, b: Int) = (a + (b - a) * amount).toInt().coerceIn(0, 255)
        return argb(
            mix(alpha(base), alpha(over)), mix(red(base), red(over)),
            mix(green(base), green(over)), mix(blue(base), blue(over)),
        )
    }

    /** Colours for the overlay bubble, its menu and the browser header. */
    data class Screen(
        /** Background of the Compose cockpit. The platform window behind it uses the same value, so
         *  the launch window never flashes a different colour; values/colors.xml must match it. */
        val cockpit: Int,
        val bubble: Int,
        val bubbleRing: Int,
        val bubbleText: Int,
        val panel: Int,
        val panelText: Int,
        val panelMuted: Int,
        val panelSecondary: Int,
        val rowHighlight: Double,
        val badge: Int,
        val badgeText: Int,
        val browserBackground: Int,
        val browserHeaderText: Int,
        val browserControl: Int,
        val browserControlText: Int,
    )

    fun of(dark: Boolean): Screen = if (dark) Screen(
        cockpit = rgb(20, 18, 28),
        bubble = rgb(33, 29, 43),
        bubbleRing = rgb(96, 108, 146),
        bubbleText = rgb(244, 239, 252),
        panel = rgb(33, 29, 43),
        panelText = rgb(244, 239, 252),
        panelMuted = rgb(190, 182, 206),
        panelSecondary = rgb(48, 42, 60),
        rowHighlight = 0.18,
        badge = rgb(214, 48, 68),
        badgeText = WHITE,
        browserBackground = rgb(20, 18, 28),
        browserHeaderText = rgb(244, 239, 252),
        browserControl = rgb(48, 42, 60),
        browserControlText = rgb(230, 235, 250),
    ) else Screen(
        cockpit = rgb(247, 245, 250),
        bubble = WHITE,
        bubbleRing = rgb(198, 206, 228),
        bubbleText = rgb(24, 30, 49),
        panel = WHITE,
        panelText = rgb(20, 24, 40),
        panelMuted = rgb(112, 102, 126),
        panelSecondary = rgb(240, 235, 246),
        rowHighlight = 0.14,
        badge = rgb(214, 48, 68),
        badgeText = WHITE,
        browserBackground = rgb(247, 245, 250),
        browserHeaderText = rgb(20, 24, 40),
        browserControl = rgb(227, 217, 255),
        browserControlText = rgb(24, 30, 49),
    )

    /** Same value as a Compose colour for the Compose side of the app. */
    fun compose(color: Int): ComposeColor = ComposeColor(color)
}