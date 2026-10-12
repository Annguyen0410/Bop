package com.example.twoaccmess

/** Screen-space corner (top-left) of the floating bubble or of its panel. */
data class BubbleSpot(val x: Int, val y: Int)

/**
 * Placement maths for the overlay, kept free of Android types so it can be unit-tested.
 *
 * The rule the bubble follows since 1.6: the spot the user dropped it in is the only thing that moves
 * the bubble. Opening the menu, opening a web session, returning from one, or a state refresh never
 * touches it, and the menu panel gets its own window next to the bubble instead of resizing the
 * bubble's window.
 */
object BubbleGeometry {
    /** Full-width docking: zero horizontal gap, independent vertical safety margin. */
    fun dock(spot: BubbleSpot, size: Int, screenWidth: Int, screenHeight: Int, verticalMargin: Int = 0): BubbleSpot {
        val right = (screenWidth - size).coerceAtLeast(0)
        val y = clamp(spot.x, spot.y, size, screenWidth, screenHeight, verticalMargin).y
        return BubbleSpot(if (spot.x.toLong() * 2 + size < screenWidth) 0 else right, y)
    }

    fun drag(x: Int, y: Int, size: Int, screenWidth: Int, screenHeight: Int, verticalMargin: Int): BubbleSpot =
        BubbleSpot(x.coerceIn(0, (screenWidth - size).coerceAtLeast(0)), clamp(x, y, size, screenWidth, screenHeight, verticalMargin).y)

    /** Restores a stored fraction, clamped so a rotated or resized screen cannot park it off-screen. */
    fun restore(xFraction: Float, yFraction: Float, size: Int, screenWidth: Int, screenHeight: Int,
                margin: Int = 0): BubbleSpot = BubbleSpot(
        fromFraction(xFraction, screenWidth, size, margin),
        fromFraction(yFraction, screenHeight, size, margin),
    )

    fun fromFraction(fraction: Float, total: Int, size: Int, margin: Int = 0): Int =
        if (!fraction.isFinite()) bound(0, total, size, margin)
        else bound(Math.round(fraction * total), total, size, margin)

    /** Keeps a bubble of [size] inside the screen while the user drags it. */
    fun clamp(x: Int, y: Int, size: Int, screenWidth: Int, screenHeight: Int, margin: Int = 0) =
        BubbleSpot(bound(x, screenWidth, size, margin), bound(y, screenHeight, size, margin))

    /** Stored as a fraction of the screen so a resolution change keeps the same relative spot. */
    fun fraction(value: Int, total: Int): Float = if (total <= 0) 0f else (value.toFloat() / total).coerceIn(0f, 1f)

    /**
     * Corner of the menu panel for a bubble at [anchor]: below the bubble by preference, above it when
     * the bottom of the screen is too close, aligned with the same left or right edge as the bubble.
     * The panel is always fully on screen.
     */
    fun panel(anchor: BubbleSpot, size: Int, panelWidth: Int, panelHeight: Int, gap: Int,
              screenWidth: Int, screenHeight: Int, margin: Int = 0): BubbleSpot = BubbleSpot(
        horizontal(anchor.x, size, panelWidth, screenWidth, margin),
        vertical(anchor.y, size, panelHeight, gap, screenHeight, margin),
    )

    private fun horizontal(anchorX: Int, size: Int, panelWidth: Int, screenWidth: Int, margin: Int): Int {
        val left = bound(anchorX, screenWidth, panelWidth, margin)
        // Same left edge when the panel fits to the right of the bubble, otherwise the same right edge.
        return if (anchorX <= (screenWidth - panelWidth - margin).coerceAtLeast(margin)) left
        else bound(anchorX + size - panelWidth, screenWidth, panelWidth, margin)
    }

    private fun vertical(anchorY: Int, size: Int, panelHeight: Int, gap: Int, screenHeight: Int, margin: Int): Int {
        val below = anchorY + size + gap
        if (below + panelHeight <= screenHeight - margin) return below
        val above = anchorY - gap - panelHeight
        if (above >= margin) return above
        return bound(below, screenHeight, panelHeight, margin)
    }

    /** Clamps into `[margin, total - size - margin]`, falling back to the raw screen range when the
     *  margin leaves no room at all (tiny screens, huge panel). */
    private fun bound(value: Int, total: Int, size: Int, margin: Int): Int {
        val low = margin.coerceAtLeast(0)
        val high = total - size - low
        if (high < low) return value.coerceIn(0, (total - size).coerceAtLeast(0))
        return value.coerceIn(low, high)
    }
}
