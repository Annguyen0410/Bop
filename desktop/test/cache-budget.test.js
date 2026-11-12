'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const budget = require('../src/main/cache-budget.js');

test('cache budget has a validated 512 MiB default and bounded choices', () => {
  assert.equal(budget.budgetBytes(undefined), 512 * budget.MB);
  assert.equal(budget.budgetBytes(1024), 1024 * budget.MB);
  assert.equal(budget.budgetBytes(999), 512 * budget.MB);
});

test('evicts least recently used disposable cache first and measures after each clear', async () => {
  const sizes = new Map([['old', 400], ['new', 400]]);
  const result = await budget.enforce([
    { id: 'new', size: 400, lastUsed: 20, clear: async () => sizes.set('new', 0), measure: async () => sizes.get('new') },
    { id: 'old', size: 400, lastUsed: 10, clear: async () => sizes.set('old', 0), measure: async () => sizes.get('old') },
  ], 500);
  assert.deepEqual(result.evicted, ['old']);
  assert.equal(result.usageBytes, 400);
  assert.equal(result.overBudget, false);
});

test('reports a cache that cannot be cleared instead of claiming the budget was met', async () => {
  const result = await budget.enforce([
    { id: 'locked', size: 600, lastUsed: 0, clear: async () => { throw new Error('busy'); }, measure: async () => 600 },
  ], 500);
  assert.equal(result.overBudget, true);
  assert.deepEqual(result.evicted, []);
  assert.equal(result.errors[0].message, 'busy');
});
