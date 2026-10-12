'use strict';

const test = require('node:test');
const assert = require('node:assert');
const watcher = require('../src/main/watcher.js');
const spaces = require('../src/main/spaces.js');

function watch(patch) {
  return { ...spaces.watchDefaults(), enabled: true, minutes: 10, ...patch };
}

test('the first reading of a page never raises a card', () => {
  const first = watcher.apply(watch(), { title: 'Studies', text: '3 available' }, 1000);
  assert.strictEqual(first.alert, false, 'watching a page you already have open must not fire');
  assert.ok(first.watch.fingerprint);
  assert.strictEqual(first.watch.lastChangeAt, 0);
  assert.strictEqual(first.watch.lastCheckAt, 1000);
  // The second reading of the identical page is still quiet.
  const second = watcher.apply(first.watch, { title: 'Studies', text: '3 available' }, 2000);
  assert.strictEqual(second.alert, false);
  assert.strictEqual(second.watch.fingerprint, first.watch.fingerprint);
});

test('a real change alerts once and not again until the page changes back', () => {
  const first = watcher.apply(watch(), { title: 'Studies', text: '3 available' }, 1000);
  const changed = watcher.apply(first.watch, { title: 'Studies', text: '4 available' }, 2000);
  assert.strictEqual(changed.alert, true);
  assert.strictEqual(changed.summary, '4 available', 'the body text is the useful part of the card');
  assert.strictEqual(changed.watch.lastChangeAt, 2000);
  const repeated = watcher.apply(changed.watch, { title: 'Studies', text: '4 available' }, 3000);
  assert.strictEqual(repeated.alert, false, 'the same page must not alert twice');
  assert.strictEqual(repeated.watch.lastChangeAt, 2000);
  const textOnly = watcher.apply(first.watch, { title: '', text: 'something new here' }, 4000);
  assert.strictEqual(textOnly.alert, true);
  assert.strictEqual(textOnly.summary, 'something new here');
});

test('whitespace and line-break churn is not a change', () => {
  const first = watcher.apply(watch(), { title: 'A', text: 'one  two\nthree' }, 1000);
  const reflowed = watcher.apply(first.watch, { title: 'A', text: 'one two three' }, 2000);
  assert.strictEqual(reflowed.alert, false, 'a re-render that only moves whitespace is not news');
});

test('an outage is never a change, but a change during the outage is still reported', () => {
  const first = watcher.apply(watch(), { title: 'Studies', text: '3 available' }, 1000);
  const failed = watcher.apply(first.watch, { error: 'net::ERR_INTERNET_DISCONNECTED' }, 2000);
  assert.strictEqual(failed.alert, false, 'a dropped connection is not a page change');
  assert.strictEqual(failed.watch.fingerprint, first.watch.fingerprint, 'an outage keeps the last known page');
  assert.strictEqual(failed.watch.failures, 1);
  // The same page coming back is quiet and healthy again...
  const recovered = watcher.apply(failed.watch, { title: 'Studies', text: '3 available' }, 3000);
  assert.strictEqual(recovered.alert, false);
  assert.strictEqual(recovered.watch.failures, 0);
  // ...but a panel that changed while the network was down must not be swallowed.
  const changedDuringOutage = watcher.apply(failed.watch, { title: 'Studies', text: '5 available' }, 4000);
  assert.strictEqual(changedDuringOutage.alert, true);
  // An empty page is a failure too, never a "the page went blank" card.
  assert.strictEqual(watcher.apply(watch(), { title: '', text: '' }, 1).alert, false);
  assert.strictEqual(watcher.fingerprint(null), null);
  assert.strictEqual(watcher.fingerprint({ title: '  ', text: '  ' }), null);
});

test('consecutive failures stretch the interval, capped', () => {
  assert.strictEqual(watcher.intervalMinutes(watch({ minutes: 10, failures: 0 })), 10);
  assert.strictEqual(watcher.intervalMinutes(watch({ minutes: 10, failures: 1 })), 10);
  assert.strictEqual(watcher.intervalMinutes(watch({ minutes: 10, failures: 2 })), 20);
  assert.strictEqual(watcher.intervalMinutes(watch({ minutes: 10, failures: 3 })), 30);
  assert.strictEqual(watcher.intervalMinutes(watch({ minutes: 10, failures: 4 })), 40);
  assert.strictEqual(watcher.intervalMinutes(watch({ minutes: 10, failures: 99 })), 40, 'never unbounded');
  assert.strictEqual(watcher.intervalMinutes(watch({ minutes: 720, failures: 4 })), 720, 'clamped to the app ceiling');
  assert.strictEqual(watcher.intervalMinutes(watch({ minutes: 0 })), 10, 'nonsense falls back, never to zero');
});

test('only watched spaces are ever due, and the oldest runs first', () => {
  const now = 10_000_000;
  const list = [
    { id: 'A', watch: watch({ enabled: false, lastCheckAt: 0 }) },
    { id: 'B', watch: watch({ lastCheckAt: now - 11 * 60000 }) },
    { id: 'C', watch: watch({ lastCheckAt: now - 1 * 60000 }) },
    { id: 'D', watch: watch({ lastCheckAt: 0 }) },
    { id: 'E', watch: watch({ minutes: 60, lastCheckAt: now - 11 * 60000 }) },
  ];
  assert.deepStrictEqual(watcher.dueSpaces(list, now).map((space) => space.id), ['D', 'B']);
  assert.strictEqual(watcher.isDue(list[0].watch, now), false, 'a disabled watch is never due');
  assert.strictEqual(watcher.isDue(null, now), false);
  assert.strictEqual(watcher.isDue(watch({ lastCheckAt: now }), now), false);
});

test('a phrase filter keeps a noisy board quiet until the page says what matters', () => {
  const first = watcher.apply(watch({ require: 'available' }), { title: 'Studies', text: '3 studies open' }, 1000);
  assert.strictEqual(first.alert, false, 'the first reading is never a card');
  const noisy = watcher.apply(first.watch, { title: 'Studies', text: '4 studies open' }, 2000);
  assert.strictEqual(noisy.alert, false, 'a change without the required phrase is not worth a card');
  assert.strictEqual(noisy.filtered, true);
  assert.notStrictEqual(noisy.watch.fingerprint, first.watch.fingerprint, 'the fingerprint still moves forward');
  const good = watcher.apply(noisy.watch, { title: 'Studies', text: '5 studies available' }, 3000);
  assert.strictEqual(good.alert, true, 'a change that matches the phrase is reported');
  assert.strictEqual(good.summary, '5 studies available');

  // Case-insensitive, and it looks at the title as well as the body.
  assert.ok(watcher.passesFilter(watch({ require: 'AVAILABLE' }), { title: 'A study is available', text: '' }));
  assert.ok(!watcher.passesFilter(watch({ require: 'available' }), { title: 'Studies', text: 'nothing open' }));
  // An ignore phrase mutes a change that contains it.
  assert.ok(!watcher.passesFilter(watch({ ignore: 'sponsored' }), { title: 'Board', text: 'a sponsored slot' }));
  assert.ok(watcher.passesFilter(watch({ ignore: 'sponsored' }), { title: 'Board', text: 'a real study' }));
  assert.ok(watcher.passesFilter(watch(), { title: '', text: '' }), 'with neither phrase set, every change passes');

  const ignored = watcher.apply(watch({ ignore: 'sponsored' }), { title: 'B', text: 'sponsored' }, 1000);
  const muted = watcher.apply(ignored.watch, { title: 'B', text: 'sponsored again' }, 2000);
  assert.strictEqual(muted.alert, false);
  assert.strictEqual(muted.filtered, true);
  assert.strictEqual(muted.summary, null);
});

test('the summary is short enough to read in a card', () => {
  const long = 'x'.repeat(500);
  const summary = watcher.summarize({ title: 'T', text: long });
  assert.ok(summary.length <= watcher.MAX_SUMMARY, String(summary.length));
  assert.ok(summary.endsWith('…'));
  assert.strictEqual(watcher.summarize({ title: 'Just a title', text: '' }), 'Just a title');
  assert.strictEqual(watcher.summarize({}), 'The page changed.');
  assert.notStrictEqual(watcher.hash('a'), watcher.hash('b'));
});
