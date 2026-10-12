'use strict';

/**
 * Placement maths for the floating bubble and its menu. The bounds, fraction and restore rules came
 * from the Android `BubbleGeometry` unchanged; the docking rule deliberately does not (see below — the
 * phone build docks to an edge because a thumb needs it, a mouse does not). No Electron types here, so
 * every rule is unit-tested.
 *
 * Two rules changed in 0.1.7:
 *
 * 1. The bubble stays exactly where it was dropped. It used to jump flush to the nearest side edge on
 *    release, which is a nice gesture on a phone and an irritation on a desktop: a bubble that has to
 *    live in a corner cannot be parked next to the window it belongs to. The only thing that moves it
 *    now is a drag, and a drag ends where the pointer ended — the screen bounds are the only limit.
 * 2. The space menu is centred on the display instead of hanging off the bubble. Measured on a bubble
 *    in the top-left corner: the panel was clamped against the left edge and its first characters were
 *    cut off. With the bubble now free to sit anywhere, "beside the bubble" has no predictable side to
 *    open towards either.
 */

function bound(value, total, size, margin) {
  const low = Math.max(margin, 0);
  const high = total - size - low;
  if (high < low) return Math.min(Math.max(value, 0), Math.max(total - size, 0));
  return Math.min(Math.max(value, low), high);
}

/** Free placement: the dropped spot, as long as the bubble is still fully on screen. */
function free(x, y, size, screenWidth, screenHeight, margin = 0) {
  return {
    x: bound(x, screenWidth, size, margin),
    y: bound(y, screenHeight, size, margin),
  };
}

function clamp(spot, size, screenWidth, screenHeight, margin = 0) {
  return {
    x: bound(spot.x, screenWidth, size, margin),
    y: bound(spot.y, screenHeight, size, margin),
  };
}

/** Stored as a fraction of the screen so a resize or a different monitor keeps the same relative spot. */
function fraction(value, total) {
  if (!(total > 0)) return 0;
  return Math.min(Math.max(value / total, 0), 1);
}

function fromFraction(value, total, size, margin = 0) {
  if (!Number.isFinite(value)) return bound(0, total, size, margin);
  return bound(Math.round(value * total), total, size, margin);
}

function restore(xFraction, yFraction, size, screenWidth, screenHeight, margin = 0) {
  return {
    x: fromFraction(xFraction, screenWidth, size, margin),
    y: fromFraction(yFraction, screenHeight, size, margin),
  };
}

/**
 * Corner of the space menu: the middle of the display, clamped so it is never pushed off it. A panel
 * that cannot fit (a screen narrower than the panel) starts at the origin, so its top-left corner — the
 * title and the first row — is what the user sees.
 */
function centered(screenWidth, screenHeight, panelWidth, panelHeight, margin = 0) {
  const place = (total, size) => {
    const room = total - size;
    if (room <= 0) return 0;
    const low = Math.min(Math.max(margin, 0), room);
    return Math.min(Math.max(Math.round(room / 2), low), room);
  };
  return { x: place(screenWidth, panelWidth), y: place(screenHeight, panelHeight) };
}

module.exports = { free, clamp, fraction, fromFraction, restore, centered };
