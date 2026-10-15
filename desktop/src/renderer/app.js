'use strict';

/**
 * The dashboard. Deliberately a small hand-written renderer: no framework, no build step, instant
 * start. Everything it draws comes from the main process, and it never guesses at state — it redraws
 * from the snapshot the main process sends after every change.
 */

const el = (id) => document.getElementById(id);
let state = null;
let page = 'spaces';
let modal = null;
// The reason the last picture pick was refused, shown in the bubble card until the next attempt: a
// dialog that silently does nothing is the one outcome a picker must never have.
let avatarError = '';

const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ago = (at) => {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
};

async function refresh() {
  state = await window.bop.snapshot();
  render();
}

function applyTheme() {
  if (!state) return;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = state.theme === 'system' ? (prefersDark ? 'dark' : 'light') : state.theme;
  document.documentElement.dataset.theme = resolved;
}

function render() {
  if (!state) return;
  applyTheme();
  document.body.classList.toggle('space-open', state.enabled.some((space) => space.open));
  el('close-space').hidden = !state.enabled.some((space) => space.open);
  const unread = state.alerts.filter((alert) => !alert.acknowledged).length;
  el('brand-sub').textContent = unread ? `${unread} new` : `${state.enabled.length} spaces`;
  el('new-space').disabled = false;
  renderNav();
  renderSpaceList();
  renderPage();
}

function renderNav() {
  const unread = state.alerts.filter((alert) => !alert.acknowledged).length;
  for (const button of el('nav').querySelectorAll('button')) {
    button.setAttribute('aria-current', String(button.dataset.page === page));
    button.textContent = button.dataset.page === 'alerts' && unread
      ? `Alerts · ${unread}`
      : button.dataset.page[0].toUpperCase() + button.dataset.page.slice(1);
  }
}

function renderSpaceList() {
  const target = el('space-list');
  const groups = [
    ['social', 'Social accounts'],
    ['tasks', 'Work & task panels'],
  ];
  let html = '';
  for (const [kind, title] of groups) {
    const list = state.enabled.filter((space) => space.kind === kind);
    if (!list.length) continue;
    html += `<div class="group-title">${title} · ${list.length}</div>`;
    for (const space of list) {
      const needsAddress = space.openable === false;
    html += `
        <button class="space-row" data-open="${esc(space.id)}" aria-current="${space.open}">
          <span class="space-dot" style="background:${esc(space.accent)}"></span>
          <span class="space-meta">
            <span class="space-label">${esc(space.label)}</span>
            <span class="space-app">${esc(space.appId)} · ${esc(space.id)}${needsAddress ? ' · needs an address' : ''}${space.browserNote ? ' · refused by the page' : ''}${space.watch && space.watch.enabled ? ' · watching' : ''}</span>
          </span>
          ${needsAddress ? '<span class="badge" title="Open asks for the address first">!</span>' : ''}
          ${space.watch && space.watch.enabled ? '<span class="watch-dot" title="Watched">◉</span>' : ''}
          ${space.pending ? `<span class="badge">${space.pending}</span>` : ''}
        </button>`;
    }
  }
  target.innerHTML = html || '<div class="group-title">No spaces yet</div>';
}

function card(space) {
  const pending = space.pending ? `<span class="badge">${space.pending}</span>` : '';
  const broken = space.openable === false
    ? `<span class="row-status bad" title="${esc(space.openError || '')}">needs an address</span>`
    : '';
  const layout = space.phoneLayout === false
    ? '<span class="row-status" title="This space loads the desktop website">▭ desktop site</span>'
    : '<span class="row-status" title="This space loads the mobile website, which fits this window">▯ mobile site</span>';
  const filter = space.watch && space.watch.require ? ` · needs “${esc(space.watch.require)}”` : '';
  const watching = space.watch && space.watch.enabled
    ? `<span class="row-status ok" title="Watched every ${space.watch.minutes} min${space.watch.require ? `; only alerts when the page says “${esc(space.watch.require)}”` : ''}">◉ watching${filter}</span>` : '';
  const checked = space.watch && space.watch.lastCheckAt ? `checked ${ago(space.watch.lastCheckAt)}` : 'never checked';
  return `
    <div class="card" data-card="${esc(space.id)}">
      <div class="card-head">
        <span class="space-dot" style="background:${esc(space.accent)};margin-top:5px"></span>
        <div style="flex:1;min-width:0">
          <h3>${esc(space.label)} ${pending} ${broken}</h3>
          <p>${esc(space.hosts[0] || 'no address set')} · slot ${esc(space.id)}</p>
        </div>
      </div>
      <p class="space-app">${esc(space.monitoring)}${space.unread == null ? '' : ` · ${space.unread} title unread`}</p>
      <p class="space-app">${space.loaded ? 'Tab-title events + website alerts; authentication and live delivery are not validated.' : 'Open once to resume monitoring with saved session cookies.'}</p>
      ${space.browserNote ? `<p class="space-app warn">${esc(space.browserNote)}</p>` : ''}
      ${space.notificationStatus ? `<p class="space-app">${esc(space.notificationStatus)}</p>` : ''}
      <p style="margin-top:8px">${layout} ${watching} ${space.watch && space.watch.enabled ? `<span class="space-app">· ${esc(checked)}</span>` : ''}</p>
      <div class="card-actions">
        <button class="primary" data-open="${esc(space.id)}">Open</button>
        <button class="ghost" data-watch="${esc(space.id)}">Watch</button>
        <button class="ghost" data-edit="${esc(space.id)}">Edit</button>
        ${space.loaded ? `<button class="ghost" data-stop="${esc(space.id)}">Stop monitoring</button>` : ''}
      </div>
    </div>`;
}

function renderPage() {
  if (page === 'spaces') return renderSpaces();
  if (page === 'alerts') return renderAlerts();
  if (page === 'notes') return renderNotes();
  if (page === 'settings') return renderSettings();
  return renderGuide();
}

function renderSpaces() {
  const social = state.enabled.filter((space) => space.kind === 'social');
  const tasks = state.enabled.filter((space) => space.kind === 'tasks');
  const watched = state.enabled.filter((space) => space.watch && space.watch.enabled).length;
  el('main').innerHTML = `
    <section class="hero">
      <div class="eyebrow">YOUR LITTLE INTERNET</div>
      <h1>All your people.<br />One happy place.</h1>
      <div class="hero-row">
        <span class="count">${state.enabled.length} spaces · ${social.length} social · ${tasks.length} task · ${watched} watched</span>
        <button class="pill" id="hero-add">＋ Add</button>
      </div>
    </section>
    ${social.length ? `<div class="section-title"><h2>Social</h2><span>${social.length}</span></div><div class="grid">${social.map(card).join('')}</div>` : ''}
    ${tasks.length ? `<div class="section-title"><h2>Tasks &amp; earnings</h2><span>${tasks.length}</span></div><div class="grid">${tasks.map(card).join('')}</div>` : ''}
    ${state.enabled.length ? '' : '<div class="empty" style="margin-top:22px">No spaces yet. Add one — a message account or a task panel.</div>'}
    <div class="note">
      <b>Desktop-only:</b> a watched space is re-read every ${state.enabled.find((s) => s.watch && s.watch.enabled)?.watch?.minutes || 10} minutes
      (its own interval when set) and cards you when the page changes. This is the part the Android build cannot do,
      because a closed WebView gets no push. Watching compares the page title and body text (or your selector);
      readings and notification previews are not written to disk. Settings and opened-space ids are saved.
    </div>`;
  el('hero-add').addEventListener('click', () => openPicker());
}

function renderNotes() {
  const sync = state.notesSync;
  el('main').innerHTML = `
    <div class="section-title"><h2>Quick notes</h2><span>Text and images · shared over your private Wi‑Fi</span></div>
    <div class="card"><p>Open a small chat-like notepad and write a note or attach an image. Android and desktop merge notes while both are online on the same private network.</p>
      <div class="card-actions"><button class="primary" id="open-notes">Open quick notes</button><button class="${sync.enabled ? 'primary' : 'ghost'}" id="toggle-notes-sync">${sync.enabled ? 'Stop LAN sync' : 'Start LAN sync'}</button></div>
      ${sync.enabled ? `<div class="note">${sync.running ? 'Listening only on your private Wi‑Fi.' : esc(sync.error || 'Starting LAN listener…')}<br/>Pair code: <code>${esc(sync.pairingCode || 'No private Wi‑Fi address found; connect to Wi‑Fi then refresh.')}</code><br/><b>Encrypted end-to-end.</b> Keep the code private; turn sync off to revoke it.</div>` : '<div class="note">LAN sync is off until you enable it. Notes stay on this computer.</div>'}
    </div>
    <div class="section-title"><h2>Recent notes</h2><span>${state.notes.length}</span></div>
    ${state.notes.length ? [...state.notes].slice(-20).reverse().map(note => `<div class="alert"><div style="flex:1"><div class="row-title">${esc(note.sender)} · ${esc(new Date(note.timestamp).toLocaleString())}</div>${note.text ? `<div class="body">${esc(note.text)}</div>` : ''}${note.image ? `<div class="body">▧ Image attached</div>` : ''}</div></div>`).join('') : '<div class="empty">No notes yet. Open Quick notes to add one.</div>'}`;
  el('open-notes').addEventListener('click', () => window.bop.openNotes());
  el('toggle-notes-sync').addEventListener('click', async () => { await window.bop.setNotesSync(!state.notesSync.enabled); await refresh(); });
}

function renderAlerts() {
  const sorted = [...state.alerts].sort((left, right) => right.at - left.at);
  const unread = sorted.filter((alert) => !alert.acknowledged).length;
  el('main').innerHTML = `
    <div class="section-title"><h2>Catch up.</h2><span>${unread} unread · ${sorted.length} total</span></div>
    <div style="display:flex;gap:8px;margin:12px 0 18px">
      <button class="primary" id="check-now">Check watched pages now</button>
      <button class="ghost" id="ack-all" ${unread ? '' : 'disabled'}>Mark all read</button>
      <button class="ghost" id="clear-alerts" ${sorted.length ? '' : 'disabled'}>Clear</button>
    </div>
    ${sorted.length ? sorted.map(alertCard).join('') : '<div class="empty">Nothing yet. Watched pages and web notifications land here.</div>'}`;
  el('check-now').addEventListener('click', async () => { await window.bop.checkNow(); await refresh(); });
  el('ack-all').addEventListener('click', async () => { await window.bop.acknowledgeAll(); await refresh(); });
  el('clear-alerts').addEventListener('click', async () => { await window.bop.clearAlerts(); await refresh(); });
}

function alertCard(alert) {
  const kind = alert.kind === 'watch' ? 'watch' : alert.kind === 'error' ? 'error' : 'web';
  const space = state.enabled.find((value) => value.id === alert.spaceId);
  return `
    <div class="alert kind-${kind} ${alert.acknowledged ? '' : 'unread'}">
      <div style="flex:1;min-width:0">
        <div class="row-title">${esc(alert.title)}</div>
        <div class="body">${esc(alert.body)}</div>
        <div class="card-actions">
          ${space ? `<button class="primary" data-open="${esc(space.id)}">Open ${esc(space.label)}</button>` : ''}
          ${alert.acknowledged ? '' : `<button class="ghost" data-ack="${esc(alert.spaceId)}:${esc(alert.tag)}">Mark read</button>`}
        </div>
      </div>
      <div class="when">${esc(ago(alert.at))}</div>
    </div>`;
}

function renderSettings() {
  const v = state.versions;
  el('main').innerHTML = `
    <div class="section-title"><h2>Settings</h2><span>Small tweaks</span></div>

    <div class="card">
      <h3>Appearance</h3>
      <p>Matches the Android palette.</p>
      <div class="card-actions">
        ${['system', 'light', 'dark'].map((choice) => `<button class="${state.theme === choice ? 'primary' : 'ghost'}" data-theme="${choice}">${choice[0].toUpperCase()}${choice.slice(1)}</button>`).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Floating bubble</h3>
      <p>One round bubble that stays exactly where you drop it, with its own centred space menu.</p>
      <div class="card-actions">
        <button class="${state.bubble ? 'ghost' : 'primary'}" id="toggle-bubble">${state.bubble ? 'Stop bubble' : 'Start bubble'}</button>
      </div>
      ${state.bubble ? `
      <div class="field"><label>Size</label>
        <div class="card-actions">
          ${state.bubbleSizes.map((size) => `<button class="${state.bubblePrefs.size === size ? 'primary' : 'ghost'}" data-bubble-size="${size}">${size}px</button>`).join('')}
        </div>
      </div>
      <div class="field"><label for="bubble-opacity">Transparency · ${100 - state.bubblePrefs.opacity}% see-through</label>
        <input id="bubble-opacity" type="range" min="${45}" max="100" value="${state.bubblePrefs.opacity}" />
      </div>
      <div class="field"><label for="bubble-double">Double-click the bubble</label>
        <select id="bubble-double">
          ${[['menu', 'Open the space menu'], ['last-space', 'Open the last space I used'], ['dashboard', 'Open the dashboard']]
            .map(([value, text]) => `<option value="${value}" ${state.bubblePrefs.doubleClick === value ? 'selected' : ''}>${text}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Bubble picture</label>
        <div class="bubble-face">
          <span class="face-preview">${state.bubbleAvatar
            ? `<img src="${esc(state.bubbleAvatar)}" alt="The picture the bubble wears" />`
            : '<span class="face-drawn" aria-hidden="true">☺</span>'}</span>
          <span class="face-actions">
            <button class="ghost" id="bubble-picture">Choose a picture…</button>
            ${state.bubbleAvatar ? '<button class="ghost" id="bubble-picture-clear">Use the drawn face</button>' : ''}
          </span>
        </div>
        ${avatarError ? `<div class="note warn">${esc(avatarError)}</div>` : ''}
        <div class="note">Cropped to a square and kept inside Bop's own settings file, so moving the
          original cannot break it. PNG, JPEG, WebP, BMP, GIF and SVG work.</div>
      </div>
      <div class="field"><label for="bubble-fullscreen"><input type="checkbox" id="bubble-fullscreen" ${state.bubblePrefs.overFullscreen ? 'checked' : ''} /> Show the bubble over full-screen apps</label></div>
      <div class="note">Press the bubble anywhere and drag: it follows the pointer and stays exactly where
        you let go — any spot on the screen, including the middle of it, and only the screen edge moves it
        back. A press that does not travel is a click, so the space menu is as easy to open as before: one
        click opens it, a double-click does what the setting above says, and a right-click opens a quick
        menu.</div>` : ''}
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Startup, tray &amp; background pages</h3>
      <p>Bop is a monitor: it should already be listening before the first message arrives, and it should live
        in the tray instead of in your way.</p>
      <div class="card-actions">
        <button class="${state.startAtLogin ? 'primary' : 'ghost'}" id="toggle-autostart" ${state.autoStart.supported ? '' : 'disabled'}>${state.startAtLogin ? 'Starts with the computer' : 'Does not start with the computer'}</button>
        <button class="${state.keepPagesAlive ? 'primary' : 'ghost'}" id="toggle-keepalive">${state.keepPagesAlive ? 'Pages run at full speed' : 'Pages are throttled'}</button>
      </div>
      <dl class="kv">
        <dt>Start-up entry</dt><dd>${state.autoStart.registered ? 'registered with Windows' : (state.autoStart.supported ? 'not registered' : 'installed build only')}${state.autoStart.portable ? ' · portable copy' : ''}</dd>
        <dt>Tray</dt><dd>${state.tray ? 'running — left-click shows or hides this window' : 'not available on this system'}</dd>
        <dt>Dashboard</dt><dd>${state.dashboardVisible ? 'visible' : 'hidden; every space keeps listening'}</dd>
      </dl>
      ${state.autoStart.error ? `<div class="note warn">${esc(state.autoStart.error)}</div>` : ''}
      <div class="note">
        Left-click the tray icon to bring the hub forward, or to put it away when it is already in front;
        right-click it for the bubble, the spaces, the start-up switch and Quit. Closing this window hides it
        and keeps every space listening — Quit is the only thing that stops them. A sign-in launch starts
        with the tray and the bubble only, so nothing opens over what you are doing.
      </div>
      <div class="note">
        Full speed keeps each page's own timers and connections running while it sits in a background pane,
        which is what lets a chat page notice a message at all. A page that then believes it is on screen may
        show its own badge instead of a notification, so the tab title stays the primary source Bop reads.
        Switching it off restores the system default for a background tab: timers clamped to about one per
        second while the page is not being looked at.
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Message sound</h3>
      <p>Bop requests the operating system's short notification sound for each new detected signal. OS permissions, Focus Assist and mute still apply; a portable installation may have no working OS toast/sound.</p>
      <button class="${state.messageSound ? 'primary' : 'ghost'}" id="toggle-message-sound">${state.messageSound ? 'On' : 'Muted'}</button>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Linked notes</h3>
      <p>A private, end-to-end encrypted connection lets your Android and desktop notes meet on the same Wi‑Fi. Images are supported. No cloud account or relay.</p>
      <div class="card-actions"><button class="primary" id="settings-notes-open">Open quick notes</button><button class="${state.notesSync.enabled ? 'primary' : 'ghost'}" id="settings-notes-toggle">${state.notesSync.enabled ? 'Stop LAN sync' : 'Start LAN sync'}</button></div>
      ${state.notesSync.enabled ? `<div class="note">${state.notesSync.running ? 'Listening' : esc(state.notesSync.error || 'Starting')} · ${esc(state.notesSync.addresses[0] || 'No private IPv4 address found')}:${state.notesSync.port}<br/>Pairing token: <code>${esc(state.notesSync.token)}</code><br/>LAN only · encrypted. Keep the token private.</div>` : ''}
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Watching</h3>
      <p>Re-read watched pages while Bop is running.</p>
      <div class="card-actions">
        <button class="${state.watchWhileRunning ? 'primary' : 'ghost'}" id="toggle-watch">${state.watchWhileRunning ? 'On' : 'Off'}</button>
        <button class="ghost" id="check-now-2">Check now</button>
      </div>
      <div class="note">
        Pages are read, never reloaded, so a chat you are in the middle of is left alone. A read that fails
        (offline, logged out) is never reported as a change. Consecutive failures stretch the interval so a
        broken page is not hammered.
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Sessions</h3>
      <p>Each space is a separate Chromium session — separate cookies, storage and cache.</p>
      <div class="card-actions">
        ${state.enabled.map((space) => `<button class="ghost" data-clear="${esc(space.id)}">Clear ${esc(space.label)}</button>`).join('')}
      </div>
      <div class="note">Clearing removes cookies and site storage for that space only. Other spaces stay signed in.</div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Diagnostics</h3>
      <dl class="kv">
        <dt>Bop</dt><dd>${esc(v.app)}</dd>
        <dt>Electron / Chromium</dt><dd>${esc(v.electron)} / ${esc(v.chrome)}</dd>
        <dt>Platform</dt><dd>${esc(v.platform)} · kernel ${esc(v.os)}</dd>
        <dt>Session prefix</dt><dd>${esc(v.partitionPrefix)}&lt;space&gt;</dd>
        <dt>Settings file</dt><dd>${state.encryption ? 'encrypted with the OS key store' : 'NOT encrypted — this system offered no key'}</dd>
        <dt>Spaces on disk</dt><dd>${state.spaces.length}</dd>
      </dl>
      ${state.diskError ? `<div class="note warn">${esc(state.diskError)}</div>` : ''}
    </div>`;    el('settings-notes-open').addEventListener('click', () => window.bop.openNotes());
  el('settings-notes-toggle').addEventListener('click', async () => { await window.bop.setNotesSync(!state.notesSync.enabled); await refresh(); });
  for (const button of el('main').querySelectorAll('[data-theme]')) {
    button.addEventListener('click', async () => { await window.bop.setPreference('theme', button.dataset.theme); await refresh(); });
  }
  el('toggle-bubble').addEventListener('click', async () => { await window.bop.setPreference('bubble', !state.bubble); await refresh(); });
  for (const button of el('main').querySelectorAll('[data-bubble-size]')) {
    button.addEventListener('click', async () => { await window.bop.setBubble({ size: Number(button.dataset.bubbleSize) }); await refresh(); });
  }
  if (el('bubble-opacity')) {
    el('bubble-opacity').addEventListener('change', async () => { await window.bop.setBubble({ opacity: Number(el('bubble-opacity').value) }); await refresh(); });
    el('bubble-double').addEventListener('change', async () => { await window.bop.setBubble({ doubleClick: el('bubble-double').value }); await refresh(); });
    el('bubble-fullscreen').addEventListener('change', async () => { await window.bop.setBubble({ overFullscreen: el('bubble-fullscreen').checked }); await refresh(); });
    el('bubble-picture').addEventListener('click', async () => {
      const result = await window.bop.chooseBubbleAvatar();
      avatarError = result && result.error ? result.error : '';
      await refresh();
    });
    if (el('bubble-picture-clear')) {
      el('bubble-picture-clear').addEventListener('click', async () => { await window.bop.clearBubbleAvatar(); avatarError = ''; await refresh(); });
    }
  }
  el('toggle-autostart').addEventListener('click', async () => { await window.bop.setPreference('startAtLogin', !state.startAtLogin); await refresh(); });
  el('toggle-keepalive').addEventListener('click', async () => { await window.bop.setPreference('keepPagesAlive', !state.keepPagesAlive); await refresh(); });
  el('toggle-message-sound').addEventListener('click', async () => { await window.bop.setPreference('messageSound', !state.messageSound); await refresh(); });
  el('toggle-watch').addEventListener('click', async () => { await window.bop.setPreference('watchWhileRunning', !state.watchWhileRunning); await refresh(); });
  el('check-now-2').addEventListener('click', async () => { await window.bop.checkNow(); await refresh(); });
  for (const button of el('main').querySelectorAll('[data-clear]')) {
    button.addEventListener('click', async () => { await window.bop.clearSpace(button.dataset.clear); await refresh(); });
  }
}

const GUIDE = [
  ['01 / Two kinds of space', 'A social space is a messaging account. A task space is a work or earning panel. They behave the same way — separate cookies, separate logins — but a task space is usually worth watching, because a study that opens while you are away can be gone in minutes.'],
  ['02 / Why watching works here', 'On the desktop a page keeps a live connection and its own notifications work, so Bop can also read a page again after you have walked away. The Android build cannot do this: a closed WebView receives no push, which is why it only reacts to notifications the phone already received.'],
  ['03 / What a watch card means', 'The first reading of a page never creates a card — otherwise every newly watched page would fire one. After that, a card appears only when the page text actually changes. Whitespace-only differences are ignored, and a failed read (offline, signed out) is never reported as a change.'],
  ['04 / Point the watch at the right part', 'By default the whole page body is compared, which works but is noisy on a busy page. Put a CSS selector in the watch settings — for example #jobs, .studies, main — and only that part is compared. If the selector matches nothing, Bop quietly falls back to the whole body.'],
  ['05 / Filter the noise with a phrase', 'A selector decides *where* Bop looks; a phrase decides *whether* a change is worth a card. Set “only card me when the page contains” to available and a board that reshuffles its own widgets stays silent until a study actually opens. Set “stay quiet when the page contains” to mute something that churns on its own. Both are plain, case-insensitive text, and both are optional.'],
  ['06 / Notifications from each account', 'Open each space once. Bop listens to native tab-title updates independently of website notifications, and mirrors successful window.Notification events as a supplementary source. Only unread increases after the initial baseline alert; identical readings do not repeat. Titles expose an aggregate count or dot, not message IDs: unchanged counts, capped badges, already-read messages and per-conversation details cannot be reconstructed. Closing the interface keeps loaded sessions in the tray; Quit exits. Stop monitoring releases that space and keeps its cookies. OS notifications and sound obey OS permissions and Bop mute; portable Windows builds may lack working OS sound.'],
  ['07 / The tray, the bubble and starting with the computer', 'Bop asks Windows to launch it at sign-in, so it is already listening when the first message arrives; Settings and the tray menu both switch that off, and a start-up launch opens only the tray icon and the bubble — nothing appears over your work. The tray is the way back in: left-click brings the hub forward or puts it away again, right-click offers the spaces, the bubble, the start-up switch and Quit. The bubble is on by default, wears a drawn smile until you give it a picture of your own in Settings, and moves with a press anywhere on it — it follows the pointer and stays exactly where you let go, with the screen edge as the only limit. A press that does not travel is a click, so one click opens the space menu, a double-click does whatever the setting says and a right-click opens a quick menu. Exactly one Bop runs per profile, so clicking the app again while it is already running simply shows the hub it already has.'],
  ['08 / Fitting the screen', 'Bop gives every space a narrow pane on purpose, and a desktop website is designed for a wider one — which is where a page ends up with its own dialog half off the edge, close button included, and no way to dismiss it. So a *task panel* asks for the mobile website by default: the same dashboard, laid out for an arbitrary width. A *messaging* space does the opposite, because the mobile site of these services is not their messages page: measured with the phone layout, tiktok.com/messages becomes the For You feed, web.whatsapp.com answers with a landing page, and so do Snapchat and Skype. Those pages cannot raise a message alert, so a social space loads the desktop site. Edit switches either way by hand, and switching reloads the page because the site picks its layout while serving it.'],
  ['09 / Staying on the right site', 'A space only stays on the hosts listed in its card. A link that leaves them is handed to your normal browser instead of being opened inside the space, and a card tells you when that happened. Plain http is refused except on localhost.'],
  ['10 / What is stored', 'Space ids, labels, app choices, opened-space ids and watch settings, encrypted with the operating system’s own key store when one is available — Settings says so if it is not. Cookies and logged-in sessions live in Chromium’s profile for each space. Alerts are kept in memory only and are gone when Bop closes.'],
  ['11 / Linked notes', 'Desktop and Android can share quick notes and images over the same private Wi‑Fi. Turn LAN sync on in Desktop Settings, keep both apps open on that network, and pair Android with the shown private address and token. Sync is end-to-end encrypted with a one-time random token, with no Internet relay or cloud storage. Anyone on your private network who gets the token can read the notes, so keep it private and stop sync to revoke it.'],
  ['12 / Moving between sections and external bubbles', 'Spaces, Alerts, Notes, Settings and Guide in the sidebar always switch, including while a space is open: the space steps aside and keeps running in the background pane, session and monitoring intact, so leaving it never needs the ✕. The Bop bubble opens Bop spaces and shows their pending alerts. It cannot accept or embed chat bubbles or windows owned by another application. There is no drag-in feature for external bubbles.'],
  ['13 / Honest limits', 'A watched space is only read while Bop is running — there is no background service that survives quitting the app. Reading a page cannot see a change that happened and reverted between two checks. Panels can change their layout, which can cause one noisy card; fix it by setting a narrower selector. And no site is scraped: only title and body text are compared, and no credentials or messages are extracted.'],
];

function renderGuide() {
  el('main').innerHTML = `
    <div class="section-title"><h2>The tiny manual.</h2><span>Everything useful, nothing in the way</span></div>
    ${GUIDE.map(([title, body]) => `<div class="card" style="margin-bottom:12px"><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`).join('')}
    <div class="note">Bop is an independent hub, not an official client. A loaded page is not proof of authentication or message delivery. No tab-title marker or website event means no supported detection source; Bop does not invent one.</div>`;
}

// --- modals ----------------------------------------------------------------------------------
/**
 * Builds a dialog as a fixed header, a scrolling body and a fixed footer. The last `.card-actions` of the
 * given markup becomes the footer, so Save/Cancel stay on screen and never sit on top of the last field
 * when the form is taller than the window.
 */
function openModal(html) {
  modal = el('modal-root');
  modal.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="modal-body"></div></div></div>`;
  const dialog = modal.querySelector('.modal');
  const body = dialog.querySelector('.modal-body');
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const nodes = Array.from(holder.children);
  const last = nodes[nodes.length - 1];
  const footer = last && last.classList.contains('card-actions') ? last : null;
  for (const node of nodes) if (node !== footer) body.append(node);
  if (footer) dialog.append(footer);
  // A dialog has to be clickable, not only visible: the space panes are drawn on top of this renderer,
  // so the main process lifts this view while a dialog is open (see setModal in preload.js).
  window.bop.setModal(true);
  modal.querySelector('.modal-backdrop').addEventListener('mousedown', (event) => {
    if (event.target.classList.contains('modal-backdrop')) closeModal();
  });
}

function closeModal() {
  modal = null;
  el('modal-root').innerHTML = '';
  window.bop.setModal(false);
}

function openPicker() {
  let kind = 'social';
  const render = () => {
    const apps = state.apps.filter((app) => app.kind === kind);
    openModal(`
      <h2>A new little space</h2>
      <p class="hint">Pick what this space is for. Social accounts and task panels are kept in separate groups.</p>
      <div class="card-actions">
        <button class="${kind === 'social' ? 'primary' : 'ghost'}" data-kind="social">Social account</button>
        <button class="${kind === 'tasks' ? 'primary' : 'ghost'}" data-kind="tasks">Task / earning panel</button>
      </div>
      <div class="app-grid">
        ${apps.map((app) => `<button class="app-choice" data-app="${esc(app.id)}"><div class="app-name">${esc(app.label)}</div><div class="app-kind">${esc(app.kind)}</div></button>`).join('')}
      </div>
      <div class="card-actions"><button class="ghost" id="cancel">Cancel</button></div>`);
    for (const button of modal.querySelectorAll('[data-kind]')) {
      button.addEventListener('click', () => { kind = button.dataset.kind; render(); });
    }
    for (const button of modal.querySelectorAll('[data-app]')) {
      button.addEventListener('click', () => chooseApp(button.dataset.app, kind));
    }
    el('cancel').addEventListener('click', closeModal);
  };
  render();
}

async function chooseApp(appId, kind) {
  const app = state.apps.find((value) => value.id === appId);
  if (appId === 'custom') return customSpace(kind);
  const created = await window.bop.addSpace({ appId, kind });
  closeModal();
  await refresh();
  if (created && created.ok) await window.bop.openSpace(created.id);
  await refresh();
}

function customSpace(kind) {
  openModal(`
    <h2>Any other site</h2>
    <p class="hint">Paste the exact page you want this space to open. Its host — and only that host — is allowed inside the space.</p>
    <div class="field"><label for="custom-url">Address</label>
      <input id="custom-url" type="url" placeholder="https://app.example.com/studies" /></div>
    <div class="field"><label for="custom-label">Name</label>
      <input id="custom-label" maxlength="60" placeholder="My panel" /></div>
    <div class="card-actions">
      <button class="primary" id="ok">Create</button>
      <button class="ghost" id="cancel">Cancel</button>
    </div>
    <div class="note" id="err" hidden></div>`);
  el('cancel').addEventListener('click', closeModal);
  el('ok').addEventListener('click', async () => {
    const url = el('custom-url').value.trim();
    const label = el('custom-label').value.trim();
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch (_) { hostname = ''; }
    const crypt = url.startsWith('https://');
    const loopback = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
    if (!hostname || (!crypt && !loopback)) {
      const err = el('err');
      err.hidden = false;
      err.className = 'note warn';
      err.textContent = 'Use a full https address (http is only accepted for localhost).';
      return;
    }
    const created = await window.bop.addSpace({ appId: 'custom', kind, url, label: label || hostname });
    if (created && created.ok) await window.bop.setUrl(created.id, url);
    closeModal();
    await refresh();
    if (created && created.ok) { await window.bop.loadSpace(created.id); await refresh(); }
  });
}

function openEdit(id, note = null) {
  const space = state.spaces.find((value) => value.id === id);
  if (!space) return;
  const app = state.apps.find((value) => value.id === space.appId);
  openModal(`
    <h2>${esc(space.label)}</h2>
    <p class="hint">Slot ${esc(space.id)} · ${esc(app ? app.label : space.appId)}</p>
    ${note ? `<div class="note warn">${esc(note)}</div>` : ''}
    <div class="field"><label for="edit-label">Name</label><input id="edit-label" maxlength="60" value="${esc(space.label)}" /></div>
    <div class="field"><label for="edit-app">Service</label>
      <select id="edit-app">${state.apps.map((value) => `<option value="${esc(value.id)}" ${value.id === space.appId ? 'selected' : ''}>${esc(value.label)} (${esc(value.kind)})</option>`).join('')}</select>
    </div>
    <div class="field"><label for="edit-kind">Group</label>
      <select id="edit-kind">
        <option value="social" ${space.kind === 'social' ? 'selected' : ''}>Social account</option>
        <option value="tasks" ${space.kind === 'tasks' ? 'selected' : ''}>Task / earning panel</option>
      </select>
    </div>
    <div class="field"><label for="edit-layout">Which website the space loads</label>
      <select id="edit-layout">
        <option value="desktop" ${space.phoneLayout ? '' : 'selected'}>Desktop site — the real chat and its notifications${space.kind === 'social' ? ' (default)' : ''}</option>
        <option value="phone" ${space.phoneLayout ? 'selected' : ''}>Mobile site — fits this window${space.kind === 'tasks' ? ' (default)' : ''}</option>
      </select>
    </div>
    ${space.appId === 'custom' ? `<div class="field"><label for="edit-url">Address</label><input id="edit-url" value="${esc(space.url)}" /></div>` : ''}
    <h3 style="margin-top:16px">Watching</h3>
    <div class="field"><label for="edit-watch"><input type="checkbox" id="edit-watch" ${space.watch.enabled ? 'checked' : ''} /> Watch this page for changes</label></div>
    <div class="field"><label for="edit-minutes">Minutes between checks</label>
      <input id="edit-minutes" type="number" min="1" max="720" value="${esc(space.watch.minutes)}" /></div>
    <div class="field"><label for="edit-selector">CSS selector (optional)</label>
      <input id="edit-selector" placeholder="#jobs, .studies, main" value="${esc(space.watch.selector)}" /></div>
    <div class="field"><label for="edit-require">Only card me when the page contains (optional)</label>
      <input id="edit-require" placeholder="available" value="${esc(space.watch.require)}" /></div>
    <div class="field"><label for="edit-ignore">Stay quiet when the page contains (optional)</label>
      <input id="edit-ignore" placeholder="ads, sponsored" value="${esc(space.watch.ignore)}" /></div>
    <div class="note">${esc(app ? app.login : '')}</div>
    <div class="card-actions" style="margin-top:14px">
      <button class="primary" id="save">Save</button>
      <button class="ghost" id="reload">Reload page</button>
      <button class="ghost" id="clear">Clear session</button>
      <button class="danger" id="remove">Remove space</button>
      <button class="ghost" id="cancel">Cancel</button>
    </div>`);
  // The reason this dialog opened is usually a missing or refused address, so the field that fixes it
  // is the one that gets the cursor.
  if (note && el('edit-url')) el('edit-url').focus();
  el('cancel').addEventListener('click', closeModal);
  el('reload').addEventListener('click', async () => { await window.bop.reloadSpace(id); });
  el('clear').addEventListener('click', async () => { await window.bop.clearSpace(id); });
  el('remove').addEventListener('click', async () => { await window.bop.removeSpace(id); closeModal(); await refresh(); });
  el('save').addEventListener('click', async () => {
    await window.bop.rename(id, el('edit-label').value);
    await window.bop.selectApp(id, el('edit-app').value, el('edit-kind').value);
    // Changing the layout reloads the page, which is the point: the site picks a layout per request.
    await window.bop.setPhoneLayout(id, el('edit-layout').value === 'phone');
    if (space.appId === 'custom' && el('edit-url')) await window.bop.setUrl(id, el('edit-url').value);
    await window.bop.setWatch(id, {
      enabled: el('edit-watch').checked,
      minutes: Number(el('edit-minutes').value),
      selector: el('edit-selector').value,
      require: el('edit-require').value,
      ignore: el('edit-ignore').value,
    });
    closeModal();
    await refresh();
  });
}

function openWatch(id) {
  const space = state.spaces.find((value) => value.id === id);
  if (!space) return;
  openModal(`
    <h2>Watch ${esc(space.label)}</h2>
    <p class="hint">Bop re-reads this page and cards you when its text changes.</p>
    <div class="field"><label for="w-on"><input type="checkbox" id="w-on" ${space.watch.enabled ? 'checked' : ''} /> Watch this page</label></div>
    <div class="field"><label for="w-min">Minutes between checks</label>
      <input id="w-min" type="number" min="1" max="720" value="${esc(space.watch.minutes)}" /></div>
    <div class="field"><label for="w-sel">CSS selector (optional)</label>
      <input id="w-sel" placeholder="#jobs, .studies, main" value="${esc(space.watch.selector)}" /></div>
    <div class="field"><label for="w-req">Only card me when the page contains (optional)</label>
      <input id="w-req" placeholder="available" value="${esc(space.watch.require)}" /></div>
    <div class="field"><label for="w-ign">Stay quiet when the page contains (optional)</label>
      <input id="w-ign" placeholder="ads, sponsored" value="${esc(space.watch.ignore)}" /></div>
    <div class="note">${space.watch.lastCheckAt ? `Last checked ${esc(ago(space.watch.lastCheckAt))}.` : 'Not checked yet — the first reading never raises a card.'}
      ${space.watch.lastChangeAt ? ` Last change ${esc(ago(space.watch.lastChangeAt))}.` : ''}
      ${space.watch.failures ? ` ${space.watch.failures} failed read(s) in a row; the interval is stretched.` : ''}</div>
    <div class="card-actions" style="margin-top:14px">
      <button class="primary" id="ok">Save</button>
      <button class="ghost" id="cancel">Cancel</button>
    </div>`);
  el('cancel').addEventListener('click', closeModal);
  el('ok').addEventListener('click', async () => {
    await window.bop.setWatch(id, {
      enabled: el('w-on').checked,
      minutes: Number(el('w-min').value),
      selector: el('w-sel').value,
      require: el('w-req').value,
      ignore: el('w-ign').value,
    });
    closeModal();
    await refresh();
  });
}

// --- wiring ----------------------------------------------------------------------------------
function onClick(event) {
  const target = event.target.closest('[data-open],[data-edit],[data-watch],[data-ack],[data-stop],#close-space,#new-space');
  if (!target) return;
  if (target.id === 'new-space') return openPicker();
  if (target.id === 'close-space') return void window.bop.closeSpace().then(refresh);
  const open = target.getAttribute('data-open');
  if (open) return void window.bop.openSpace(open).then(async (result) => {
    await refresh();
    // A space with no usable address must not be a dead end: say why and put the cursor in the field
    // that fixes it instead of leaving the user with an empty pane. See openTarget in spaces.js.
    if (result && result.ok === false) openEdit(open, result.error);
  });
  const stop = target.getAttribute('data-stop');
  if (stop) return void window.bop.stopSpace(stop).then(refresh);
  const edit = target.getAttribute('data-edit');
  if (edit) return openEdit(edit);
  const watch = target.getAttribute('data-watch');
  if (watch) return openWatch(watch);
  const ack = target.getAttribute('data-ack');
  if (ack) return void window.bop.acknowledge(ack).then(refresh);
}

el('nav').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-page]');
  if (!button) return;
  page = button.dataset.page;
  // A space covers the main pane, and the pane is what this button is asking to look at: measured on
  // 0.1.7, Settings and the Guide switched the page *behind* the open space, so the section looked
  // broken until the space was closed with the ✕. Switching a section now leaves the space — the page
  // keeps running in the background pane with its session and its monitor, which is the state it is
  // already in while it is not the visible one.
  if (state && state.enabled.some((space) => space.open)) {
    await window.bop.closeSpace();
    state = await window.bop.snapshot();
  }
  render();
});

document.addEventListener('click', onClick);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state && state.theme === 'system') applyTheme(); });

window.bop.onChanged((next) => { state = next; render(); });
window.bop.onFocusSpace((id) => { page = 'alerts'; render(); });

refresh().then(() => setInterval(() => { if (page === 'alerts') render(); }, 30_000));
