'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const health = require('../src/main/monitor-health.js');
const { AccountMonitor } = require('../src/main/message-monitor.js');

/**
 * The rule that decides when a space has stopped being watched. Every case here is a real state the
 * desktop monitor can be in; nothing is mocked beyond the status strings themselves.
 */

test('a working space is never told about its own health', () => {
  assert.equal(health.transition(null, 'loading'), null);
  assert.equal(health.transition('loading', 'observing-auth-unknown'), null);
  assert.equal(health.transition('observing-auth-unknown', 'temporarily-unavailable'), null);
  assert.equal(health.transition('temporarily-unavailable', 'observing-auth-unknown'), null);
});

test('landing on a sign-in screen raises one card and staying there raises no more', () => {
  const step = health.transition('observing-auth-unknown', 'reauthentication-required');
  assert.deepEqual(step, { action: 'raise', code: 'reauthentication-required' });
  assert.equal(health.transition('reauthentication-required', 'reauthentication-required'), null);
  // A reload that lands on the login page again is the same fact, not a second interruption.
  assert.equal(health.transition('loading', 'reauthentication-required')?.action, 'raise');
  assert.equal(health.transition('reauthentication-required', 'loading'), null);
});

test('exhausted retries are their own, louder state than a temporary failure', () => {
  assert.equal(health.transition('temporarily-unavailable', 'temporarily-unavailable'), null);
  assert.deepEqual(health.transition('temporarily-unavailable', 'monitoring-stopped'),
    { action: 'raise', code: 'monitoring-stopped' });
  // The two broken states are different problems, so moving between them is news.
  assert.deepEqual(health.transition('reauthentication-required', 'monitoring-stopped'),
    { action: 'raise', code: 'monitoring-stopped' });
});

test('recovery clears the card once, and only if one was raised', () => {
  assert.deepEqual(health.transition('reauthentication-required', 'observing-auth-unknown'), { action: 'clear' });
  assert.deepEqual(health.transition('monitoring-stopped', 'observing-auth-unknown'), { action: 'clear' });
  // A space that never broke does not broadcast an empty recovery on every load.
  assert.equal(health.transition('observing-auth-unknown', 'observing-auth-unknown'), null);
  assert.equal(health.transition('loading', 'observing-auth-unknown'), null);
});

test('the card names the account and explains the state without quoting the page', () => {
  const signIn = health.describe('reauthentication-required', 'Work');
  assert.match(signIn.title, /^Work needs you to sign in again$/);
  assert.match(signIn.body, /sign-in screen/);
  const stopped = health.describe('monitoring-stopped', 'Home');
  assert.match(stopped.title, /^Home stopped being monitored$/);
  assert.match(stopped.body, /saved session is kept/);
  // Nothing from a page can end up here, because nothing from a page is passed in.
  assert.equal(health.describe('observing-auth-unknown', 'Work'), null);
  // A nameless space still gets a sentence rather than an empty card.
  assert.match(health.describe('monitoring-stopped', '   ').title, /^This account stopped/);
});

test('every health card for a space carries the same tag, so they replace instead of stacking', () => {
  assert.equal(health.HEALTH_TAG, 'health');
  assert.deepEqual(new Set(health.UNHEALTHY), new Set(['reauthentication-required', 'monitoring-stopped']));
});

test('the monitor reports the state that raises the card, and keeps only timestamps about it', () => {
  const monitor = new AccountMonitor();
  monitor.start();
  assert.equal(monitor.status, 'loading');
  monitor.ready('https://www.messenger.com/login');
  assert.equal(monitor.status, 'reauthentication-required');
  assert.ok(monitor.lastReadyAt > 0, 'a successful load is recorded even when it is a login page');
  // A login page accepts no title readings, so it cannot announce anything.
  assert.deepEqual(monitor.title('(3) Messenger'), { changed: false, incoming: 0 });
  assert.equal(monitor.lastEventAt, 0);

  monitor.ready('https://www.messenger.com/');
  assert.equal(monitor.status, 'observing-auth-unknown');
  const first = monitor.title('(1) Messenger', 10_000);
  assert.equal(first.changed, true);
  assert.equal(monitor.lastEventAt, 0, 'a baseline is a reading, not an arrival');
  monitor.title('(2) Messenger', 20_000);
  assert.equal(monitor.lastEventAt, 20_000, 'an accepted arrival is timestamped for the health panel');

  monitor.suspend();
  assert.equal(monitor.status, 'monitoring-stopped');
  assert.deepEqual(monitor.title('(3) Messenger', 30_000), { changed: false, incoming: 0 });
});

test('a suspended monitor is not revived by a stale title event', () => {
  const monitor = new AccountMonitor();
  monitor.start();
  monitor.ready('https://www.messenger.com/');
  monitor.title('(1) Messenger', 1_000);
  monitor.suspend();
  // The page may still emit a title after the retry cap; it must not look like a new message.
  assert.equal(monitor.title('(5) Messenger', 2_000).changed, false);
  assert.equal(monitor.lastEventAt, 0);
});
