'use strict';

/**
 * What a watch actually reads, and what its phrases actually match.
 *
 * The behaviour pinned here is the one documented in watched-page.js: a matching CSS selector scopes the
 * text, an absent or dead selector widens the read to the whole page body, and only the first 20 000
 * characters are ever seen by change detection or by the `require` / `ignore` phrases. It is pinned
 * rather than narrowed on purpose — a watch silenced by an `ignore` phrase must not start ringing again
 * under an upgrade without its owner asking.
 *
 * jsdom has no `innerText`, so the harness below stands in for the browser's own: innerText is what the
 * user sees, textContent is the fallback the reader already uses per node. The shipped script is
 * evaluated as written, not a copy of its logic.
 */

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const watchedPage = require('../src/main/watched-page.js');
const watcher = require('../src/main/watcher.js');

const watch = (patch = {}) => ({ enabled: true, minutes: 10, selector: '', require: '', ignore: '', ...patch });

/** A page whose script runs in a DOM that answers innerText the way a browser does. */
function read(html, selector) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    configurable: true,
  });
  return window.eval(watchedPage.readScript(selector));
}

const board = `<html><head><title>3 studies · Study board</title></head><body>
  <ul id="jobs"><li>Study A · 5 places</li><li>Study B · 2 places</li></ul>
  <footer>Sponsored · our partners pay for this slot</footer>
</body></html>`;

test('a matching selector scopes the read: the footer is outside it', () => {
  const reading = read(board, '#jobs');
  assert.strictEqual(reading.title, '3 studies · Study board');
  assert.ok(reading.text.includes('Study A · 5 places'));
  assert.ok(!reading.text.includes('Sponsored'), 'text outside the selector is not read at all');
  // So an ignore phrase naming the footer cannot silence a watch that is scoped to the list.
  assert.ok(watcher.passesFilter(watch({ ignore: 'sponsored' }), reading), 'the scoped watch is not silenced by the footer');
});

test('without a selector the whole page is read, and the footer can silence the watch', () => {
  for (const selector of ['', '#gone', '.nothing-here']) {
    const reading = read(board, selector);
    assert.ok(reading.text.includes('Sponsored'), `selector ${JSON.stringify(selector)} falls back to the page body`);
    assert.strictEqual(watcher.passesFilter(watch({ ignore: 'sponsored' }), reading), false,
      `an ignore phrase that appears anywhere on the page silences this watch (${JSON.stringify(selector)})`);
    assert.ok(watcher.passesFilter(watch({ require: 'sponsored' }), reading),
      'and a require phrase in the footer satisfies it');
  }
});

test('the read carries at most 20 000 characters of text', () => {
  const long = `<html><head><title>Board</title></head><body><div id="jobs">${'a'.repeat(30000)}</div></body></html>`;
  for (const selector of ['#jobs', '']) {
    const reading = read(long, selector);
    assert.strictEqual(reading.text.length, watchedPage.MAX_TEXT, `selector ${JSON.stringify(selector)}`);
  }
});

test('a change past the cut is invisible: no card and no phrase', () => {
  const before = { title: 'Board', text: 'a'.repeat(20000) };
  const after = { title: 'Board', text: `${'a'.repeat(20000)}study available` };
  const first = watcher.apply(watch({ require: 'available' }), before, 1000);
  const second = watcher.apply(first.watch, after, 2000);
  assert.strictEqual(second.alert, false, 'the difference is below the 20 000-character horizon');
  assert.strictEqual(watcher.fingerprint(before), watcher.fingerprint(after), 'so it is not a change at all');
  // And a phrase that only exists past the cut can never be required.
  assert.strictEqual(watcher.passesFilter(watch({ require: 'study available' }), after), false);
});

test('phrases match the title and the text together, ignoring case', () => {
  const reading = { title: 'Study AVAILABLE now', text: 'five places' };
  assert.ok(watcher.passesFilter(watch({ require: 'available' }), reading), 'the title alone can satisfy');
  assert.strictEqual(watcher.passesFilter(watch({ ignore: 'AVAILABLE' }), reading), false, 'and the title alone can silence');
  assert.ok(!watcher.passesFilter(watch({ require: 'five PLACES left' }), reading), 'substrings only, no fuzzy match');
});

test('the script main.js ships is this rule and nothing else', () => {
  const source = watchedPage.readScript('#jobs');
  assert.ok(source.includes('collectWatchedText'), 'the page runs the documented function');
  assert.ok(source.includes(JSON.stringify('#jobs')), 'with the selector the space carries');
  assert.strictEqual(watchedPage.collectWatchedText.length, 2, 'the shipped function closes over nothing');
});
