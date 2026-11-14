'use strict';

/**
 * The VIP badge: the one rule that decides what the bubble shows.
 *
 * These are the cases from the test plan (BADGE-01..28 and VIP-*), written as data so the truth table is
 * readable in one screen and every combination the feature claims is actually asserted. Nothing here
 * needs Electron: the module is pure, which is the point of keeping it out of the renderer.
 */

const test = require('node:test');
const assert = require('node:assert');

const vipBadge = require('../src/main/vip-badge.js');
const spaces = require('../src/main/spaces.js');

function alert(spaceId, acknowledged = false) {
  return { spaceId, acknowledged };
}

/** WCAG 2.x relative luminance, so the contrast claim is measured rather than asserted by eye. */
function luminance(hex) {
  const clean = String(hex).replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(one, other) {
  const a = luminance(one);
  const b = luminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---------------------------------------------------------------------------------------------
// BADGE-01..28 — what the bubble draws
// ---------------------------------------------------------------------------------------------
const BADGE_CASES = [
  ['nothing waiting', [], [], { count: 0, vipCount: 0, label: '0', tone: 'normal', visible: false }],
  ['one ordinary card', [alert('A')], [], { count: 1, vipCount: 0, label: '1', tone: 'normal', visible: true }],
  ['one VIP card', [alert('A')], ['A'], { count: 1, vipCount: 1, label: '1', tone: 'vip', visible: true }],
  ['three ordinary plus one VIP', [alert('A'), alert('A'), alert('B'), alert('B')], ['B'],
    { count: 4, vipCount: 2, label: '4', tone: 'vip', visible: true }],
  ['VIP space with nothing waiting', [alert('A')], ['B'], { count: 1, vipCount: 0, label: '1', tone: 'normal', visible: true }],
  ['acknowledged VIP no longer counts', [alert('A', true), alert('B')], ['A'],
    { count: 1, vipCount: 0, label: '1', tone: 'normal', visible: true }],
  ['every card acknowledged', [alert('A', true), alert('B', true)], ['A'],
    { count: 0, vipCount: 0, label: '0', tone: 'normal', visible: false }],
  ['99 ordinary cards', Array.from({ length: 99 }, () => alert('A')), [],
    { count: 99, vipCount: 0, label: '99', tone: 'normal', visible: true }],
  ['100 ordinary cards', Array.from({ length: 100 }, () => alert('A')), [],
    { count: 100, vipCount: 0, label: '99+', tone: 'normal', visible: true }],
  ['100 cards including a VIP', Array.from({ length: 100 }, (_, i) => alert(i === 0 ? 'B' : 'A')), ['B'],
    { count: 100, vipCount: 1, label: '99+', tone: 'vip', visible: true }],
  ['9999 cards', Array.from({ length: 9999 }, () => alert('A')), ['A'],
    { count: 9999, vipCount: 9999, label: '99+', tone: 'vip', visible: true }],
  ['VIP ids only from the space list', [alert('A')], [{ id: 'A', vip: true }],
    { count: 1, vipCount: 1, label: '1', tone: 'vip', visible: true }],
  ['a space that is not VIP', [alert('A')], [{ id: 'A', vip: false }],
    { count: 1, vipCount: 0, label: '1', tone: 'normal', visible: true }],
  ['an alert from an unknown space', [alert('Z')], ['A'],
    { count: 1, vipCount: 0, label: '1', tone: 'normal', visible: true }],
  ['duplicate VIP ids', [alert('A')], ['A', 'A', 'A'],
    { count: 1, vipCount: 1, label: '1', tone: 'vip', visible: true }],
  ['a null alert is ignored', [null, alert('A')], [],
    { count: 1, vipCount: 0, label: '1', tone: 'normal', visible: true }],
  ['no alert list at all', undefined, [],
    { count: 0, vipCount: 0, label: '0', tone: 'normal', visible: false }],
  ['an acknowledged flag that is not true', [{ spaceId: 'A', acknowledged: 'yes' }], [],
    { count: 1, vipCount: 0, label: '1', tone: 'normal', visible: true }],
  ['every card in a VIP space', [alert('A'), alert('A'), alert('A')], ['A'],
    { count: 3, vipCount: 3, label: '3', tone: 'vip', visible: true }],
];

for (const [name, alerts, vip, expected] of BADGE_CASES) {
  test(`badge: ${name}`, () => {
    assert.deepStrictEqual(vipBadge.badgeState(alerts, vip), expected);
  });
}

test('badge: a VIP tone is the same colour whatever the count is', () => {
  const one = vipBadge.badgeState([alert('A')], ['A']);
  const many = vipBadge.badgeState(Array.from({ length: 150 }, () => alert('A')), ['A']);
  assert.strictEqual(vipBadge.styleFor(one.tone).background, vipBadge.styleFor(many.tone).background);
  assert.strictEqual(vipBadge.styleFor(one.tone).foreground, vipBadge.styleFor(many.tone).foreground);
});

test('badge: the ordinary tone is blue with black digits', () => {
  assert.deepStrictEqual(vipBadge.styleFor(vipBadge.TONE_NORMAL), { background: '#1976d2', foreground: '#000000' });
});

test('badge: the VIP tone is red with white digits', () => {
  assert.deepStrictEqual(vipBadge.styleFor(vipBadge.TONE_VIP), { background: '#d32f2f', foreground: '#ffffff' });
});

test('badge: an unknown tone paints the ordinary badge instead of nothing', () => {
  assert.deepStrictEqual(vipBadge.styleFor('chartreuse'), vipBadge.COLORS.normal);
  assert.deepStrictEqual(vipBadge.styleFor(undefined), vipBadge.COLORS.normal);
});

test('badge: both palettes stay above WCAG AA for the 11px digits', () => {
  for (const tone of [vipBadge.TONE_NORMAL, vipBadge.TONE_VIP]) {
    const { background, foreground } = vipBadge.styleFor(tone);
    const ratio = contrast(background, foreground);
    assert.ok(ratio >= 4.5, `${tone} contrast is ${ratio.toFixed(2)}:1`);
  }
});

test('badge: the cap is the two digits the bubble can draw', () => {
  assert.strictEqual(vipBadge.BADGE_CAP, 99);
  assert.strictEqual(vipBadge.badgeState(Array.from({ length: 99 }, () => alert('A')), []).label, '99');
  assert.strictEqual(vipBadge.badgeState(Array.from({ length: 100 }, () => alert('A')), []).label, '99+');
});

test('badge: vipIdsFrom keeps order, de-duplicates, and ignores non-VIP entries', () => {
  assert.deepStrictEqual(vipBadge.vipIdsFrom([{ id: 'B', vip: true }, { id: 'A', vip: false }, { id: 'B', vip: true }]), ['B']);
  assert.deepStrictEqual(vipBadge.vipIdsFrom(['C', { id: 'C', vip: true }, 'D']), ['C', 'D']);
  assert.deepStrictEqual(vipBadge.vipIdsFrom([null, undefined, { vip: true }]), []);
  assert.deepStrictEqual(vipBadge.vipIdsFrom(null), []);
});

// ---------------------------------------------------------------------------------------------
// The mailboxes the feature adds
// ---------------------------------------------------------------------------------------------
const MAIL_IDS = ['gmail', 'outlook', 'yahoomail', 'icloudmail', 'protonmail', 'zohomail'];

test('catalog: the six mailboxes exist and are their own group', () => {
  const mail = spaces.APPS.filter((app) => app.kind === 'mail');
  assert.deepStrictEqual(mail.map((app) => app.id), MAIL_IDS);
  assert.ok(spaces.KINDS.includes('mail'));
});

for (const id of MAIL_IDS) {
  test(`catalog: ${id} opens an https mailbox and only its own hosts`, () => {
    const app = spaces.appById(id);
    assert.ok(app, `${id} is in the catalog`);
    assert.strictEqual(app.kind, 'mail');
    assert.ok(app.home.startsWith('https://'), `${id} home is https`);
    assert.ok(app.hosts.length > 0);
    const space = { id: 'C', appId: id, extraHosts: [] };
    assert.strictEqual(spaces.pageAllowed(space, app.home), true, `${id} home is allowed`);
    assert.strictEqual(spaces.pageAllowed(space, 'https://example.com/'), false, `${id} refuses a foreign host`);
    assert.strictEqual(spaces.pageAllowed(space, `https://${app.hosts[0]}.evil.com/`), false, `${id} refuses a look-alike host`);
    assert.ok(app.login.length > 40, `${id} explains its sign-in`);
  });
}

test('catalog: a mailbox stored under the old phone default is repaired once', () => {
  // The old default put every non-social space on the phone layout; for a mailbox that is the legacy
  // mobile client, so a file written before the fix gets the desktop web app once.
  const old = spaces.normalize({ version: spaces.MAIL_LAYOUT_VERSION - 1,
    spaces: [{ id: 'A', appId: 'gmail', kind: 'mail', phoneLayout: true }] });
  assert.strictEqual(spaces.accountFor(old, 'A').phoneLayout, false);
  // From the current version on, a stored choice is the user's and is kept either way.
  const kept = spaces.normalize({ version: spaces.MAIL_LAYOUT_VERSION,
    spaces: [{ id: 'A', appId: 'gmail', kind: 'mail', phoneLayout: true }] });
  assert.strictEqual(spaces.accountFor(kept, 'A').phoneLayout, true);
  const other = spaces.normalize({ version: 1,
    spaces: [{ id: 'A', appId: 'prolific', kind: 'tasks', phoneLayout: true }] });
  assert.strictEqual(spaces.accountFor(other, 'A').phoneLayout, true, 'a task panel is untouched');
});

test('catalog: a mailbox space keeps its kind through a saved file', () => {
  const state = spaces.normalize({ spaces: [{ id: 'A', appId: 'gmail' }] });
  assert.strictEqual(spaces.accountFor(state, 'A').kind, 'mail');
  assert.strictEqual(spaces.accountFor(state, 'A').appId, 'gmail');
});

test('catalog: a mailbox starts on its desktop web app, not the legacy mobile build', () => {
  // Gmail and Outlook serve the modern web app to a desktop user agent and an older mobile web client
  // to a phone one, so the mailbox default is the desktop site; the mobile site stays one switch away.
  assert.strictEqual(spaces.defaultPhoneLayout(spaces.appById('gmail'), 'mail'), false);
  assert.strictEqual(spaces.defaultPhoneLayout(spaces.appById('outlook'), 'mail'), false);
  assert.strictEqual(spaces.defaultPhoneLayout(spaces.appById('yahoomail'), 'mail'), false);
  assert.strictEqual(spaces.defaultPhoneLayout(spaces.appById('prolific'), 'tasks'), true, 'task panels keep the phone layout');
});

test('catalog: an identity host is allowed only inside a mailbox space', () => {
  const gmail = { id: 'C', appId: 'gmail', extraHosts: [] };
  const outlook = { id: 'D', appId: 'outlook', extraHosts: [] };
  assert.strictEqual(spaces.pageAllowed(gmail, 'https://accounts.google.com/signin'), true);
  assert.strictEqual(spaces.pageAllowed(outlook, 'https://login.microsoftonline.com/common/oauth2'), true);
  // The same host in a space that has nothing to do with it is still refused.
  assert.strictEqual(spaces.pageAllowed(gmail, 'https://login.microsoftonline.com/common/oauth2'), false);
});

// ---------------------------------------------------------------------------------------------
// The VIP flag itself
// ---------------------------------------------------------------------------------------------
test('vip: a new space is not VIP', () => {
  const state = spaces.defaultState();
  assert.strictEqual(spaces.accountFor(state, 'A').vip, false);
  assert.strictEqual(spaces.accountFor(state, 'B').vip, false);
  const withThird = spaces.enableSlot(state, 'C');
  assert.strictEqual(spaces.accountFor(withThird, 'C').vip, false);
});

test('vip: marking and clearing a space touches nothing else', () => {
  const start = spaces.enableSlot(spaces.defaultState(), 'C');
  const marked = spaces.setVip(start, 'C', true);
  assert.strictEqual(spaces.accountFor(marked, 'C').vip, true);
  assert.strictEqual(spaces.accountFor(marked, 'A').vip, false);
  assert.strictEqual(spaces.accountFor(marked, 'B').vip, false);
  assert.deepStrictEqual(marked.slots, start.slots);
  assert.deepStrictEqual(marked.spaces.map((space) => space.appId), start.spaces.map((space) => space.appId));

  const cleared = spaces.setVip(marked, 'C', false);
  assert.strictEqual(spaces.accountFor(cleared, 'C').vip, false);
});

test('vip: setting the same value returns the same state (no pointless save)', () => {
  const start = spaces.setVip(spaces.enableSlot(spaces.defaultState(), 'C'), 'C', true);
  assert.strictEqual(spaces.setVip(start, 'C', true), start);
  assert.strictEqual(spaces.setVip(start, 'C', 'yes'), start, 'only a real true marks a space');
});

test('vip: an unknown or hidden space cannot be marked', () => {
  const start = spaces.defaultState();
  assert.strictEqual(spaces.setVip(start, 'Z', true), start);
  assert.strictEqual(spaces.setVip(start, '', true), start);
  assert.strictEqual(spaces.setVip(start, null, true), start);
});

test('vip: the flag survives a save and a restore', () => {
  const marked = spaces.setVip(spaces.enableSlot(spaces.defaultState(), 'C'), 'C', true);
  const restored = spaces.normalize(JSON.parse(JSON.stringify(marked)));
  assert.strictEqual(spaces.accountFor(restored, 'C').vip, true);
  assert.strictEqual(spaces.accountFor(restored, 'A').vip, false);
});

test('vip: a hand-edited file is read as plain true/false', () => {
  const read = (vip) => spaces.accountFor(spaces.normalize({ spaces: [{ id: 'A', vip }] }), 'A').vip;
  assert.strictEqual(read(true), true);
  assert.strictEqual(read(false), false);
  assert.strictEqual(read('true'), false);
  assert.strictEqual(read(1), false);
  assert.strictEqual(read(null), false);
  assert.strictEqual(read(undefined), false);
});

test('vip: hiding a space for a while keeps its flag for when it comes back', () => {
  const marked = spaces.setVip(spaces.enableSlot(spaces.defaultState(), 'C'), 'C', true);
  const hidden = spaces.disableSlot(marked, 'C');
  const shown = spaces.enableSlot(hidden, 'C');
  assert.strictEqual(spaces.accountFor(shown, 'C').vip, true);
});

test('vip: the badge follows the flag end to end', () => {
  const state = spaces.setVip(spaces.enableSlot(spaces.defaultState(), 'C'), 'C', true);
  const waiting = [alert('C'), alert('A')];
  const before = vipBadge.badgeState(waiting, vipBadge.vipIdsFrom(spaces.enabledSpaces(state)));
  assert.strictEqual(before.tone, 'vip');
  assert.strictEqual(before.count, 2);
  const cleared = spaces.setVip(state, 'C', false);
  const after = vipBadge.badgeState(waiting, vipBadge.vipIdsFrom(spaces.enabledSpaces(cleared)));
  assert.strictEqual(after.tone, 'normal');
  assert.strictEqual(after.count, 2);
});

test('vip: a mailbox and a social space can both be marked, and either one turns the badge red', () => {
  let state = spaces.enableSlot(spaces.defaultState(), 'C');
  state = spaces.selectApp(state, 'C', 'gmail');
  state = spaces.setVip(state, 'C', true);
  const gmailOnly = vipBadge.badgeState([alert('C')], vipBadge.vipIdsFrom(spaces.enabledSpaces(state)));
  assert.strictEqual(gmailOnly.tone, 'vip');
  const social = vipBadge.badgeState([alert('A')], vipBadge.vipIdsFrom(spaces.enabledSpaces(state)));
  assert.strictEqual(social.tone, 'normal');
});
