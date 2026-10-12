'use strict';

/**
 * The rule set behind "tell me when this page changes", with no Electron and no Node dependency so
 * every decision is unit-tested.
 *
 * Why this exists at all: the phone build cannot watch a web page in the background — a closed WebView
 * gets no push. Desktop can, because the session is long-lived, and the task panels are exactly where
 * that matters: a study that opens while nobody is looking is gone in minutes.
 *
 * Two rules keep it from becoming noise:
 * - The first reading of a page never alerts. Watching a page you already have open must not fire a
 *   card just because Bop only now looked at it.
 * - A failed read never alerts, and it keeps the last known fingerprint rather than clearing it. An
 *   outage is therefore not reported as a change, but a page that changed *during* the outage still is
 *   once it loads again — swallowing that would defeat the point of watching a task panel.
 */

const MAX_TEXT = 20000;
const MAX_SUMMARY = 180;

/** Collapses whitespace so a re-render that only moves line breaks is not a change. */
function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/** FNV-1a, 32-bit, hex. Small, stable and dependency-free; a collision only costs one missed card. */
function hash(value) {
  let result = 0x811c9dc5;
  const text = String(value == null ? '' : value);
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, '0');
}

/**
 * Builds the comparable fingerprint for one reading of a page. Returns null when there is nothing
 * trustworthy to compare, which callers must treat as "no news", never as "changed".
 */
function fingerprint(reading) {
  if (!reading || typeof reading !== 'object') return null;
  const title = normalizeText(reading.title);
  const text = normalizeText(reading.text);
  const error = normalizeText(reading.error);
  if (error) return null;
  if (!title && !text) return null;
  return `${hash(title)}\u0000${hash(text)}`;
}

/**
 * True when this fingerprint is a *change* worth a card. The first ever reading returns false: there
 * is nothing to compare against, and guessing would alert on every newly watched page.
 */
function isChange(previous, next) {
  if (!next) return false;
  if (!previous) return false;
  return previous !== next;
}

/** True when the space is watched and its interval has elapsed. */
function isDue(watch, now) {
  if (!watch || watch.enabled !== true) return false;
  const minutes = intervalMinutes(watch);
  const last = Number(watch.lastCheckAt) || 0;
  return now - last >= minutes * 60000;
}

/** Consecutive failures stretch the interval, capped, so a broken page is retried but not hammered. */
function intervalMinutes(watch) {
  const requested = Number(watch && watch.minutes);
  const base = Number.isFinite(requested) && requested > 0 ? requested : 10;
  const failures = Math.max(0, Math.min(Number(watch && watch.failures) || 0, 4));
  const multiplier = [1, 1, 2, 3, 4][failures] || 1;
  return Math.min(Math.max(Math.round(base * multiplier), 1), 720);
}

/** Spaces due for a read right now, oldest first so a short timer never starves one of them. */
function dueSpaces(spaces, now) {
  return spaces
    .filter((space) => space && space.watch && space.watch.enabled === true)
    .filter((space) => isDue(space.watch, now))
    .sort((left, right) => (Number(left.watch.lastCheckAt) || 0) - (Number(right.watch.lastCheckAt) || 0));
}

/**
 * True when a changed page is worth a card. A watch may `require` a phrase (only card me when the page
 * actually says "available") and `ignore` one (drop the ticker that churns by itself). Comparison is a
 * plain case-insensitive substring over the page title and text, so it cannot misfire on markup.
 * With neither phrase set every change passes, which is the default.
 */
function passesFilter(watch, reading) {
  const require = normalizeText(watch && watch.require).toLowerCase();
  const ignore = normalizeText(watch && watch.ignore).toLowerCase();
  if (!require && !ignore) return true;
  const haystack = `${normalizeText(reading && reading.title)} ${normalizeText(reading && reading.text)}`.toLowerCase();
  if (require && !haystack.includes(require)) return false;
  if (ignore && haystack.includes(ignore)) return false;
  return true;
}

/** Short, quotable line for the card body, so the user knows what to expect before opening it. */
function summarize(reading) {
  const title = normalizeText(reading && reading.title);
  const text = normalizeText(reading && reading.text);
  const source = text || title;
  if (!source) return 'The page changed.';
  return source.length <= MAX_SUMMARY ? source : `${source.slice(0, MAX_SUMMARY - 1)}…`;
}

/** Applies one reading: never alerts on the first read, clears on failure, records the change time. */
function apply(watch, reading, now) {
  const next = fingerprint(reading);
  const previous = watch && typeof watch.fingerprint === 'string' ? watch.fingerprint : null;
  if (!next) {
    return { watch: { ...watch, lastCheckAt: now, failures: Math.min((Number(watch && watch.failures) || 0) + 1, 9) }, alert: false, summary: null };
  }
  const changed = isChange(previous, next);
  const worth = changed && passesFilter(watch, reading);
  return {
    watch: {
      ...watch,
      fingerprint: next,
      lastCheckAt: now,
      lastChangeAt: changed ? now : (Number(watch && watch.lastChangeAt) || 0),
      failures: 0,
    },
    alert: worth,
    // The fingerprint always moves forward, filtered-out change or not — otherwise the same suppressed
    // difference would be reconsidered on every following check.
    filtered: changed && !worth,
    summary: worth ? summarize(reading) : null,
  };
}

module.exports = {
  MAX_SUMMARY,
  normalizeText,
  hash,
  fingerprint,
  isChange,
  isDue,
  intervalMinutes,
  dueSpaces,
  passesFilter,
  summarize,
  apply,
};
