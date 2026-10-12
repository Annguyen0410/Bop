'use strict';

const test = require('node:test');
const assert = require('node:assert');
const geo = require('../src/main/docking.js');

const SIZE = 48;
const MENU_WIDTH = 340;
const MENU_HEIGHT = 322;
const WIDTH = 1920;
const HEIGHT = 1080;
const MARGIN = 28;

// The bounds, fraction and restore cases are the ones the Android BubbleGeometryTest asserts, so the two
// apps cannot drift apart on how a stored spot is kept inside a screen.
test('free placement keeps the dropped spot and only the screen edge moves it', () => {
  assert.deepStrictEqual(geo.free(377, 512, SIZE, WIDTH, HEIGHT), { x: 377, y: 512 });
  assert.deepStrictEqual(geo.free(-400, -90, SIZE, WIDTH, HEIGHT), { x: 0, y: 0 });
  assert.deepStrictEqual(geo.free(9000, 9000, SIZE, WIDTH, HEIGHT), { x: WIDTH - SIZE, y: HEIGHT - SIZE });
  // Every edge and every corner is a legal parking spot: the bubble is no longer pinned to a side.
  assert.deepStrictEqual(geo.free(0, 0, SIZE, WIDTH, HEIGHT), { x: 0, y: 0 });
  assert.deepStrictEqual(geo.free(WIDTH - SIZE, HEIGHT - SIZE, SIZE, WIDTH, HEIGHT), { x: WIDTH - SIZE, y: HEIGHT - SIZE });
  // A margin, when one is asked for, is applied on both axes rather than the horizontal one alone.
  assert.deepStrictEqual(geo.free(-1, -1, SIZE, WIDTH, HEIGHT, MARGIN), { x: MARGIN, y: MARGIN });
  // A screen smaller than the bubble still yields a place to be instead of a negative one.
  assert.deepStrictEqual(geo.free(-1, -1, SIZE, 20, 20), { x: 0, y: 0 });
});

test('a drag is pixel-exact inside the usable area', () => {
  assert.deepStrictEqual(geo.clamp({ x: 410, y: 933 }, SIZE, WIDTH, HEIGHT, MARGIN), { x: 410, y: 933 });
  assert.deepStrictEqual(geo.clamp({ x: -400, y: -90 }, SIZE, WIDTH, HEIGHT, MARGIN), { x: MARGIN, y: MARGIN });
  assert.deepStrictEqual(geo.clamp({ x: 9000, y: 9000 }, SIZE, WIDTH, HEIGHT, MARGIN),
    { x: WIDTH - SIZE - MARGIN, y: HEIGHT - SIZE - MARGIN });
});

test('the spot the user left is the spot that comes back, even on another monitor', () => {
  for (const [x, y] of [[100, 300], [640, 700], [1800, 1000], [MARGIN, MARGIN]]) {
    const stored = [geo.fraction(x, WIDTH), geo.fraction(y, HEIGHT)];
    assert.deepStrictEqual(geo.restore(stored[0], stored[1], SIZE, WIDTH, HEIGHT, MARGIN), { x, y });
  }
  // A smaller screen keeps the relative spot but still keeps the bubble inside.
  assert.deepStrictEqual(geo.restore(0.5, 0.5, SIZE, 360, 240, MARGIN), { x: 180, y: 120 });
});

test('a corrupt or off-screen stored spot falls back instead of vanishing', () => {
  assert.deepStrictEqual(geo.restore(NaN, Infinity, SIZE, WIDTH, HEIGHT, MARGIN), { x: MARGIN, y: MARGIN });
  assert.deepStrictEqual(geo.restore(-5, -0.2, SIZE, WIDTH, HEIGHT, MARGIN), { x: MARGIN, y: MARGIN });
  assert.deepStrictEqual(geo.restore(2, 9, SIZE, WIDTH, HEIGHT, MARGIN),
    { x: WIDTH - SIZE - MARGIN, y: HEIGHT - SIZE - MARGIN });
  assert.strictEqual(geo.fraction(10, 0), 0);
  assert.strictEqual(geo.fraction(-100, WIDTH), 0);
  assert.strictEqual(geo.fraction(4000, WIDTH), 1);
});

test('the space menu is centred on the display, whatever the bubble is doing', () => {
  const spot = geo.centered(WIDTH, HEIGHT, MENU_WIDTH, MENU_HEIGHT, MARGIN);
  assert.deepStrictEqual(spot, { x: Math.round((WIDTH - MENU_WIDTH) / 2), y: Math.round((HEIGHT - MENU_HEIGHT) / 2) });
  assert.strictEqual(spot.x + MENU_WIDTH / 2, WIDTH / 2);
  assert.strictEqual(spot.y + MENU_HEIGHT / 2, HEIGHT / 2);
  // Odd numbers still land within a pixel of the middle, on both axes.
  for (const [w, h, pw, ph] of [[1919, 1079, 339, 321], [1366, 768, 340, 322], [1280, 820, 340, 322]]) {
    const placed = geo.centered(w, h, pw, ph, MARGIN);
    assert.ok(Math.abs(placed.x + pw / 2 - w / 2) <= 1, `${w} -> ${JSON.stringify(placed)}`);
    assert.ok(Math.abs(placed.y + ph / 2 - h / 2) <= 1, `${w}x${h} -> ${JSON.stringify(placed)}`);
  }
  // A panel taller than the screen is pinned to the top of it instead of pushed off it, and a panel
  // wider than the screen is still fully inside it.
  assert.deepStrictEqual(geo.centered(320, 480, 300, 900, 8), { x: 10, y: 0 });
  const narrow = geo.centered(360, 240, 340, 322, MARGIN);
  assert.ok(narrow.x >= 0 && narrow.x + 340 <= 360, JSON.stringify(narrow));
  assert.strictEqual(narrow.y, 0);
});
