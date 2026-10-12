'use strict';

/**
 * The reminder card. It shows the newest alert, the account it belongs to, and how many more arrived
 * while the card was up. Clicking it (or Open) opens that space and counts the alert as seen; × hides
 * it and leaves the alert unread in the Alerts list.
 */

// The first frame is already the right colour; the payload below keeps it in step afterwards.
if (window.bop.initialTheme) document.documentElement.dataset.theme = window.bop.initialTheme;

const dot = document.getElementById('dot');
const kind = document.getElementById('kind');
const title = document.getElementById('title');
const text = document.getElementById('text');
const more = document.getElementById('more');
const card = document.getElementById('card');
const open = document.getElementById('open');
const close = document.getElementById('close');

let current = null;

const WORD = { web: 'new message alert', watch: 'watched page changed' };

function render(payload) {
  if (!payload) return;
  current = payload;
  document.documentElement.dataset.theme = payload.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : payload.theme;
  dot.style.background = payload.accent || 'var(--brand)';
  kind.textContent = WORD[payload.kind] || 'new alert';
  title.textContent = payload.title;
  text.textContent = payload.body;
  more.textContent = payload.also ? `+${payload.also} more` : '';
  open.textContent = `Open ${payload.spaceLabel || ''}`.trim();
  document.title = `Bop · ${payload.title}`;
}

function openSpace() {
  if (!current) return;
  window.bop.reminder.open(current.spaceId, current.key);
}

card.addEventListener('click', (event) => {
  if (event.target.closest('#close')) return;
  openSpace();
});

close.addEventListener('click', (event) => { event.stopPropagation(); window.bop.reminder.hide(); });

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.bop.reminder.hide();
  if (event.key === 'Enter') openSpace();
});

window.bop.onReminder(render);
