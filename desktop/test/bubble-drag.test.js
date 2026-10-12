'use strict';

/**
 * The bubble's drag rules. These are the ones a human feels: a click that must not move the bubble, a
 * grab that must not jump, and a drop that must land where the hand let go.
 */

const test = require('node:test');
const assert = require('node:assert');
const drag = require('../src/main/bubble-drag.js');

// A 64px bubble parked at 38,361 on the work area — the real geometry measured on this machine, so the
// numbers below are the ones the app actually works with.
const SIZE = 64;
const WINDOW = { x: 38, y: 361 };
const AREA = { x: 0, y: 0, width: 1920, height: 1032 };

/** Presses the centre of the bubble, which is where a hand aims. */
function pressCentre(position = WINDOW) {
  return { x: position.x + SIZE / 2, y: position.y + SIZE / 2 };
}

test('a press that never travels is a tap and moves nothing', () => {
  const start = pressCentre();
  let session = drag.begin(start, WINDOW);
  // A hand that clicks wobbles by a point or two; that must stay a click.
  const jitter = [{ x: start.x + 1, y: start.y }, { x: start.x, y: start.y + 2 }, start];
  const positions = jitter.map((point) => {
    const step = drag.advance(session, point);
    session = step.session;
    return step.position;
  });
  assert.deepEqual(positions, [null, null, null]);
  assert.equal(drag.moved(session), false);
  assert.deepEqual(drag.finish(session, start, WINDOW, (spot) => spot), { dragged: false, spot: null, position: null });
});

test('a grab keeps its offset, so the bubble does not jump under the cursor', () => {
  const start = pressCentre();
  // Grabbed at the bubble's centre: the window's top-left must stay half a bubble behind the pointer.
  let session = drag.begin(start, WINDOW);
  const step = drag.advance(session, { x: start.x + 100, y: start.y + 50 });
  assert.deepEqual(step.position, { x: WINDOW.x + 100, y: WINDOW.y + 50 });
  // Grabbed 5 points in from the left edge instead: the window keeps that 5-point offset.
  session = drag.begin({ x: WINDOW.x + 5, y: WINDOW.y + 32 }, WINDOW);
  const offCentre = drag.advance(session, { x: WINDOW.x + 5 + 200, y: WINDOW.y + 32 + 90 });
  assert.deepEqual(offCentre.position, { x: WINDOW.x + 200, y: WINDOW.y + 90 });
});

test('moves are applied once per point, not once per event', () => {
  const start = pressCentre();
  let session = drag.begin(start, WINDOW);
  const first = drag.advance(session, { x: start.x + 40, y: start.y });
  session = first.session;
  assert.deepEqual(first.position, { x: WINDOW.x + 40, y: WINDOW.y });
  // Chromium delivers several move events per point; the window must be repositioned once.
  assert.equal(drag.advance(session, { x: start.x + 40, y: start.y }).position, null);
  const scaled = drag.advance(drag.advance(session, { x: start.x + 40.2, y: start.y }).session, { x: start.x + 40.4, y: start.y });
  assert.equal(scaled.position, null, 'sub-point movement must not re-place the window');
  assert.deepEqual(drag.advance(session, { x: start.x + 41, y: start.y }).position, { x: WINDOW.x + 41, y: WINDOW.y });
});

test('the drop lands where the hand let go, and the work area is the only correction', () => {
  const start = pressCentre();
  const drop = { x: 1200, y: 700 };
  // Grabbed at the centre, so the window's top-left is half a bubble behind the pointer at every point.
  const wanted = { x: drop.x - SIZE / 2, y: drop.y - SIZE / 2 };
  let session = drag.begin(start, WINDOW);
  session = drag.advance(session, { x: start.x + 120, y: start.y + 40 }).session; // the gesture is under way
  const result = drag.finish(session, drop, WINDOW, () => wanted);
  assert.equal(result.dragged, true);
  assert.deepEqual(result.position, wanted);
  assert.deepEqual(result.spot, { x: wanted.x - WINDOW.x, y: wanted.y - WINDOW.y });

  // A drop past the bottom-right corner is pulled back in by the caller's clamp; the drag itself only
  // says where the pointer ended.
  const offEdge = { x: AREA.width + 500, y: AREA.height + 500 };
  const clamped = drag.finish(session, offEdge, { x: AREA.x, y: AREA.y }, (asked) => ({
    x: Math.min(Math.max(asked.x, AREA.x), AREA.x + AREA.width - SIZE),
    y: Math.min(Math.max(asked.y, AREA.y), AREA.y + AREA.height - SIZE),
  }));
  assert.deepEqual(clamped.position, { x: AREA.width - SIZE, y: AREA.height - SIZE });
  assert.equal(clamped.spot.x + SIZE, AREA.width);
});

test('a release with no move in it is a tap, so a click can never nudge the bubble', () => {
  const start = pressCentre();
  const session = drag.begin(start, WINDOW);
  // The renderer only sends an end when the gesture started; this is the belt to that braces.
  assert.deepEqual(drag.finish(session, { x: start.x + 2, y: start.y + 1 }, WINDOW, () => ({ x: 0, y: 0 })), {
    dragged: false, spot: null, position: null,
  });
});

test('a drag that only wobbles past the threshold is still honoured', () => {
  const start = pressCentre();
  let session = drag.begin(start, WINDOW);
  const just = drag.advance(session, { x: start.x + drag.MOVE_THRESHOLD, y: start.y });
  session = just.session;
  assert.deepEqual(just.position, { x: WINDOW.x + drag.MOVE_THRESHOLD, y: WINDOW.y });
  assert.equal(drag.moved(session), true);
  const short = Math.abs(just.position.x - WINDOW.x);
  assert.equal(short, 4, 'the first honoured move is exactly the threshold, so nothing is swallowed');
});
