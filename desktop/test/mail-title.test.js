'use strict';

/**
 * Mail spaces report their tab title, like social ones do.
 *
 * The 0.2.8 mail feature missed the desktop's primary signal path: Android's `reportTitle` has no kind
 * filter, so a Gmail "(3) Inbox" raised a card on the phone while desktop `readTitle` returned early for
 * anything that was not `social`. These cases pin the rule and the timing rules that must survive it —
 * a marker cooldown, the 2.5 s pairing window with a site notification — and they use the real
 * `AccountMonitor`, which is where those timing rules live.
 */

const test = require('node:test');
const assert = require('node:assert');

const { AccountMonitor, titleMonitoredKind, PAIR_MS, MARKER_COOLDOWN_MS } = require('../src/main/message-monitor.js');

/** A monitor that has just loaded its page, as [readTitle] finds one. */
const watching = (saved = {}) => {
  const monitor = new AccountMonitor(saved);
  monitor.start();
  monitor.ready('https://mail.example.com/inbox');
  return monitor;
};

test('a mail space reports its title; a tasks or AI space does not', () => {
  assert.strictEqual(titleMonitoredKind('social'), true);
  assert.strictEqual(titleMonitoredKind('mail'), true);
  for (const kind of ['tasks', 'ai', 'hidden', 'asleep', '', null, undefined, 7]) {
    assert.strictEqual(titleMonitoredKind(kind), false, String(kind));
  }
});

test('a mail-space title rise raises exactly one card, and the same title raises none', () => {
  const monitor = watching();
  const baseline = monitor.title('(3) Inbox');
  assert.deepStrictEqual([baseline.changed, baseline.incoming], [true, 0], 'the first reading is a baseline, never a card');

  const rise = monitor.title('(4) Inbox');
  assert.deepStrictEqual([rise.changed, rise.incoming], [true, 1], 'one title rise is exactly one arrival, hence one card');

  const same = monitor.title('(4) Inbox');
  assert.deepStrictEqual([same.changed, same.incoming], [false, 0], 'an unchanged title cannot raise a second card');
  assert.strictEqual(monitor.unread, 4);
});

test('a mail badge that only shows a marker respects the cooldown', () => {
  const monitor = watching();
  monitor.title('(2) Inbox');            // baseline
  monitor.title('Inbox', 900);          // read and cleared
  const first = monitor.title('• Inbox', 1_000);
  assert.strictEqual(first.incoming, 1, 'the first marker is a real arrival');
  monitor.title('Inbox', 1_500);        // cleared again
  const redraw = monitor.title('• Inbox', 1_000 + MARKER_COOLDOWN_MS / 2);
  assert.strictEqual(redraw.incoming, 0, 'the same marker redrawn within the cooldown says nothing');
  // The cooldown is measured from the last marker sighting (a suppressed redraw still resets the
  // clock), so "after the cooldown" is a full window after the redraw, not after the first marker.
  monitor.title('Inbox', 32_000);
  const later = monitor.title('• Inbox', 31_000 + MARKER_COOLDOWN_MS + 100);
  assert.strictEqual(later.incoming, 1, 'after the cooldown a marker is news again');
});

test('a mail title and a site notification for the same message are one card', () => {
  const monitor = watching();
  monitor.title('(2) Inbox');
  const title = monitor.title('(3) Inbox', 5_000);
  assert.strictEqual(title.incoming, 1);
  const notification = monitor.website({ eventId: 'mail-1', tag: 'thread' }, 5_000 + PAIR_MS / 2);
  assert.strictEqual(notification, false, 'the notification inside the pairing window is the same message');
  const next = monitor.website({ eventId: 'mail-2', tag: 'thread' }, 5_000 + PAIR_MS + 100);
  assert.strictEqual(next, true, 'a different message outside the window is a card of its own');
});

test('a mail count that falls back to zero clears the card instead of raising one', () => {
  const monitor = watching();
  monitor.title('(3) Inbox');
  const cleared = monitor.title('Inbox');
  assert.strictEqual(cleared.changed, true);
  assert.strictEqual(cleared.incoming, 0);
  assert.strictEqual(cleared.unread, 0);
});
