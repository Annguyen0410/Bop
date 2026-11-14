'use strict';

/**
 * The space menu that the bubble opens on a click. Same snapshot the dashboard uses, and centred on the
 * display instead of hanging off the bubble (see `openSpaceMenu` in main.js), so the layout is a card
 * that reads well on its own: a header with the count, a scrollable list, and a footer with the two
 * actions.
 *
 * Every row answers the two questions the bubble exists for — *which account moved*, and *is it really
 * it* — out of the main process's own view of that account rather than out of decoration:
 *
 * - the unread number is what the page's own title reported (`monitorState`), never a guess from Bop;
 * - the badge counts alerts that are still unacknowledged, which is a different thing and is labelled so;
 * - the state line names what the account is actually doing (sleeping, waiting for sign-in, unreachable,
 *   listening), because an account that is quiet and an account that is not running look identical
 *   otherwise — and "quiet" is the answer that makes a user distrust the app.
 *
 * The theme is taken from the window's start-up argument first, so the very first frame is already the
 * right colour — the snapshot arrives a moment later and would otherwise paint a light flash inside a
 * dark desktop.
 */

if (window.bop.initialTheme) document.documentElement.dataset.theme = window.bop.initialTheme;

const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * How often an open panel re-reads the snapshot.
 *
 * The main process pushes a change whenever one happens, so this is not how a new alert arrives — it is
 * what keeps the *numbers* honest. A page's unread count lives in that page's title and moves on the
 * page's own schedule, and the panel is the one surface where a stale number is indistinguishable from a
 * wrong one. Two seconds is shorter than the time it takes to read the card.
 */
const REFRESH_MS = 2000;

const list = document.getElementById('list');

/** What this account is doing, in the words the user would use. */
function stateOf(space) {
  if (space.openable === false) return 'needs an address';
  if (space.sleeping) return 'asleep · open to wake';
  if (space.monitoring === 'reauthentication-required') return 'needs sign-in';
  if (space.monitoring === 'temporarily-unavailable') return 'unreachable · retrying';
  if (space.browserNote) return 'this page refused Bop\'s browser';
  if (!space.loaded) return 'not open yet';
  return space.watch && space.watch.enabled ? 'reading this page' : 'listening';
}

/** The newest alert from one account, acknowledged or not: the last thing that actually happened. */
function lastAlertFor(alerts, id) {
  return (alerts || []).find((alert) => alert.spaceId === id && !alert.acknowledged)
    || (alerts || []).find((alert) => alert.spaceId === id)
    || null;
}

function render(state) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = state.theme === 'system' ? (prefersDark ? 'dark' : 'light') : state.theme;

  const spaces = state.enabled || [];
  const social = spaces.filter((space) => space.kind === 'social').length;
  const mail = spaces.filter((space) => space.kind === 'mail').length;
  // Everything that is neither social nor a mailbox is a task/AI space; the two counts above are the
  // ones the subtitle names separately, so a mailbox is never described as a task panel.
  const tasks = spaces.length - social - mail;
  const parts = [];
  if (social) parts.push(`${social} social`);
  if (mail) parts.push(`${mail} mail ${mail === 1 ? 'box' : 'boxes'}`);
  if (tasks) parts.push(`${tasks} task ${tasks === 1 ? 'panel' : 'panels'}`);
  // Two different quantities, never added together: what the pages themselves report as unread, and how
  // many cards are still waiting to be read here.
  const unread = spaces.reduce((total, space) => total + (space.unread || 0), 0);
  const waiting = spaces.reduce((total, space) => total + (space.pending || 0), 0);
  const asleep = spaces.filter((space) => space.sleeping).length;

  document.getElementById('count').textContent = String(spaces.length);
  document.getElementById('subtitle').textContent = spaces.length
    ? `${parts.join(' · ')}${unread ? ` · ${unread} unread on the pages` : ' · nothing new'}`
      + `${waiting ? ` · ${waiting} card${waiting === 1 ? '' : 's'} waiting` : ''}`
      + `${asleep ? ` · ${asleep} asleep` : ''}`
    : 'Nothing here yet';

  list.innerHTML = spaces.length
    ? spaces.map((space) => {
      const alert = lastAlertFor(state.alerts, space.id);
      const appLabel = (state.apps || []).find((app) => app.id === space.appId);
      const meta = [
        appLabel ? appLabel.label : space.kind,
        stateOf(space),
        space.unread ? `${space.unread} unread` : null,
        space.watch && space.watch.enabled ? 'watching' : null,
      ].filter(Boolean).join(' · ');
      return `
        <button class="space-row" data-open="${esc(space.id)}" title="Open ${esc(space.label)}">
          <span class="space-dot" style="background:${esc(space.accent)}"></span>
          <span class="space-meta">
            <span class="space-label">${esc(space.label)}</span>
            <span class="space-app">${esc(meta)}</span>
            ${alert ? `<span class="space-note">${esc(alert.title)}</span>` : ''}
          </span>
          ${space.pending ? `<span class="badge">${space.pending}</span>` : ''}
          <span class="chevron">›</span>
        </button>`;
    }).join('')
    : '<div class="panel-empty">No spaces yet. Add one from the dashboard.</div>';
}

window.bop.onChanged(render);

list.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open]');
  if (button) window.bop.menu.openSpace(button.dataset.open);
});

document.getElementById('check').addEventListener('click', async () => {
  await window.bop.checkNow();
  window.bop.menu.close();
});

document.getElementById('stop').addEventListener('click', () => window.bop.bubble.stop());

document.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.bop.menu.close(); });

// A window that is already open keeps up with the operating system's light/dark switch.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => window.bop.snapshot().then(render));

// The panel lives exactly as long as it is open (it closes on blur), so its own timer needs no teardown.
setInterval(() => { window.bop.snapshot().then(render).catch(() => {}); }, REFRESH_MS);

window.bop.snapshot().then(render);
