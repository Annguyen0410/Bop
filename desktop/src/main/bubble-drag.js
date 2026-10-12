'use strict';

/**
 * The bubble's drag, as a small state machine. No Electron types here, so every rule is unit-tested.
 *
 * Bop moves the window itself instead of leaving the gesture to Chromium's `-webkit-app-region: drag`.
 * That is not a preference; it is what the machine measured. On 0.1.7, with the operating system's own
 * pointer:
 *
 * 1. The drag was inaccurate. A fast real drag asked for 260×150 points and the window arrived at
 *    227×131 — 33 points short of the hand that was dragging it.
 * 2. The drag was nearly impossible to grab. `-webkit-app-region: drag` covered the 60px box while the
 *    round button in the middle was `no-drag`, so the only surface that moved the bubble was the ~13px
 *    ring around the button. A press that looks like a grab lands on the button, which opens the menu —
 *    which is exactly what the user's own screenshot shows happening.
 *
 * So the renderer reports the pointer and this decides where the window goes, one point per point. A
 * press that never travels is still a tap: [MOVE_THRESHOLD] is what keeps a click a click.
 */

/** How far the pointer has to travel before a press becomes a drag, in screen points. */
const MOVE_THRESHOLD = 4;

/** Where the pointer grabbed the bubble, relative to the window. The window must keep this offset for
 *  the whole gesture, otherwise the bubble jumps under the cursor on the first move. */
function grabOffset(cursor, position) {
  return { dx: cursor.x - position.x, dy: cursor.y - position.y };
}

function placement(cursor, grab) {
  return { x: Math.round(cursor.x - grab.dx), y: Math.round(cursor.y - grab.dy) };
}

/**
 * Starts a gesture. [cursor] is the *press* point, not the first moved point, so the bubble follows the
 * pointer as if it had been picked up where it was touched.
 */
function begin(cursor, position) {
  if (!cursor || !position) return null;
  return { grab: grabOffset(cursor, position), cursor: { ...cursor }, placed: null, started: false };
}

/**
 * The window position the pointer is asking for, or null when the window should stay exactly where it
 * is: before the threshold is crossed, and whenever the pointer is still inside the point the window
 * already occupies (a redundant `setBounds` per event would be hundreds of moves per drag).
 */
function advance(session, cursor) {
  if (!session || !cursor) return { session, position: null };
  const next = { ...session, cursor: { ...cursor } };
  if (!session.started) {
    const travelled = Math.abs(cursor.x - session.cursor.x) + Math.abs(cursor.y - session.cursor.y);
    if (travelled < MOVE_THRESHOLD) return { session: next, position: null };
    next.started = true;
  }
  const position = placement(cursor, session.grab);
  if (session.placed && session.placed.x === position.x && session.placed.y === position.y) {
    return { session: next, position: null };
  }
  return { session: { ...next, placed: position }, position };
}

/** True when the gesture actually moved the bubble, i.e. it was a drag and not a tap. */
function moved(session) {
  return !!(session && session.started && session.placed);
}

/**
 * Ends a gesture. A tap reports `dragged: false` and asks for nothing — including no re-place, so a
 * click can never nudge the bubble by a point. A real drag ends where the pointer is, with the work area
 * as the only correction: [clamp] is handed the position the pointer asked for and answers with the one
 * the bubble may take, and the stored spot describes *that* one, so the spot and the window never disagree.
 */
function finish(session, cursor, origin, clamp) {
  if (!moved(session)) return { dragged: false, spot: null, position: null };
  const wanted = placement(cursor || session.cursor, session.grab);
  const free = clamp ? clamp(wanted) : wanted;
  return {
    dragged: true,
    position: free,
    spot: { x: free.x - origin.x, y: free.y - origin.y },
  };
}

module.exports = { MOVE_THRESHOLD, grabOffset, placement, begin, advance, moved, finish };
