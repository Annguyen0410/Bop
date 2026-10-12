'use strict';

/**
 * The space menu that the bubble opens. Same snapshot the dashboard uses, and now centred on the
 * display instead of hanging off the bubble (see `openSpaceMenu` in main.js), so the layout is a card
 * that reads well on its own: a header with the count, a scrollable list, and a footer with the two
 * actions.
 *
 * The theme is taken from the window's start-up argument first, so the very first frame is already the
 * right colour — the snapshot arrives a moment later and would otherwise paint a light flash inside a
 * dark desktop.
 */

if (window.bop.initialTheme) document.documentElement.dataset.theme = window.bop.initialTheme;

const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const list = document.getElementById('list');

function render(state) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = state.theme === 'system' ? (prefersDark ? 'dark' : 'light') : state.theme;

  const social = state.enabled.filter((space) => space.kind === 'social').length;
  const tasks = state.enabled.length - social;
  const parts = [];
  if (social) parts.push(`${social} social`);
  if (tasks) parts.push(`${tasks} task ${tasks === 1 ? 'panel' : 'panels'}`);
  const unread = state.enabled.reduce((total, space) => total + (space.pending || 0), 0);

  document.getElementById('count').textContent = String(state.enabled.length);
  document.getElementById('subtitle').textContent = state.enabled.length
    ? `${parts.join(' · ')}${unread ? ` · ${unread} waiting` : ''}`
    : 'Nothing here yet';

  list.innerHTML = state.enabled.length
    ? state.enabled.map((space) => `
        <button class="space-row" data-open="${esc(space.id)}" title="Open ${esc(space.label)}">
          <span class="space-dot" style="background:${esc(space.accent)}"></span>
          <span class="space-meta">
            <span class="space-label">${esc(space.label)}</span>
            <span class="space-app">${esc(space.kind)}${space.watch && space.watch.enabled ? ' · watching' : ''}${space.openable === false ? ' · needs an address' : ''}</span>
          </span>
          ${space.pending ? `<span class="badge">${space.pending}</span>` : ''}
          <span class="chevron">›</span>
        </button>`).join('')
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

window.bop.snapshot().then(render);
