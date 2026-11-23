'use strict';

// A title is an aggregate unread SIGNAL, not a message id or a conversation history.
// No private APIs, network interception, DOM scans, threads or repeating timers.
const MAX_UNREAD = 99;
/**
 * How long a title rise and a website notification for the same account are still one message.
 *
 * The two sources are the same event seen twice: a chat app raises a Notification and updates its title,
 * and the two do not arrive together — measured against the acceptance fixture, the notification can land
 * a moment after the title. At a one-second window the second source became a second arrival, which is a
 * card for a message the user has already been told about.
 */
const PAIR_MS = 2500;
/**
 * How often one space may ring the desktop on a bare marker. A marker is a dot or a bullet where a number
 * would be, so it cannot say *how many* — and a site that redraws its badge hands the same marker back
 * over and over. Measured shape of that report: "notifications appear when nothing happened". A numbered
 * title is never rate-limited, because a number that grew is evidence of a new message.
 */
const MARKER_COOLDOWN_MS = 60_000;
const MAX_SEEN = 128;
const MAX_SIGNALS = 128;

function unreadCount(title) {
  const text = String(title || '').trim().slice(0, 300);
  const match = text.match(/\(([0-9]{1,3})\)/) || text.match(/^([0-9]{1,3})(?:\s|[·•|:-])/);
  if (match) {
    const value = Number(match[1]);
    return value >= 1 && value <= MAX_UNREAD ? value : 0;
  }
  return markerOnly(text) ? 1 : 0;
}

/** True when a title carries a marker where a count would be — a dot, a bullet or a star, and no number. */
function markerOnly(title) {
  const text = String(title || '').trim().slice(0, 300);
  if (!/^[•●*]/.test(text)) return false;
  return !/\(\s*[0-9]{1,3}\s*\)/.test(text) && !/^[0-9]{1,3}(?:\s|[·•|:-])/.test(text);
}

function retryDelay(failures) {
  return Math.min(30_000 * (2 ** Math.min(Math.max(failures - 1, 0), 5)), 900_000);
}

/**
 * Which kinds of space report their tab title as an unread signal.
 *
 * The title is the account's own unread count rendered by the site — "(3) Inbox" — and it is the one
 * signal every provider gives without interception, DOM scraping or a private API.
 *
 * `mail` is here for parity with Android: the phone build's `reportTitle` has no kind filter, so a Gmail
 * "(3) Inbox" raised a card there while desktop `readTitle` returned early for anything that was not
 * `social` and the mailbox showed nothing. A `tasks` space is a page to watch rather than an account to
 * announce, and an `ai` space is deliberately left out: its title is the conversation it is showing, not
 * a count of anything waiting.
 */
function titleMonitoredKind(kind) {
  return kind === 'social' || kind === 'mail';
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
    this.markerAt = 0; // when this space last rang on a marker, so a redrawn badge cannot ring again
    // Health, for the dashboard and for the card that says monitoring stopped. These are timestamps, not
    // content: nothing the page said is kept here. `healthStatus` is the last status the health rule saw,
    // which is what makes "entered this broken state" a transition rather than a repeat.
    this.healthStatus = null;
    this.lastReadyAt = 0; // last successful load of this account's page
    this.lastEventAt = 0; // last time a genuine arrival was accepted from either source
  }

  start(recovering = false) {
    if (!recovering) this.observed = false;
    this.status = 'loading';
    this.signals = [];
    this.generation += 1;
  }

  /**
   * The bounded retry gave up. Distinct from `temporarily-unavailable` on purpose: that state still has a
   * retry scheduled, this one has nothing left that will try again until the user opens the space.
   */
  suspend() {
    this.status = 'monitoring-stopped';
    this.signals = [];
  }

  /**
   * The page moved somewhere else inside itself. This is a re-read, not an arrival.
   *
   * A route change re-renders the app against the account's current state, so the title it produces
   * describes what is already there. Measured shape of the bug this closes: moving to another conversation
   * in a chat app made its badge render afresh, the count came back a little higher than the page's last
   * rendering, and Bop told the user about messages that had arrived while nobody was watching the tab —
   * the "it tells me about nothing" report. The next reading is therefore a baseline again, exactly as it
   * is after a load, and only a rise *without* a route change counts as an arrival.
   */
  navigate() {
    this.observed = false;
  }

  ready(url) {
    this.failures = 0;
    this.status = loginPage(url) ? 'reauthentication-required' : 'observing-auth-unknown';
    this.lastReadyAt = Date.now();
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
    if (remaining) this.lastEventAt = now;
    return remaining;
  }

  title(title, now = Date.now()) {
    if (this.status !== 'observing-auth-unknown') return { changed: false, incoming: 0 };
    const next = unreadCount(title);
    const previous = this.unread;
    const observed = this.observed;
    const changed = previous !== next || !observed;
    this.unread = next;
    this.observed = true;
    if (!changed) return { changed: false, incoming: 0, unread: next };
    let incoming = observed && previous !== null ? Math.max(next - previous, 0) : 0;
    if (incoming > 0 && markerOnly(title)) {
      // Zero means "never rang on a marker", which is not the same as "rang a long time ago": a fresh
      // monitor's very first marker has to ring, whatever clock the caller is reading.
      const since = this.markerAt ? now - this.markerAt : Infinity;
      this.markerAt = now;
      if (since < MARKER_COOLDOWN_MS) incoming = 0; // the same marker, redrawn: nothing was said
    }
    return { changed: true, incoming: incoming ? this.accept('title', incoming, now) : 0, unread: next };
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

module.exports = { AccountMonitor, unreadCount, markerOnly, retryDelay, loginPage, titleMonitoredKind, PAIR_MS, MARKER_COOLDOWN_MS, MAX_SEEN };
