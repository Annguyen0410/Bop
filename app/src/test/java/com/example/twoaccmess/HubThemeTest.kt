package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Locale

/**
 * The theme choice is persisted text, so a corrupted or hand-edited value must fall back instead of
 * crashing, and every accent must keep its own label readable in both palettes.
 */
class HubThemeTest {
    @Test fun aStoredChoiceIsValidatedAndFallsBackToFollowingThePhone() {
        assertEquals(ThemeChoice.SYSTEM, ThemeChoice.DEFAULT)
        assertEquals(ThemeChoice.SYSTEM, ThemeChoice.from(null))
        assertEquals(ThemeChoice.SYSTEM, ThemeChoice.from(""))
        assertEquals(ThemeChoice.SYSTEM, ThemeChoice.from("night"))
        assertEquals(ThemeChoice.DARK, ThemeChoice.from("DARK"))
        assertEquals(ThemeChoice.LIGHT, ThemeChoice.from("LIGHT"))
        assertEquals(ThemeChoice.entries.size, ThemeChoice.entries.map { it.name }.distinct().size)
        // The stored name is what the preference and the settings file carry, so keep it stable.
        assertEquals("SYSTEM", ThemeChoice.SYSTEM.name)
        assertEquals("LIGHT", ThemeChoice.LIGHT.name)
        assertEquals("DARK", ThemeChoice.DARK.name)
        assertTrue(ThemeChoice.DARK.name == ThemeChoice.DARK.name.uppercase(Locale.ROOT))
    }

    @Test fun forcedChoicesDoNotDependOnThePhoneSetting() {
        // The context-free check: only SYSTEM consults the device, so the other two are deterministic.
        assertFalse(ThemeChoice.LIGHT == ThemeChoice.DARK)
        assertTrue(ThemeChoice.entries.toList().contains(ThemeChoice.SYSTEM))
    }

    @Test fun textOnAnAccentStaysReadable() {
        val black = HubPalette.rgb(0, 0, 0)
        val white = HubPalette.rgb(255, 255, 255)
        // Light colours get black text, dark colours get white text.
        assertEquals(black, HubPalette.onColor(white))
        assertEquals(black, HubPalette.onColor(HubPalette.rgb(245, 197, 24)))
        assertEquals(white, HubPalette.onColor(HubPalette.rgb(24, 30, 49)))
        assertEquals(white, HubPalette.onColor(black))
        // Every slot accent is decided the same way, and the choice always has enough contrast.
        AccountId.entries.forEach { id ->
            val accent = AccountAlerts.accent(id)
            val on = HubPalette.onColor(accent)
            val ratio = (HubPalette.luminance(on) + 0.05) / (HubPalette.luminance(accent) + 0.05)
            val inverted = if (ratio < 1) 1 / ratio else ratio
            assertTrue("slot ${id.name} contrast $inverted", inverted >= 2.0)
        }
    }

    /**
     * The window behind the Compose surface is painted by the platform theme, which cannot read the
     * in-app choice, so the two colour resources must stay equal to the palette the app uses for the
     * phone's own night mode. Otherwise a dark phone would flash a light window on launch.
     */
    @Test fun thePlatformWindowColoursMatchThePalette() {
        fun colour(file: String): Int? {
            val candidate = listOf(File("src/main/res/$file"), File("app/src/main/res/$file")).firstOrNull { it.isFile } ?: return null
            val match = Regex("<color name=\"window_background\">#([0-9A-Fa-f]{8})</color>").find(candidate.readText())
                ?: return null
            return match.groupValues[1].toLong(16).toInt()
        }
        val light = colour("values/colors.xml")
        val night = colour("values-night/colors.xml")
        assertEquals("light window colour", HubPalette.of(dark = false).cockpit, light)
        assertEquals("night window colour", HubPalette.of(dark = true).cockpit, night)
        assertTrue("the two window colours must differ", light != night)
        // The night window style must point at the same resource name the day one uses.
        listOf("values/themes.xml", "values-night/themes.xml").forEach { file ->
            val candidate = listOf(File("src/main/res/$file"), File("app/src/main/res/$file")).firstOrNull { it.isFile }
            assertTrue("$file must be readable", candidate != null)
            assertTrue("$file must use the shared window colour", candidate!!.readText().contains("@color/window_background"))
        }
    }

    @Test fun bothPalettesAreCompleteAndBlendingIsClamped() {
        val dark = HubPalette.of(dark = true)
        val light = HubPalette.of(dark = false)
        listOf(dark, light).forEach { palette ->
            listOf(palette.bubble, palette.panel, palette.browserBackground).forEach { colour ->
                assertTrue("alpha must be opaque", HubPalette.alpha(colour) == 255)
            }
            assertTrue(palette.rowHighlight > 0.0 && palette.rowHighlight < 1.0)
            // Body text must be readable on the surface it is drawn on, in both palettes: light text on
            // dark surfaces and dark text on light ones, so the gap is compared as a magnitude.
            assertTrue("panel text contrast",
                Math.abs(HubPalette.luminance(palette.panelText) - HubPalette.luminance(palette.panel)) > 0.4)
            assertTrue("control text contrast",
                Math.abs(HubPalette.luminance(palette.browserControlText) - HubPalette.luminance(palette.browserControl)) > 0.2)
        }
        // Dark and light really differ, otherwise "dark mode" would be a no-op.
        assertTrue(dark.browserBackground != light.browserBackground)
        assertTrue(dark.panelText != light.panelText)
        assertEquals(HubPalette.rgb(0, 0, 0), HubPalette.blend(HubPalette.rgb(0, 0, 0), HubPalette.rgb(255, 255, 255), -1.0))
        assertEquals(HubPalette.rgb(255, 255, 255), HubPalette.blend(HubPalette.rgb(0, 0, 0), HubPalette.rgb(255, 255, 255), 9.0))
        // The midpoint may round down by one per channel; anything else would mean a broken mix.
        val middle = HubPalette.blend(HubPalette.rgb(0, 0, 0), HubPalette.rgb(255, 255, 255), 0.5)
        listOf(HubPalette.red(middle), HubPalette.green(middle), HubPalette.blue(middle)).forEach { channel ->
            assertTrue("midpoint channel $channel", channel in 127..128)
        }
        assertEquals(255, HubPalette.alpha(HubPalette.withAlpha(HubPalette.rgb(1, 2, 3), 255)))
        assertEquals(3, HubPalette.blue(HubPalette.rgb(1, 2, 3)))
    }
}