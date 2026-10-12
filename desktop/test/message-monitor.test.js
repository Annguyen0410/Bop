'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountMonitor, unreadCount, retryDelay, loginPage, MAX_SEEN } = require('../src/main/message-monitor.js');
const spaces = require('../src/main/spaces.js');

function ready(saved) { const monitor = new AccountMonitor(saved); monitor.start(); monitor.ready('https://example.com/chat'); return monitor; }

test('three accounts on the same service have independent baselines and unread', () => {
  const accounts = ['A', 'B', 'C'].map(() => ready());
  accounts.forEach(m => assert.equal(m.title('(4) Chat', 0).incoming, 0));
  assert.equal(accounts[1].title('(5) Chat', 100).incoming, 1);
  assert.equal(accounts[2].title('(6) Chat', 101).incoming, 2);
  assert.equal(accounts[0].unread, 4);
  assert.equal(accounts[1].title('(5) Chat', 102).incoming, 0);
});

test('decreases update unread without alerting; dot cannot identify a second message', () => {
  const m = ready(); m.title('(3) Chat');
  assert.deepEqual(m.title('(1) Chat'), { changed: true, incoming: 0, unread: 1 });
  assert.equal(m.title('Chat').unread, 0);
  assert.equal(m.title('• Chat').incoming, 1);
  assert.equal(m.title('• Chat').incoming, 0);
});

test('parses bounded badge shapes and rejects unrelated oversized numbers', () => {
  assert.equal(unreadCount('12 · Telegram'), 12);
  assert.equal(unreadCount('Messenger (99)'), 99);
  assert.equal(unreadCount('(1000) Messenger'), 0);
  assert.equal(unreadCount('365 days'), 0);
  assert.equal(unreadCount('1,234 members'), 0);
});

test('normal restart rebaselines historical unread; supported failure recovery keeps baseline', () => {
  const m = ready({ unread: 1 });
  assert.equal(m.title('(10) Chat', 0).incoming, 0);
  assert.equal(m.unavailable(), 30_000);
  assert.equal(m.title('(12) Chat', 10).incoming, 0);
  m.start(true); m.ready('https://example.com/chat');
  assert.equal(m.title('(12) Chat', 100).incoming, 2);
  m.start(); m.ready('https://example.com/chat');
  assert.equal(m.title('(15) Chat', 200).incoming, 0);
});

test('explicit duplicate event IDs are ignored but repeated identical text has distinct events', () => {
  const m = ready();
  const event = { eventId: 'document:1', tag: 'same-chat', title: 'Chat', body: 'Hi' };
  assert.equal(m.website(event, 0), true);
  assert.equal(m.website(event, 1), false);
  assert.equal(m.website({ ...event, eventId: 'document:2' }, 2), true);
  for (let i = 0; i < MAX_SEEN * 2; i++) m.website({ eventId: `document:${i + 3}` }, 3);
  assert.equal(m.seen.size, MAX_SEEN);
  assert.ok(m.signals.length <= 128);
});

test('title and notification pair in either order; one duplicate never consumes a later distinct event', () => {
  for (const websiteFirst of [true, false]) {
    const m = ready(); m.title('Chat', 0);
    const event = { eventId: '1' };
    const signals = websiteFirst
      ? [m.website(event, 100), m.title('(1) Chat', 101).incoming > 0]
      : [m.title('(1) Chat', 100).incoming > 0, m.website(event, 101)];
    assert.equal(signals.filter(Boolean).length, 1);
    assert.equal(m.website(event, 102), false);
    assert.equal(m.website({ eventId: '2' }, 103), true);
  }
});

test('burst title delta pairs one credit per event and later events are not blanket-muted', () => {
  const m = ready(); m.title('Chat', 0);
  assert.equal(m.title('(3) Chat', 100).incoming, 3);
  assert.equal(m.website({ eventId: '1' }, 101), false);
  assert.equal(m.website({ eventId: '2' }, 102), false);
  assert.equal(m.website({ eventId: '3' }, 103), false);
  assert.equal(m.website({ eventId: '4' }, 104), true);
  assert.equal(m.title('(4) Chat', 105).incoming, 0);
  assert.equal(m.website({ eventId: '5' }, 5000), true);
});

test('expired account is a status hint and does not affect peers', () => {
  const a = ready(), b = ready();
  a.title('(20) Chat');
  a.ready('https://example.com/login?secret=never-store');
  assert.equal(a.status, 'reauthentication-required');
  assert.equal(a.website({ eventId: '1' }), false);
  assert.equal(a.title('(5) Chat').incoming, 0);
  b.title('Chat'); assert.equal(b.title('(1) Chat').incoming, 1);
  a.ready('https://example.com/chat');
  assert.equal(a.title('(5) Chat').incoming, 0);
  assert.ok(loginPage('https://example.com/auth/signin'));
  assert.equal(retryDelay(1), 30_000);
  assert.equal(retryDelay(100), 900_000);
});

test('saved metadata is bounded, contains no credentials/previews and respects sound mute', () => {
  const m = ready(); m.title('(7) Chat');
  assert.deepEqual(m.saved(), { unread: 7 });
  const raw = { ...spaces.defaultState(), messageSound: false, monitorState: { A: { unread: 7, cookie: 'bad' }, B: { unread: -1 }, C: { unread: 99 } } };
  const restored = spaces.normalize(raw);
  assert.equal(restored.messageSound, false);
  assert.deepEqual(restored.monitorState, { A: { unread: 7 }, B: { unread: null } });
});
