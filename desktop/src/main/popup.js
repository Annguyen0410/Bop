'use strict';

/**
 * The reminder card: what Bop shows on screen when something actually arrives.
 *
 * Why Bop draws its own window instead of a Windows toast: Bop ships as a portable executable and as a
 * per-user installer, and Windows only displays a toast for an application that has a Start Menu
 * shortcut carrying its AppUserModelID. A portable run has no shortcut, so `new Notification(...)` is
 * dropped by the OS — from Bop *and* from the space's own page. The alert still reached the Alerts
 * list, but nothing was seen, which is exactly "messages arrive and nothing reminds me". A small
 * always-on-top window drawn by Bop is the one surface that works on every build, and the same card
 * serves a watched page and a web notification.
 *
 * The queue is plain data, so the rules — what pops, what replaces what, when it goes away and where it
 * sits — are unit-tested instead of described.
 */

/** How long a card stays on screen when nothing newer arrives. */
const POPUP_MS = 9000;
/** Gap to the work-area edge. The taskbar is already excluded by the work area itself. */
const MARGIN = 18;
/** Message alerts and watched-page changes are reminders; blocked links and load errors are not. */
const KINDS = ['web', 'watch'];

function popsUp(alert) {
  return !!alert && KINDS.includes(alert.kind);
}

function empty() {
  return { current: null, at: 0, count: 0 };
}

/**
 * A newer alert takes the card over and counts as one more: the window never stacks, so a burst of
 * messages cannot bury the desktop in cards. [at] is restarted so the newest alert is readable in full.
 */
function arrive(queue, alert, now) {
  if (!popsUp(alert)) return queue && queue.current ? queue : empty();
  const base = queue && queue.current ? queue : empty();
  return { current: alert, at: now, count: base.count + 1 };
}

function dismiss() {
  return empty();
}

function expired(queue, now, lifetime = POPUP_MS) {
  return !!(queue && queue.current) && now - queue.at >= lifetime;
}

function alertKey(alert) {
  return `${alert.spaceId}:${alert.tag}`;
}

/**
 * The card's content: the newest alert plus how many arrived while it was up, so the earlier ones are
 * counted rather than silently swallowed.
 */
function card(queue) {
  if (!queue || !queue.current) return null;
  const alert = queue.current;
  return {
    spaceId: alert.spaceId,
    key: alertKey(alert),
    kind: alert.kind,
    title: alert.title,
    body: alert.body,
    also: Math.max(queue.count - 1, 0),
  };
}

function intersects(rect, other, gap = 0) {
  if (!other) return false;
  return rect.x < other.x + other.width + gap && other.x < rect.x + rect.width + gap
    && rect.y < other.y + other.height + gap && other.y < rect.y + rect.height + gap;
}

/**
 * Bottom-right of the work area, lifted above the bubble when the bubble is docked there so the card
 * and the bubble never cover each other. Always fully inside the work area.
 */
function spot(workArea, size, bubble = null, margin = MARGIN) {
  const maxX = workArea.x + Math.max(workArea.width - size.width, 0);
  const maxY = workArea.y + Math.max(workArea.height - size.height, 0);
  const x = Math.min(Math.max(workArea.x + workArea.width - size.width - margin, workArea.x), maxX);
  let y = Math.min(Math.max(workArea.y + workArea.height - size.height - margin, workArea.y), maxY);
  if (intersects({ x, y, width: size.width, height: size.height }, bubble, 6)) {
    const lifted = bubble.y - size.height - margin;
    if (lifted >= workArea.y) y = lifted;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

module.exports = { POPUP_MS, MARGIN, KINDS, popsUp, empty, arrive, dismiss, expired, alertKey, card, spot };
