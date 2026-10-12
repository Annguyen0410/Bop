'use strict';

/**
 * The bubble's whole job: a press that travels moves it, a press that stays opens the space menu, a
 * double-click runs whichever action the user chose, a right-click opens a native quick menu, and the
 * badge shows how many alerts are waiting.
 *
 * Moving the window is Bop's own gesture, not Chromium's `-webkit-app-region: drag`, and that is what the
 * machine measured rather than a preference: on 0.1.7 a fast real drag asked for 260×150 points and the
 * bubble arrived 33 points short of the hand dragging it, and the only draggable part of a 64px bubble
 * was the ~13px ring around the round button — a press that looks like a grab landed on the button and
 * opened the menu instead. So the whole disc reports the pointer, the press point is the grab point (the
 * bubble cannot jump under the cursor), and a press that never travels stays a click, which keeps the
 * menu exactly as easy to open as it was.
 */

const orb = document.getElementById('bubble');
const core = document.getElementById('core');
const picture = document.getElementById('picture');
const mark = document.getElementById('mark');
const badge = document.getElementById('badge');

/** Screen points the pointer must travel before a press becomes a drag. Mirrors `bubble-drag.js`. */
const MOVE_THRESHOLD = 4;
/** A click is held this long so a double-click does not also flash the menu. */
const CLICK_DELAY_MS = 220;

let press = null;
let dragging = false;
let pendingClick = null;

function pointOf(event) {
  return { x: Math.round(event.screenX), y: Math.round(event.screenY) };
}

orb.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  press = pointOf(event);
  dragging = false;
  // Capture keeps the pointer's own moves coming even when it leaves this 64px window, which is what a
  // drag across the screen does almost immediately. A pointer that is already gone throws, and a
  // gesture without capture is still a gesture.
  try { orb.setPointerCapture(event.pointerId); } catch (_) { /* no capture available */ }
  // The press must not also become the button's click: the tap below is the one that decides.
  event.preventDefault();
});

orb.addEventListener('pointermove', (event) => {
  if (!press) return;
  if (!dragging) {
    const travelled = Math.abs(event.screenX - press.x) + Math.abs(event.screenY - press.y);
    if (travelled < MOVE_THRESHOLD) return;
    dragging = true;
    orb.classList.add('dragging');
    // The *press* point, not this one: the window keeps the offset it was grabbed with.
    window.bop.bubble.dragStart(press);
  }
  window.bop.bubble.dragMove(pointOf(event));
});

function endPress(event) {
  const wasDragging = dragging;
  press = null;
  dragging = false;
  orb.classList.remove('dragging');
  try {
    if (event && event.pointerId != null && orb.hasPointerCapture(event.pointerId)) orb.releasePointerCapture(event.pointerId);
  } catch (_) { /* the pointer was already released */ }
  if (wasDragging) window.bop.bubble.dragEnd(event ? pointOf(event) : null);
  else tap();
}

orb.addEventListener('pointerup', endPress);
orb.addEventListener('pointercancel', endPress);
orb.addEventListener('lostpointercapture', () => { if (press) endPress(null); });

/** A tap: the menu on the first one, whatever a double-click is set to on the second. */
function tap() {
  if (pendingClick) {
    clearTimeout(pendingClick);
    pendingClick = null;
    window.bop.bubble.double();
    return;
  }
  pendingClick = setTimeout(() => {
    pendingClick = null;
    window.bop.bubble.click();
  }, CLICK_DELAY_MS);
}

// The button keeps its keyboard path (Enter/Space) for anyone who never touches the pointer.
core.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  window.bop.bubble.click();
});

core.addEventListener('mouseenter', () => window.bop.bubble.hover(true));
core.addEventListener('mouseleave', () => window.bop.bubble.hover(false));

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.bop.bubble.menu();
});

function render(state) {
  const unread = state.alerts.filter((alert) => !alert.acknowledged).length;
  badge.hidden = unread === 0;
  badge.textContent = unread > 99 ? '99+' : String(unread);

  // The face: the picture the user picked, or the drawn smile. `bubbleAvatar` is already a data URL, so
  // it survives the file it came from being moved — and the page's own policy allows exactly that.
  const face = String(state.bubbleAvatar || '');
  picture.hidden = !face;
  mark.hidden = !!face;
  if (face && picture.getAttribute('src') !== face) picture.src = face;
  core.title = unread
    ? `Your spaces · ${unread} new`
    : `Your spaces · ${state.enabled.length}`;
}

window.bop.onChanged(render);
window.bop.snapshot().then(render);
