'use strict';

// A title is an aggregate unread SIGNAL, not a message id or a conversation history.
// No private APIs, network interception, DOM scans, threads or repeating timers.
const MAX_UNREAD = 99;
const PAIR_MS = 1000;
const MAX_SEEN = 128;
const MAX_SIGNALS = 128;

function unreadCount(title) {
  const text = String(title || '').trim().slice(0, 300);
  const match = text.match(/\(([0-9]{1,3})\)/) || text.match(/^([0-9]{1,3})(?:\s|[·•|:-])/);
  if (match) {
    const value = Number(match[1]);
    return value >= 1 && value <= MAX_UNREAD ? value : 0;
  }
  return /^[•●*]/.test(text) ? 1 : 0;
}

function retryDelay(failures) {
  return Math.min(30_000 * (2 ** Math.min(Math.max(failures - 1, 0), 5)), 900_000);
}

// URL paths only, never query strings or tokens. These are hints, not authentication validation.
function loginPage(url) {
  try {
    return /(^|\/)(login|log-in|signin|sign-in|qr)(\/|$)/i.test(new URL(url).pathname);
  } catch (_) { return false; }
}

class AccountMonitor {
  constructor(saved = {}) {
    this.unread = Number.isInteger(saved.unread) && saved.unread >= 0 && saved.unread <= MAX_UNREAD ? saved.unread : null;
    this.observed = false; // Rebaseline on a normal restart: stored unread is NOT a sync cursor.
    this.status = 'not-loaded';
    this.failures = 0;
    this.seen = new Set();
    this.signals = [];
    this.generation = 0;
  }

  start(recovering = false) {
    if (!recovering) this.observed = false;
    this.status = 'loading';
    this.signals = [];
    this.generation += 1;
  }

  ready(url) {
    this.failures = 0;
    this.status = loginPage(url) ? 'reauthentication-required' : 'observing-auth-unknown';
    if (this.status === 'reauthentication-required') { this.observed = false; this.signals = []; }
  }

  unavailable() {
    this.status = 'temporarily-unavailable';
    this.failures += 1;
    this.signals = [];
    return retryDelay(this.failures);
  }

  // Short-window correlation only: without an original message id the two sources cannot be matched
  // perfectly. Consume one credit per site event, not an entire burst, so distinct events survive.
  accept(source, count, now) {
    this.signals = this.signals.filter(signal => now - signal.at <= PAIR_MS);
    const opposite = source === 'title' ? 'website' : 'title';
    let remaining = count;
    for (const signal of this.signals) {
      if (signal.source !== opposite || signal.count === 0) continue;
      const paired = Math.min(remaining, signal.count);
      remaining -= paired;
      signal.count -= paired;
      if (!remaining) break;
    }
    if (remaining) this.signals.push({ source, count: remaining, at: now });
    this.signals = this.signals.filter(signal => signal.count > 0).slice(-MAX_SIGNALS);
    return remaining;
  }

  title(title, now = Date.now()) {
    if (this.status !== 'observing-auth-unknown') return { changed: false, incoming: 0 };
    const next = unreadCount(title);
    const previous = this.unread;
    const incoming = this.observed && previous !== null ? Math.max(next - previous, 0) : 0;
    const changed = previous !== next || !this.observed;
    this.unread = next;
    this.observed = true;
    return { changed, incoming: incoming ? this.accept('title', incoming, now) : 0, unread: next };
  }

  website(payload, now = Date.now()) {
    if (!payload || typeof payload.eventId !== 'string' || !payload.eventId || payload.eventId.length > 180) return false;
    if (this.status === 'reauthentication-required' || this.status === 'temporarily-unavailable') return false;
    if (this.seen.has(payload.eventId)) return false;
    this.seen.add(payload.eventId);
    if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value);
    return this.accept('website', 1, now) > 0;
  }

  saved() { return { unread: this.unread }; }
}

module.exports = { AccountMonitor, unreadCount, retryDelay, loginPage, PAIR_MS, MAX_SEEN };
