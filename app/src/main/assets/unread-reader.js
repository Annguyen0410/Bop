/*
 * Bop's in-page unread reader: one dependency-free file, injected into a web session's own page, that
 * answers one question — "how much unread is there, and how much of it is in threads the user muted?"
 *
 * WHY A DESCRIPTOR PER SITE. Unread and mute live in each service's own markup, and no two services
 * agree on it. A descriptor says where to look; this file only decides how to count. Adding a site is a
 * data edit, not a new code path.
 *
 * THE REFUSAL RULE, WHICH IS THE IMPORTANT PART. A descriptor carries `evidence`. While evidence is
 * null the reader REFUSES and returns null rather than trying the selectors anyway, because a guessed
 * selector does not fail loudly — it silently matches nothing and reports "0 unread", and "0 unread" is
 * indistinguishable from "everything is fine" in a product whose entire job is not missing a message.
 * `null` means "cannot see right now"; the caller keeps its previous baseline and raises nothing.
 *
 * WHAT ONE READING MAY CLAIM. A count. Not a conversation, not a sender, not a message. It travels to
 * the hub as text in the same key=value shape the rest of this app already uses (see
 * WebSessionReport / SpaceScan.decode), never as page content.
 *
 * WHERE THIS RUNS. Injected with evaluateJavascript into the page that owns the session (Android), and
 * runnable in Node for tests (the module export below). The fixture pages under desktop/test/fixtures
 * implement exactly the markup the descriptors in `readDescriptor` assume, which is how the DOM path is
 * verified without a signed-in account.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BopUnread = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** Same ceiling as WebUnread.MAX: no service draws a badge above this, and a bigger number is noise. */
  const MAX = 99;

  /**
   * One entry per catalog app id in HubApps. `mode: 'title'` is the honest answer for a service whose
   * own tab title carries the count (already read natively by WebUnread) — the DOM reader returns null
   * for it and adds nothing. A `mode: 'dom'` entry needs verified selectors: `row` picks one
   * conversation, `unread` finds the badge inside it, `muted` finds the mute marker inside it, and
   * `count` says where the number lives ('text', or 'attr:<name>'). `empty` is optional and lets a
   * genuinely empty inbox be told apart from a page that has not rendered yet.
   */
  const SITES = {
    messenger: { mode: 'title', evidence: 'title shapes measured (WebUnreadTest: "(3) Messenger", "Messenger (12)")' },
    facebook: { mode: 'title', evidence: 'title shapes measured (WebUnreadTest)' },
    instagram: { mode: 'title', evidence: null },
    whatsapp: { mode: 'title', evidence: 'title shapes measured (WebUnreadTest: "(1) WhatsApp | WhatsApp")', note: 'mute state is not in the title' },
    tiktok: { mode: 'title', evidence: null, note: 'desktop layout only; /messages redirects to the feed on the phone agent' },
    telegram: { mode: 'title', evidence: 'title shapes measured (WebUnreadTest: "2 · Telegram")' },
    zalo: { mode: 'title', evidence: 'title shapes measured (WebUnreadTest: "● Zalo")' },
    x: { mode: 'title', evidence: null },
    threads: { mode: 'title', evidence: null },
    reddit: { mode: 'title', evidence: null },
    discord: { mode: 'title', evidence: 'title shapes measured (WebUnreadTest: "• Discord")' },
    snapchat: { mode: 'title', evidence: null },
    linkedin: { mode: 'title', evidence: null },
    viber: { mode: 'title', evidence: null },
    skype: { mode: 'title', evidence: null },
    googlechat: { mode: 'title', evidence: null },
    vk: { mode: 'title', evidence: null },
    bluesky: { mode: 'title', evidence: null },
    wechat: { mode: 'title', evidence: null },
  };

  /**
   * The unread one badge reports: a number, 0 when the row has no badge at all, or **null** when the
   * descriptor asked for a number and the markup no longer provides one.
   *
   * The null case is a real bug that this rule exists to stop. When a descriptor says "the count lives in
   * attribute data-count" and that attribute is gone, the honest reading is "this page is not the markup
   * I know" — not "1 unread", which is what a dot-shaped fallback would invent out of missing data.
   */
  function badgeCount(element, count) {
    if (!element) return 0;
    if (typeof count === 'string' && count.indexOf('attr:') === 0) {
      const attribute = element.getAttribute(count.slice(5));
      if (attribute === null || attribute === '') return null;
      const digits = String(attribute).replace(/[^0-9]/g, '');
      if (!digits) return null;
      return Math.min(parseInt(digits, 10) || 0, MAX);
    }
    const digits = String(element.textContent || '').replace(/[^0-9]/g, '');
    if (digits) return Math.min(parseInt(digits, 10) || 0, MAX);
    // A badge with no number at all is a dot: one unread state, exactly like the native title path.
    return 1;
  }

  /**
   * Reads one page with one descriptor. Returns {unread, muted} where `muted` is the part of `unread`
   * that sits in muted threads, or null when this page cannot be read (no evidence, page not rendered,
   * selectors not present). Never throws: a broken descriptor is a refusal, not a zero.
   */
  function readDescriptor(document, descriptor) {
    if (!document || !descriptor || descriptor.mode !== 'dom' || !descriptor.evidence) return null;
    if (!descriptor.row) return null;
    let rows;
    try {
      rows = document.querySelectorAll(descriptor.row);
    } catch (failure) {
      return null; // an unparseable selector is a refusal too
    }
    if (!rows || rows.length === 0) {
      if (descriptor.empty) {
        try {
          if (document.querySelector(descriptor.empty)) return { unread: 0, muted: 0 };
        } catch (failure) {
          return null;
        }
      }
      // No rows and no empty-state proof: the page may simply not have rendered yet. Refuse.
      return null;
    }
    let unread = 0;
    let muted = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const count = badgeCount(descriptor.unread ? row.querySelector(descriptor.unread) : null, descriptor.count);
      // One row whose markup no longer answers refuses the whole page: a partial sum would be reported as
      // a real, smaller unread number, which is worse than admitting the page cannot be read.
      if (count === null) return null;
      unread = Math.min(unread + count, MAX);
      if (count > 0 && descriptor.muted && row.querySelector(descriptor.muted)) muted = Math.min(muted + count, MAX);
    }
    return { unread: unread, muted: muted };
  }

  /** Reads one catalog app by id. A title-mode app is not a DOM reading, so it refuses here. */
  function read(document, appId) {
    return readDescriptor(document, SITES[appId]);
  }

  /**
   * The wire format, pinned to the same key=value shape the rest of the app uses. Kotlin's
   * SpaceScan.decode parses exactly this; both sides are tested against the same literal.
   */
  function encode(reading) {
    if (!reading) return '';
    // Both numbers or nothing. A reading that lost its muted count would decode in Kotlin as a refusal
    // anyway, and an 'unread=5\nmuted=undefined' line in a log is worse than no line at all.
    if (!Number.isFinite(reading.unread) || !Number.isFinite(reading.muted)) return '';
    return 'unread=' + reading.unread + '\nmuted=' + reading.muted;
  }

  return { MAX: MAX, SITES: SITES, read: read, readDescriptor: readDescriptor, encode: encode };
});
