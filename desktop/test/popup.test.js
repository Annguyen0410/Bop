'use strict';

const test = require('node:test');
const assert = require('node:assert');
const popup = require('../src/main/popup.js');

const NOW = 1_790_000_000_000;

function alert(kind, tag, body = 'hello') {
  return { spaceId: 'C', tag, kind, title: `Account C · TikTok`, body };
}

test('only reminders the user asked for pop up', () => {
  assert.strictEqual(popup.popsUp(alert('web', 'web:t1')), true);
  assert.strictEqual(popup.popsUp(alert('watch', 'watch:C')), true);
  // A blocked link and a failed load are still listed in Alerts, but they must never interrupt work.
  assert.strictEqual(popup.popsUp(alert('blocked', 'blocked:1')), false);
  assert.strictEqual(popup.popsUp(alert('error', 'load:1')), false);
  assert.strictEqual(popup.popsUp(null), false);
});

test('a newer alert takes the card over and counts the ones it replaced', () => {
  let queue = popup.empty();
  queue = popup.arrive(queue, alert('web', 'web:1', 'first'), NOW);
  assert.deepStrictEqual(popup.card(queue), { spaceId: 'C', key: 'C:web:1', kind: 'web', title: 'Account C · TikTok', body: 'first', also: 0 });

  queue = popup.arrive(queue, alert('web', 'web:2', 'second'), NOW + 500);
  assert.strictEqual(popup.card(queue).body, 'second');
  assert.strictEqual(popup.card(queue).also, 1);

  queue = popup.arrive(queue, alert('web', 'web:3', 'third'), NOW + 900);
  assert.strictEqual(popup.card(queue).also, 2);
  // The newest alert restarts the timer, so the card cannot vanish mid-read.
  assert.strictEqual(popup.expired(queue, NOW + 5000), false);
  assert.strictEqual(popup.expired(queue, NOW + 900 + popup.POPUP_MS), true);
});

test('an alert that does not pop never disturbs the card that is up', () => {
  let queue = popup.arrive(popup.empty(), alert('web', 'web:1', 'first'), NOW);
  const before = popup.card(queue);
  queue = popup.arrive(queue, alert('blocked', 'blocked:1'), NOW + 100);
  assert.deepStrictEqual(popup.card(queue), before);
  assert.strictEqual(popup.expired(queue, NOW + 100), false);
  // A refused alert on an empty queue leaves it empty rather than creating a card with no content.
  const refused = popup.arrive(popup.empty(), alert('error', 'load:1'), NOW);
  assert.strictEqual(popup.card(refused), null);
  assert.strictEqual(popup.expired(refused, NOW + popup.POPUP_MS), false);
});

test('hiding the card forgets it: the next alert starts a fresh count', () => {
  let queue = popup.arrive(popup.empty(), alert('web', 'web:1', 'first'), NOW);
  queue = popup.arrive(queue, alert('web', 'web:2', 'second'), NOW);
  assert.strictEqual(popup.card(queue).also, 1);
  queue = popup.dismiss();
  assert.strictEqual(popup.card(queue), null);
  queue = popup.arrive(queue, alert('web', 'web:3', 'third'), NOW);
  assert.strictEqual(popup.card(queue).also, 0);
});

test('the key of an alert is what acknowledging it uses', () => {
  const queue = popup.arrive(popup.empty(), alert('web', 'web:same-thread'), NOW);
  assert.strictEqual(popup.card(queue).key, 'C:web:same-thread');
});

test('the card sits in the corner, fully on screen, and steps around the bubble', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 336, height: 128 };
  assert.deepStrictEqual(popup.spot(area, size, null), { x: 1920 - 336 - popup.MARGIN, y: 1040 - 128 - popup.MARGIN });

  // A bubble docked in that corner would be covered, so the card moves up and stays clear of it.
  const bubble = { x: 1920 - 64, y: 1040 - 200, width: 64, height: 64 };
  const lifted = popup.spot(area, size, bubble);
  assert.deepStrictEqual(lifted, { x: 1920 - 336 - popup.MARGIN, y: 1040 - 200 - 128 - popup.MARGIN });
  assert.ok(lifted.y + size.height <= bubble.y);

  // A bubble on the other side of the screen changes nothing.
  assert.deepStrictEqual(popup.spot(area, size, { x: 0, y: 300, width: 64, height: 64 }),
    { x: 1920 - 336 - popup.MARGIN, y: 1040 - 128 - popup.MARGIN });

  // A secondary display keeps its own origin.
  const second = { x: 1920, y: 120, width: 1280, height: 800 };
  assert.deepStrictEqual(popup.spot(second, size, null), { x: 1920 + 1280 - 336 - popup.MARGIN, y: 120 + 800 - 128 - popup.MARGIN });

  // A work area with no room left above the bubble still shows the card: being reminded matters more
  // than keeping the bubble visible, and the card never leaves the work area.
  const cramped = { x: 0, y: 0, width: 400, height: 180 };
  const squeezed = popup.spot(cramped, size, { x: 0, y: 100, width: 64, height: 64 });
  assert.deepStrictEqual(squeezed, { x: 400 - 336 - popup.MARGIN, y: 180 - 128 - popup.MARGIN });
  assert.ok(squeezed.x >= cramped.x && squeezed.y >= cramped.y);
  assert.ok(squeezed.x + size.width <= cramped.width && squeezed.y + size.height <= cramped.height);
});
