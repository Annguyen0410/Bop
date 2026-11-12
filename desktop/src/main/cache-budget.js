'use strict';

/** Bop's Chromium HTTP-cache budget. Cookies, local storage and IndexedDB are never candidates. */
const DEFAULT_BUDGET_MB = 512;
const BUDGETS_MB = [256, 512, 1024];
const MB = 1024 * 1024;

function budgetBytes(megabytes) {
  return (BUDGETS_MB.includes(Number(megabytes)) ? Number(megabytes) : DEFAULT_BUDGET_MB) * MB;
}

/** Evict least-recently-used HTTP caches until the measured aggregate is under budget. */
async function enforce(entries, limitBytes) {
  const rows = entries.map((entry) => ({ ...entry, size: Math.max(0, Number(entry.size) || 0) }));
  let total = rows.reduce((sum, entry) => sum + entry.size, 0);
  const beforeBytes = total;
  const evicted = [];
  const errors = [];
  for (const entry of rows.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0))) {
    if (total <= limitBytes) break;
    try {
      await entry.clear();
      const after = Math.max(0, Number(await entry.measure()) || 0);
      total += after - entry.size;
      if (after < entry.size) evicted.push(entry.id);
      entry.size = after;
    } catch (error) {
      errors.push({ id: entry.id, message: String(error?.message || error).slice(0, 160) });
    }
  }
  return { beforeBytes, usageBytes: Math.max(0, total), budgetBytes: limitBytes,
    overBudget: total > limitBytes, evicted, errors };
}

module.exports = { DEFAULT_BUDGET_MB, BUDGETS_MB, MB, budgetBytes, enforce };
