'use strict';

/**
 * Desktop plan — the badge matrix.
 *
 * Every waiting count from 0 to 99, each in three shapes: no VIP at all, exactly one VIP, and every
 * waiting card VIP. That is the whole decision surface of the feature (count -> digits, count -> visible,
 * any VIP -> red), asserted per combination instead of at one convenient point. Impossible inputs (more
 * VIP cards than cards, a negative VIP count) are part of the same table because the clamp is a rule too.
 */

const test = require('node:test');
const assert = require('node:assert');

const vipBadge = require('../src/main/vip-badge.js');

/** `total` waiting alerts, the first `vip` of which belong to space V. */
function alerts(total, vip) {
  return Array.from({ length: total }, (_, index) => ({
    spaceId: index < vip ? 'V' : 'A',
    acknowledged: false,
  }));
}

function expectedLabel(total) {
  if (total <= 0) return '0';
  return total > vipBadge.BADGE_CAP ? `${vipBadge.BADGE_CAP}+` : String(total);
}

const SHAPES = [
  ['no VIP', (total) => 0],
  ['one VIP', (total) => Math.min(1, total)],
  ['every card VIP', (total) => total],
];

for (let total = 0; total <= vipBadge.BADGE_CAP; total += 1) {
  for (const [name, vipFor] of SHAPES) {
    const vip = vipFor(total);
    test(`badge/${total} waiting, ${name}`, () => {
      const state = vipBadge.badgeState(alerts(total, vip), ['V']);
      assert.strictEqual(state.count, total);
      assert.strictEqual(state.vipCount, vip);
      assert.strictEqual(state.visible, total > 0);
      assert.strictEqual(state.label, expectedLabel(total));
      assert.strictEqual(state.tone, vip > 0 ? vipBadge.TONE_VIP : vipBadge.TONE_NORMAL);
      assert.deepStrictEqual(vipBadge.styleFor(state.tone), vip > 0 ? vipBadge.COLORS.vip : vipBadge.COLORS.normal);
    });
  }
}

// Above the cap the digits stop growing; the tone must keep working from the same data.
for (const total of [100, 101, 150, 500, 1000, 9999, 100000]) {
  for (const vip of [0, 1, total]) {
    test(`badge/${total} waiting, ${vip} VIP (capped)`, () => {
      const state = vipBadge.badgeState(alerts(total, vip), ['V']);
      assert.strictEqual(state.count, total);
      assert.strictEqual(state.label, '99+');
      assert.strictEqual(state.visible, true);
      assert.strictEqual(state.tone, vip > 0 ? 'vip' : 'normal');
    });
  }
}

// Impossible counts: the tone must not be invented out of nothing.
for (const vip of [-100, -1, 0]) {
  for (const total of [0, 1, 5]) {
    test(`badge/${total} waiting, impossible VIP ${vip}`, () => {
      const state = vipBadge.badgeState(alerts(total, 0), ['V']);
      assert.strictEqual(state.vipCount, 0);
      assert.strictEqual(state.tone, 'normal');
      assert.strictEqual(vipBadge.badgeState(alerts(total, vip), ['V']).vipCount, 0);
    });
  }
}

// The two ways a caller can name VIP spaces must mean the same thing.
for (let total = 0; total <= 20; total += 1) {
  test(`badge/${total}: id form and object form agree`, () => {
    const waiting = alerts(total, Math.min(1, total));
    const byId = vipBadge.badgeState(waiting, ['V']);
    const bySpace = vipBadge.badgeState(waiting, [{ id: 'V', vip: true }]);
    const mixed = vipBadge.badgeState(waiting, ['V', { id: 'A', vip: false }]);
    assert.deepStrictEqual(byId, bySpace);
    assert.deepStrictEqual(byId, mixed);
  });
}

// Acknowledgement is the one input that removes a card, so each count gets its own case.
for (let total = 1; total <= 20; total += 1) {
  test(`badge/${total}: acknowledging the VIP card removes the red`, () => {
    const waiting = alerts(total, 1).map((alert, index) => (index === 0 ? { ...alert, acknowledged: true } : alert));
    const state = vipBadge.badgeState(waiting, ['V']);
    assert.strictEqual(state.count, total - 1);
    assert.strictEqual(state.vipCount, 0);
    assert.strictEqual(state.tone, 'normal');
    assert.strictEqual(state.visible, total - 1 > 0);
  });
}
