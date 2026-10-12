package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Placement rules of the floating bubble. They exist because of the 1.6 report that closing a chat
 * moved the bubble: the bubble window is only ever moved by a drag, and the menu is a separate window
 * placed by [BubbleGeometry.panel], so these tests pin down both halves.
 */
class BubbleGeometryTest {
    private val size = 48
    private val panelWidth = 236
    private val panelHeight = 360
    private val gap = 8
    private val width = 1080
    private val height = 2280
    private val margin = 28

    @Test fun dockingHasZeroHorizontalGapOnBothEdges() {
        assertEquals(BubbleSpot(0, 300), BubbleGeometry.dock(BubbleSpot(10, 300), size, width, height, margin))
        assertEquals(BubbleSpot(width - size, 300), BubbleGeometry.dock(BubbleSpot(900, 300), size, width, height, margin))
        assertEquals(BubbleSpot(0, margin), BubbleGeometry.dock(BubbleSpot(10, -900), size, width, height, margin))
        assertEquals(BubbleSpot(0, 0), BubbleGeometry.dock(BubbleSpot(-1, -1), size, 20, 20, margin))
    }

    @Test fun draggingUsesIndependentHorizontalAndVerticalMargins() {
        assertEquals(BubbleSpot(0, margin), BubbleGeometry.drag(-900, -900, size, width, height, margin))
        assertEquals(BubbleSpot(width - size, height - size - margin), BubbleGeometry.drag(9000, 9000, size, width, height, margin))
    }

    @Test fun aDragNeverLeavesPartOfTheBubbleOffScreen() {
        assertEquals(BubbleSpot(margin, margin), BubbleGeometry.clamp(-400, -90, size, width, height, margin))
        assertEquals(BubbleSpot(width - size - margin, height - size - margin),
            BubbleGeometry.clamp(4000, 5000, size, width, height, margin))
        // Inside the usable area nothing is touched at all, so dragging is pixel-exact.
        assertEquals(BubbleSpot(410, 933), BubbleGeometry.clamp(410, 933, size, width, height, margin))
    }

    @Test fun theSpotTheUserLeftIsTheSpotThatComesBack() {
        listOf(100 to 300, 640 to 1200, 1004 to 2204, margin to margin).forEach { (x, y) ->
            val stored = BubbleGeometry.fraction(x, width) to BubbleGeometry.fraction(y, height)
            assertEquals(BubbleSpot(x, y), BubbleGeometry.restore(stored.first, stored.second, size, width, height, margin))
        }
        // A smaller screen keeps the relative spot but still keeps the bubble inside.
        assertEquals(BubbleSpot(180, 120), BubbleGeometry.restore(0.5f, 0.5f, size, 360, 240, margin))
    }

    @Test fun aCorruptOrOffScreenStoredSpotFallsBackInsteadOfCrashing() {
        assertEquals(BubbleSpot(margin, margin),
            BubbleGeometry.restore(Float.NaN, Float.POSITIVE_INFINITY, size, width, height, margin))
        assertEquals(BubbleSpot(margin, margin), BubbleGeometry.restore(-5f, -0.2f, size, width, height, margin))
        assertEquals(BubbleSpot(width - size - margin, height - size - margin),
            BubbleGeometry.restore(2f, 9f, size, width, height, margin))
        assertEquals(0f, BubbleGeometry.fraction(10, 0))
        assertEquals(0f, BubbleGeometry.fraction(-100, 1080))
        assertEquals(1f, BubbleGeometry.fraction(4000, 1080))
    }

    @Test fun thePanelIsPlacedBesideTheBubbleAndFullyOnScreen() {
        // Top right: the panel goes below the bubble, sharing its right edge, so the bubble stays visible.
        val topRight = BubbleSpot(width - size - margin, margin)
        assertEquals(BubbleSpot(topRight.x + size - panelWidth, topRight.y + size + gap),
            BubbleGeometry.panel(topRight, size, panelWidth, panelHeight, gap, width, height, margin))
        // Bottom left: it flips above the bubble and shares its left edge.
        val bottomLeft = BubbleSpot(margin, height - size - margin)
        assertEquals(BubbleSpot(bottomLeft.x, bottomLeft.y - gap - panelHeight),
            BubbleGeometry.panel(bottomLeft, size, panelWidth, panelHeight, gap, width, height, margin))
        // Every corner keeps the whole panel inside the margins.
        listOf(margin to margin, width - size - margin to margin, margin to height - size - margin,
            width - size - margin to height - size - margin, 520 to 1100).forEach { (x, y) ->
            val placed = BubbleGeometry.panel(BubbleSpot(x, y), size, panelWidth, panelHeight, gap, width, height, margin)
            assertTrue("$x,$y -> $placed", placed.x >= margin && placed.x + panelWidth <= width - margin)
            assertTrue("$x,$y -> $placed", placed.y >= margin && placed.y + panelHeight <= height - margin)
        }
    }

    @Test fun aPanelTallerThanTheScreenIsClampedIntoItRatherThanPushedAway() {
        val spot = BubbleGeometry.panel(BubbleSpot(20, 40), size, 240, 900, gap, 320, 480, 8)
        assertEquals(0, spot.y)
        assertTrue("$spot", spot.x in 0..(320 - 240))
    }
}
