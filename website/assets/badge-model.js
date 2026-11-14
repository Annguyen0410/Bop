/* The bubble's unread badge, as rules rather than pixels.
   This mirrors app/src/main/java/com/twoaccmess/VipBadge.kt: 0 draws nothing, 99 is the last
   number, 100+ reads "99+", and one waiting chat in a VIP space turns the whole badge red. */

export const CAP = 99;

/** The digits for a total, or null when no badge should be drawn at all. */
export function label(total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  return total > CAP ? `${CAP}+` : String(Math.trunc(total));
}

/** The tone for a VIP waiting count. An impossible count cannot turn the badge red. */
export function tone(total, vipWaiting) {
  const honest = Math.max(0, Math.min(Math.trunc(vipWaiting) || 0, Math.trunc(total) || 0));
  return honest > 0 ? 'vip' : 'normal';
}

/** One call for the overlay: digits plus tone. */
export function badge(total, vipWaiting) {
  return { text: label(total), tone: tone(total, vipWaiting) };
}
