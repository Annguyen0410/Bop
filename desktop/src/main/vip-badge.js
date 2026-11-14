'use strict';

/**
 * The bubble's badge, and the one rule the VIP highlight adds to it.
 *
 * The badge counts alerts that are still waiting to be read — a card the user acknowledged no longer
 * counts, exactly as before. What is new is the *tone*: a space the user marked VIP makes the whole
 * badge red with white digits the moment one of its alerts is waiting, so a mailbox that matters is
 * visible from across the room without reading a number first. Everything else keeps the ordinary blue
 * with black digits.
 *
 * Pure and framework-free on purpose: the main process computes the state, the renderer only paints it,
 * and `desktop/test/vip.test.js` can assert the whole truth table without Electron.
 */

/** Digits stop at two characters; past this the badge reads "99+". Same cap the Android build uses. */
const BADGE_CAP = 99;

const TONE_NORMAL = 'normal';
const TONE_VIP = 'vip';

/**
 * The two palettes. Black on #1976D2 measures 4.79:1 and white on #D32F2F 4.63:1, so both stay above
 * WCAG AA for the 11 px digits the bubble draws.
 */
const COLORS = {
  normal: { background: '#1976d2', foreground: '#000000' },
  vip: { background: '#d32f2f', foreground: '#ffffff' },
};

/** The ids of the spaces the user marked VIP, from the space list or from plain id strings. */
function vipIdsFrom(spaces) {
  const list = Array.isArray(spaces) ? spaces : [];
  const ids = [];
  for (const entry of list) {
    if (!entry) continue;
    if (typeof entry === 'string') { if (!ids.includes(entry)) ids.push(entry); continue; }
    if (entry.vip === true && typeof entry.id === 'string' && !ids.includes(entry.id)) ids.push(entry.id);
  }
  return ids;
}

/**
 * What the bubble should draw right now.
 *
 * `vipCount` is reported separately from `count` so a caller can say "3 waiting, 1 of them VIP" without
 * recounting, and so the tone is decided in exactly one place for both apps.
 */
function badgeState(alerts, vipIds) {
  const waiting = (Array.isArray(alerts) ? alerts : []).filter((alert) => alert && alert.acknowledged !== true);
    // Accepts both the plain ids and the space objects a caller already had at hand, so there is one
  // normalisation and no second way to pass "A" that silently means "nothing".
  const vip = new Set(vipIdsFrom(vipIds));
  const vipCount = waiting.filter((alert) => vip.has(alert.spaceId)).length;
  const count = waiting.length;
  return {
    count,
    vipCount,
    label: count > BADGE_CAP ? `${BADGE_CAP}+` : String(count),
    tone: vipCount > 0 ? TONE_VIP : TONE_NORMAL,
    visible: count > 0,
  };
}

/** The colours for a tone. An unknown tone is the ordinary badge, never an invisible one. */
function styleFor(tone) {
  return COLORS[tone] || COLORS.normal;
}

module.exports = {
  BADGE_CAP,
  TONE_NORMAL,
  TONE_VIP,
  COLORS,
  vipIdsFrom,
  badgeState,
  styleFor,
};
