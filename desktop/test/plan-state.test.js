'use strict';

/**
 * Desktop plan — the space state machine: identity names, the VIP flag and what a saved file keeps.
 *
 * One case per catalog entry per rule, so a single bad appId cannot ride along on a passing neighbour.
 * The identity cases are the bijective base-26 names both builds share; the state cases are the part a
 * user can observe after a restart.
 */

const test = require('node:test');
const assert = require('node:assert');

const spaces = require('../src/main/spaces.js');
const vipBadge = require('../src/main/vip-badge.js');

const APPS = spaces.APPS;

// ---------------------------------------------------------------------------------------------
// Identity: A..Z, AA.., no ceiling, and nothing else
// ---------------------------------------------------------------------------------------------
const ORDINALS = [0, 1, 2, 12, 24, 25, 26, 27, 51, 52, 53, 100, 675, 676, 677, 701, 702, 1000, 12345, 17575, 17576, 2147483646];

for (const ordinal of ORDINALS) {
  test(`identity/${ordinal}: name and back again`, () => {
    const name = spaces.nameForOrdinal(ordinal);
    assert.ok(/^[A-Z]+$/.test(name), `${ordinal} -> ${name}`);
    assert.ok(name.length <= 7);
    assert.strictEqual(spaces.ordinalForName(name), ordinal);
  });
}

for (const bad of [-1, 1.5, '7', null, undefined, NaN, 2147483648, Infinity]) {
  test(`identity/rejects ${String(bad)}`, () => {
    assert.strictEqual(spaces.nameForOrdinal(bad), null);
  });
}

for (const bad of ['', 'a', 'A1', 'A-', 'ABCDEFGH', ' A', 'A ', 'Ä', null, undefined, 7]) {
  test(`identity/rejects name ${JSON.stringify(bad)}`, () => {
    assert.strictEqual(spaces.ordinalForName(bad), null);
  });
}

test('identity: names sort in the order the hub shows them', () => {
  const shuffled = ['B', 'AA', 'A', 'Z', 'AB', 'C'];
  assert.deepStrictEqual(shuffled.sort(spaces.compareNames), ['A', 'B', 'C', 'Z', 'AA', 'AB']);
});

// ---------------------------------------------------------------------------------------------
// One VIP case per catalog entry: the flag, the tone and the saved file
// ---------------------------------------------------------------------------------------------
for (const app of APPS) {
  test(`vip/${app.id}: marking the space turns the badge red`, () => {
    let state = spaces.enableSlot(spaces.defaultState(), 'C');
    state = spaces.selectApp(state, 'C', app.id);
    state = spaces.setVip(state, 'C', true);
    assert.strictEqual(spaces.accountFor(state, 'C').vip, true);
    const waiting = [{ spaceId: 'C', acknowledged: false }, { spaceId: 'A', acknowledged: false }];
    const badge = vipBadge.badgeState(waiting, vipBadge.vipIdsFrom(spaces.enabledSpaces(state)));
    assert.strictEqual(badge.count, 2);
    assert.strictEqual(badge.vipCount, 1);
    assert.strictEqual(badge.tone, 'vip');
    assert.strictEqual(badge.label, '2');
  });

  test(`state/${app.id}: the choice survives a save and a restore`, () => {
    let state = spaces.enableSlot(spaces.defaultState(), 'C');
    state = spaces.selectApp(state, 'C', app.id);
    state = spaces.setVip(state, 'C', true);
    state = spaces.rename(state, 'C', `${app.label} inbox`);
    const restored = spaces.normalize(JSON.parse(JSON.stringify(state)));
    const space = spaces.accountFor(restored, 'C');
    assert.strictEqual(space.appId, app.id);
    assert.strictEqual(space.kind, app.kind);
    assert.strictEqual(space.vip, true);
    assert.strictEqual(space.label, `${app.label} inbox`);
    assert.deepStrictEqual(restored.slots, state.slots);
  });

  test(`state/${app.id}: hiding and showing it again keeps the flag`, () => {
    let state = spaces.enableSlot(spaces.defaultState(), 'C');
    state = spaces.selectApp(state, 'C', app.id);
    state = spaces.setVip(state, 'C', true);
    const hidden = spaces.disableSlot(state, 'C');
    assert.strictEqual(spaces.accountFor(hidden, 'C').vip, true);
    const shown = spaces.enableSlot(hidden, 'C');
    assert.strictEqual(spaces.accountFor(shown, 'C').vip, true);
    assert.strictEqual(spaces.accountFor(shown, 'C').appId, app.id);
  });

  test(`state/${app.id}: switching away and back does not resurrect the VIP by accident`, () => {
    let state = spaces.enableSlot(spaces.defaultState(), 'C');
    state = spaces.selectApp(state, 'C', app.id);
    state = spaces.setVip(state, 'C', true);
    const cleared = spaces.setVip(state, 'C', false);
    assert.strictEqual(spaces.accountFor(cleared, 'C').vip, false);
    // A different app on the same space still remembers only the flag the user last chose.
    const switched = spaces.selectApp(cleared, 'C', 'messenger');
    assert.strictEqual(spaces.accountFor(switched, 'C').vip, false);
    assert.strictEqual(spaces.accountFor(switched, 'C').appId, 'messenger');
  });
}

// ---------------------------------------------------------------------------------------------
// Boundaries that do not need the catalog
// ---------------------------------------------------------------------------------------------
test('state: A and B are permanent, and their flag is writable', () => {
  for (const id of ['A', 'B']) {
    const marked = spaces.setVip(spaces.defaultState(), id, true);
    assert.strictEqual(spaces.accountFor(marked, id).vip, true);
    assert.strictEqual(spaces.disableSlot(marked, id), marked, `${id} cannot be removed`);
  }
});

test('state: deleting a space takes its flag with it', () => {
  const marked = spaces.setVip(spaces.enableSlot(spaces.defaultState(), 'C'), 'C', true);
  const deleted = spaces.deleteSlot(marked, 'C');
  assert.strictEqual(spaces.accountFor(deleted, 'C'), null);
  assert.strictEqual(deleted.slots.includes('C'), false);
});

test('state: a slot name comes back to the pool before a new one is minted', () => {
  const state = spaces.enableSlot(spaces.enableSlot(spaces.defaultState(), 'C'), 'D');
  const removed = spaces.disableSlot(state, 'C');
  assert.strictEqual(spaces.nextFree(removed), 'C');
});

test('state: a hand-edited file cannot invent a space', () => {
  const restored = spaces.normalize({ slots: ['A', 'B', 'ZZZ'], spaces: [{ id: 'A' }, { id: 'B' }] });
  // A slot name with no space behind it is not a space: the hub renders spaces, not names.
  assert.deepStrictEqual(restored.spaces.map((space) => space.id), ['A', 'B']);
  assert.deepStrictEqual(spaces.enabledSpaces(restored).map((space) => space.id), ['A', 'B']);
  assert.strictEqual(spaces.accountFor(restored, 'ZZZ'), null);
});
