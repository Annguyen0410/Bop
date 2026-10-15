'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app, BaseWindow, WebContentsView, BrowserWindow, ipcMain, screen, session,
  shell, Tray, Menu, dialog, nativeImage, safeStorage, Notification, nativeTheme, clipboard,
} = require('electron');

const spaces = require('./spaces.js');
const watcher = require('./watcher.js');
const docking = require('./docking.js');
const bubbleDrag = require('./bubble-drag.js');
const avatar = require('./avatar.js');
const popup = require('./popup.js');
const notifyLog = require('./notify-log.js');
const autostart = require('./autostart.js');
const { AccountMonitor } = require('./message-monitor.js');
const notesSync = require('./notes-sync.js');
const { randomUUID, randomBytes } = require('node:crypto');

// Windows ties a taskbar identity — and therefore any notification the OS agrees to show — to this id.
// It is also what the installer's Start Menu shortcut carries, so an installed Bop is recognised as the
// same application when it was started from a portable copy earlier.
app.setAppUserModelId('com.bop.desktop');

const MONITOR_SMOKE = process.argv.includes('--bop-monitor-smoke');
const SMOKE = process.argv.includes('--bop-smoke') || MONITOR_SMOKE;
const LIVE_CHECK = process.argv.includes('--bop-live-check');
const SMOKE_ACTIVE = process.argv.includes('--bop-active'); // smoke with a visible window, used for capture
const LIVE_OUT_ARG = process.argv.includes('--bop-out') ? process.argv[process.argv.indexOf('--bop-out') + 1] : null;
const LIVE_USER_DATA_ARG = process.env.BOP_LIVE_USER_DATA || process.argv.find((argument) => argument.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length) || null;
const LIVE_SETTINGS_ARG = process.env.BOP_LIVE_SETTINGS;
// The operating system started this copy at sign-in. Nothing was clicked, so the dashboard stays out of
// the way: the tray and the bubble are the surfaces until the user asks for the hub.
const LAUNCHED_AT_LOGIN = !SMOKE && !LIVE_CHECK && autostart.launchedAtLogin(process.argv);
const SMOKE_OUT = LIVE_OUT_ARG || valueAfter('--bop-out') || path.join(app.getPath('userData'), 'smoke');
const SIDEBAR = 320;

/** Shown on a space card when the page answered by refusing the browser instead of serving itself. */
const BROWSER_REFUSED_NOTE = 'This page says it does not support the browser Bop opens it with, so the pane stays empty. Open the address in your own browser to check it.';
const BUBBLE_MARGIN = 24;
/** Width of the space menu. Centred on the display, so it is one number handed to `docking.centered`. */
const MENU_WIDTH = 340;

/**
 * The theme a window paints with, with 'system' already resolved. It is passed to the small windows as
 * a start-up argument so their *first* frame is the right colour: waiting for the snapshot means a
 * light flash inside a dark desktop, and `color-scheme` decides scrollbars and carets before any
 * script runs.
 */
function resolveTheme() {
  const chosen = (state && state.theme) || 'system';
  if (chosen !== 'system') return chosen;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

// The bubble's size is a setting, not a constant, so every placement reads it from state.
const bubblePrefs = () => (state && state.bubblePrefs) || spaces.bubbleDefaults();
const bubbleSize = () => bubblePrefs().size;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

// Verification runs must never read or write the real Bop settings: a leftover watch fingerprint from
// the previous run would look like a live page change, and the run would also trample the user's spaces.
// Own userData directory, reset every run, so each run starts exactly like a first launch.
if (SMOKE || LIVE_CHECK) {
  fs.mkdirSync(SMOKE_OUT, { recursive: true });
  const isolated = LIVE_CHECK && LIVE_USER_DATA_ARG ? LIVE_USER_DATA_ARG : app.getPath('userData');
  if (path.resolve(app.getPath('userData')) !== path.resolve(isolated)) app.setPath('userData', isolated);
  // The live checker writes a controlled fixture profile before launch. Only the standalone smoke run
  // owns and resets its profile; removing the live fixture here would silently replace it with defaults.
  if (SMOKE) fs.rmSync(isolated, { recursive: true, force: true });
  fs.mkdirSync(isolated, { recursive: true });
  // Say it out loud rather than assume it: a smoke run that ever fell back to the real profile would
  // write its own fixture spaces into the user's space list, and one of those (a `custom` space with
  // no address) is exactly the state that used to open an empty pane. Refuse to run at all instead.
  if (!path.isAbsolute(isolated) || !fs.existsSync(isolated)) {
    throw new Error('a verification run could not isolate its profile and must not touch the real settings');
  }
}

// One Bop per profile. A second copy would fight over the same settings file and draw a second bubble on
// the same desktop — and with "start Bop when I sign in" on, clicking the app while it is already running
// is the normal thing to do, so the second launch hands its request to the running copy instead. A smoke
// run never takes the lock, so verification can always run next to a Bop the user has open.
const singleInstance = SMOKE || LIVE_CHECK ? true : app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else if (!SMOKE && !LIVE_CHECK) {
  // The second launch is a request to see the hub, not a second copy of it.
  app.on('second-instance', () => {
    if (!shellWindow) createShellWindow();
    showDashboard(openSpaceId);
  });
}

// ---------------------------------------------------------------------------------------------
// Persistence. Space ids, labels, app choices and watch settings are not credentials — the cookies
// live in Chromium's own store — but they are still encrypted at rest when the OS offers a key,
// exactly like the Android build's encrypted settings file. When the OS cannot provide one, the file
// says so instead of pretending.
// ---------------------------------------------------------------------------------------------
const settingsPath = () => LIVE_CHECK && LIVE_SETTINGS_ARG ? LIVE_SETTINGS_ARG : path.join(app.getPath('userData'), 'bop-settings.bin');

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath());
    if (raw.length > NOTES_MAX_STORAGE_BYTES + 65_536) return spaces.defaultState();
    const decoded = raw.slice(0, 4).toString('utf8') === 'BOP0'
      ? raw.slice(4).toString('utf8')
      : LIVE_CHECK ? raw.toString('utf8')
        : safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : null;
    return decoded && Buffer.byteLength(decoded, 'utf8') <= NOTES_MAX_STORAGE_BYTES
      ? spaces.normalize(JSON.parse(decoded)) : spaces.defaultState();
  } catch (_) {
    return spaces.defaultState();
  }
}

function saveSettings() {
  try {
    const json = JSON.stringify({ ...state, notes: notesWithTombstones(state.notes, state.noteTombstones || []), alerts: undefined });
    if (Buffer.byteLength(json, 'utf8') > NOTES_MAX_STORAGE_BYTES) {
      diskError = 'Settings exceed the safe storage limit; remove some notes or images.';
      return false;
    }
    const payload = LIVE_CHECK ? Buffer.from(json, 'utf8')
      : safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(json)
        : Buffer.concat([Buffer.from('BOP0', 'utf8'), Buffer.from(json, 'utf8')]);
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), payload);
    diskError = safeStorage.isEncryptionAvailable() ? null : 'Settings are stored unencrypted: this system did not offer a key.';
    return true;
  } catch (failure) {
    diskError = `Settings could not be saved (${failure.message}).`;
    return false;
  }
}

let state = null;
let alerts = [];
let diskError = null;
let hovered = false;
let autoStartError = null;
let traySignature = null;

/** Kept outside the run so a failure still reports every step it managed to complete. */
const SMOKE_STEPS = [];

// ---------------------------------------------------------------------------------------------
// Windows and space views
// ---------------------------------------------------------------------------------------------
let shellWindow = null;      // the dashboard (renderer UI)
let uiView = null;
let bubbleWindow = null;
let menuWindow = null;
let bubbleSpot = { x: BUBBLE_MARGIN, y: BUBBLE_MARGIN };
let settleTimer = null;
let suppressDockUntil = 0;
let tray = null;

const spaceViews = new Map();  // id -> WebContentsView
const monitors = new Map(); // Tiny state objects; reuse each existing authenticated view.
const retryTimers = new Map(); // Only failed loads/renderers have a one-shot retry.
let metadataTimer = null;
let notificationAttempts = 0;
const notificationDiagnostics = { shown: 0, failed: 0, lastSilent: null };
// What each space last notified about, so an unchanged page cannot ding the desktop twice. See
// notify-log.js: only the most recent notification per space is remembered, and nothing is persisted.
let notifyLogState = notifyLog.empty();
let openSpaceId = null;
let notesWindow = null;
let notesServer = null;
let notesSyncError = null;
let notesSyncGeneration = 0;
let notesSyncJob = Promise.resolve();
let notesSyncDeadline = null;
const NOTES_MAX_STORAGE_BYTES = 12_000_000;

function monitorFor(id) {
  if (!monitors.has(id)) monitors.set(id, new AccountMonitor(state.monitorState[id]));
  return monitors.get(id);
}

function persistMonitor(id) {
  state = { ...state, monitorState: { ...state.monitorState, [id]: monitorFor(id).saved() } };
  // Coalesce bursts into one settings write, never persist page text or notification previews.
  if (!metadataTimer) metadataTimer = setTimeout(() => {
    metadataTimer = null;
    saveSettings();
  }, 1000);
}

function stopSpace(id, forgetMetadata = false) {
  clearTimeout(retryTimers.get(id));
  retryTimers.delete(id);
  const view = spaceViews.get(id);
  spaceViews.delete(id); // Remove routing BEFORE close can emit renderer events.
  if (view) {
    if (shellWindow && !shellWindow.isDestroyed()) shellWindow.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  monitors.delete(id);
  state = { ...state, loadedSlots: state.loadedSlots.filter(value => value !== id) };
  if (forgetMetadata) {
    const monitorState = { ...state.monitorState };
    delete monitorState[id];
    state = { ...state, monitorState };
  }
  if (openSpaceId === id) openSpaceId = null;
}

function retrySpace(id) {
  if (!spaceViews.has(id) || app.isQuitting) return;
  const monitor = monitorFor(id);
  const delay = monitor.unavailable();
  clearTimeout(retryTimers.get(id));
  retryTimers.delete(id);
  // Five bounded attempts; never loop forever against an unavailable provider.
  if (monitor.failures <= 5) retryTimers.set(id, setTimeout(() => {
    retryTimers.delete(id);
    const view = spaceViews.get(id);
    if (!view || view.webContents.isDestroyed()) return;
    monitor.start(true);
    view.webContents.reload();
  }, delay));
  broadcast();
}

function publishMessage(space, alert, incoming = 1) {
  const fresh = pushAlert({ ...alert, service: space.appId, source: alert.source || 'website', incoming });
  // The same words as this space's last notification: the desktop has already said them, so there is no
  // second ding for it. The alert is still in the Alerts list — it is the interruption that is skipped.
  if (!fresh) return;
  // Native notifications respect OS permission, Focus Assist/DND, channel/app mute and sound choice.
  // Do not use shell.beep or WebAudio to bypass these controls.
  if (Notification.isSupported()) {
    notificationDiagnostics.lastSilent = !state.messageSound;
    const notice = new Notification({ title: alert.title, body: alert.body, silent: notificationDiagnostics.lastSilent });
    notice.on('show', () => { notificationDiagnostics.shown += 1; });
    notice.on('click', () => focusSpace(space.id));
    notice.on('failed', () => {
      notificationDiagnostics.failed += 1;
      const active = monitors.get(space.id);
      if (!active) return; // A late OS response must not resurrect a stopped account.
      active.notificationStatus = 'OS notification failed; use account card / OS settings';
      broadcast();
    });
    notificationAttempts += 1;
    notice.show();
  }
}

function readTitle(id, title) {
  const space = spaces.accountFor(state, id);
  const view = spaceViews.get(id);
  if (!space || space.kind !== 'social' || !view || !spaces.pageAllowed(space, view.webContents.getURL())) return;
  const reading = monitorFor(id).title(title);
  if (!reading.changed) return;
  persistMonitor(id);
  if (reading.unread === 0) alerts = alerts.filter(alert => !(alert.spaceId === id && alert.tag === 'unread'));
  else {
    const previous = alerts.find(alert => alert.spaceId === id && alert.tag === 'unread');
    const alert = { spaceId: id, tag: 'unread', kind: 'web', source: 'title',
      title: `${space.label} · unread increased`, body: `${spaces.appOrDefault(space.appId).label} · ${reading.unread} unread reported by tab title (not message IDs)` };
    if (reading.incoming) publishMessage(space, alert, reading.incoming);
    else if (previous) alerts = alerts.map(value => value === previous ? { ...value, body: alert.body } : value);
  }
  broadcast();
}

const PARTITION_PREFIX = 'persist:bop-';

/**
 * The user agent a space asks to be served with — see `spaces.userAgentFor` for why it must not carry
 * the words Electron or Bop. Read at the moment of the call because a layout change has to reach the
 * engine before the reload that follows it.
 */
function agentFor(space) {
  return spaces.userAgentFor(space, { chrome: process.versions.chrome, platform: process.platform });
}

/** Applies a space's layout mode to its live view. A layout is chosen per request, so a change needs
 *  the reload that `bop:set-phone-layout` performs — this only tells the engine what to send next. */
function applyLayoutMode(id) {
  const view = spaceViews.get(id);
  const space = spaces.accountFor(state, id);
  if (!view || !space) return null;
  const agent = agentFor(space);
  view.webContents.setUserAgent(agent);
  return agent;
}

/** One Chromium session per space. This is the whole isolation story, and it is first-class. */
function sessionFor(id) {
  const existing = session.fromPartition(`${PARTITION_PREFIX}${id.toLowerCase()}`);
  const allowedOrigin = (origin) => {
    const space = spaces.accountFor(state, id);
    return space && (spaces.pageAllowed(space, origin) || (SMOKE && String(origin).startsWith('file://')));
  };
  existing.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = details.requestingUrl || contents?.getURL();
    callback(!!allowedOrigin(origin) && ['notifications', 'media', 'fullscreen', 'clipboard-sanitized-write'].includes(permission));
  });
  existing.setPermissionCheckHandler((_contents, permission, origin) =>
    !!allowedOrigin(origin) && ['notifications', 'media', 'fullscreen', 'clipboard-sanitized-write'].includes(permission));
  return existing;
}

function preloadPath() {
  return path.join(__dirname, 'preload.js');
}

/** Space pages get their own tiny bridge. They must never be able to drive the hub. */
function spacePreloadPath() {
  return path.join(__dirname, 'space-preload.js');
}

function spaceView(id) {
  if (!state.slots.includes(id)) return null;
  if (spaceViews.has(id)) return spaceViews.get(id);
  const space = spaces.accountFor(state, id);
  if (!space) return null;
  const view = new WebContentsView({
    webPreferences: {
      session: sessionFor(id),
      additionalArguments: [`--bop-space=${id}`],
      preload: spacePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // "Keep pages alive" (on by default). Measured on this build: with the default throttling, every
      // space pane reported `document.visibilityState === 'hidden'` and a 100 ms timer fired ten times
      // per ten seconds, because a WebContentsView is never told it became visible. A chat page in that
      // state is a page Chrome would freeze after five minutes, and a site that believes it is hidden
      // hands its messages to a service worker — which Electron does not run — so nothing reached Bop.
      // With throttling off the pane is an ordinary visible page again and timers run at full rate.
      // The trade-off is written down honestly in docs/desktop.md: a page that believes it is on screen
      // may show its own in-page badge instead of a notification, which is why the tab-title source
      // stays the primary one and why the switch is in Settings.
      backgroundThrottling: !state.keepPagesAlive,
      spellcheck: false,
    },
  });
  const contents = view.webContents;
  let failedLoad = false;
  contents.setUserAgent(agentFor(space));
  contents.setWindowOpenHandler(({ url }) => {
    if (spaces.pageAllowed(spaces.accountFor(state, id), url)) return { action: 'allow' };
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!spaces.pageAllowed(spaces.accountFor(state, id), url)) {
      event.preventDefault();
      if (url.startsWith('https://')) shell.openExternal(url);
      pushAlert({ spaceId: id, tag: `blocked:${Date.now()}`, kind: 'blocked', title: `${space.label} blocked a navigation`, body: `This space only stays on ${spaces.hostsFor(space).join(', ') || 'its own site'}. The link was handed to your browser instead.` });
    }
  });
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (!mainFrame || inPlace) return;
    failedLoad = false;
    const monitor = monitorFor(id);
    monitor.browserNote = null; // A refusal note belongs to the page that was loaded, not to the next one.
    const recovering = monitor.status === 'temporarily-unavailable' || monitor.status === 'loading';
    monitor.start(recovering);
    broadcast();
  });
  contents.on('did-finish-load', () => {
    const current = spaces.accountFor(state, id);
    if (failedLoad || !current || !(spaces.pageAllowed(current, contents.getURL()) || (SMOKE && contents.getURL().startsWith('file://')))) return;
    clearTimeout(retryTimers.get(id));
    retryTimers.delete(id);
    const monitor = monitorFor(id);
    // A page that refused the browser is a page that loads perfectly and shows nothing usable, which
    // reads as "Bop is broken". Say what happened on the space card instead of leaving a blank pane.
    monitor.browserNote = spaces.browserRefusal(contents.getURL(), contents.getTitle()) ? BROWSER_REFUSED_NOTE : null;
    monitor.ready(contents.getURL());
    readTitle(id, contents.getTitle()); // Baseline AFTER document load; never alert on historical unread.
    broadcast();
  });
  contents.on('did-navigate-in-page', (_event, url, mainFrame) => {
    if (!mainFrame || !spaces.pageAllowed(spaces.accountFor(state, id), url)) return;
    monitorFor(id).ready(url);
    readTitle(id, contents.getTitle());
    broadcast();
  });
  contents.on('page-title-updated', (_event, title) => readTitle(id, title));
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 is an aborted load, not a failure
    failedLoad = true;
    pushAlert({ spaceId: id, tag: 'load-error', kind: 'error', title: `${space.label} could not load`, body: `Page unavailable (${errorCode}). Bounded retry with backoff; session cookies are retained.` });
    retrySpace(id);
  });
  contents.on('render-process-gone', () => {
    if (!spaceViews.has(id) || app.isQuitting) return;
    pushAlert({ spaceId: id, tag: 'renderer-error', kind: 'error', title: `${space.label} stopped responding`, body: 'Browser renderer stopped. Bounded recovery with backoff; other account sessions are unchanged.' });
    retrySpace(id);
  });
  spaceViews.set(id, view);
  if (shellWindow) shellWindow.contentView.addChildView(view);
  applyViewOrder(); // a dialog that is open must stay above the pane this just added
  return view;
}

let modalOpen = false;

/**
 * Which child view is on top. The dashboard's dialogs are drawn by the dashboard renderer, and that
 * renderer lives *below* the space views — measured with a real mouse on 0.1.4: with a space open, the
 * new-space picker appeared, but every control in it was covered by the space's own pane, so the click
 * went to the page and the picker did nothing. (With a pane that had never navigated, the overlay was
 * not even painted: the dialog looked perfect and was silently deaf.) So while a dialog is up, the
 * dashboard view is raised to the top of the stack, and it goes back underneath when the last dialog
 * closes. The page itself keeps running either way. */
function applyViewOrder() {
  if (!shellWindow || !uiView || shellWindow.isDestroyed() || uiView.webContents.isDestroyed()) return;
  const children = shellWindow.contentView.children;
  if (!children.length) return;
  const dashboardIsTop = children[children.length - 1] === uiView;
  if (modalOpen && !dashboardIsTop) shellWindow.contentView.addChildView(uiView);
  else if (!modalOpen && dashboardIsTop && children.length > 1) shellWindow.contentView.addChildView(uiView, 0);
}

function layout() {
  if (!shellWindow || !uiView) return;
  const [width, height] = shellWindow.getContentSize();
  uiView.setBounds({ x: 0, y: 0, width, height });
  if (typeof uiView.setVisible === 'function') uiView.setVisible(shellWindow.isVisible());
  for (const [id, view] of spaceViews) {
    const open = id === openSpaceId;
    view.setBounds(open
      ? { x: SIDEBAR, y: 0, width: Math.max(width - SIDEBAR, 1), height }
      : { x: -20000, y: -20000, width: Math.max(width - SIDEBAR, 1), height });
    // Tell the view whether it is on screen instead of only moving it out of the way. Chromium answers
    // the Page Visibility API from this, so the site is now told the truth: the pane you are looking at
    // is a visible page, and a space sitting in the background is a background tab — which is the state
    // a chat page notifies from. Without this every space reported `hidden` all the time, and on this
    // Electron build that is also what kept the dashboard itself reporting `hidden`.
    if (typeof view.setVisible === 'function') view.setVisible(open);
  }
}

function createShellWindow() {
  shellWindow = new BaseWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#F7F5FA',
    title: 'Bop',
    autoHideMenuBar: true,
  });
  uiView = new WebContentsView({
    // The dashboard is a real window the user looks at, but Chromium only learns that a WebContents is
    // visible when the embedder says so, and a child view of a BaseWindow is never told: measured on
    // this build, every pane reported `document.visibilityState === 'hidden'` and clamped its timers to
    // about one per second. Disabling background throttling is what makes a pane behave like the window
    // it is drawn in; the pages in it then keep their own rendering and timers at full rate.
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  shellWindow.contentView.addChildView(uiView);
  uiView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  shellWindow.on('resize', layout);
  shellWindow.on('show', layout);
  shellWindow.on('hide', layout);
  shellWindow.on('close', (event) => {
    if (!app.isQuitting && (tray || bubbleWindow)) {
      event.preventDefault();
      saveSettings();
      shellWindow.hide(); // Keep each space's live connection; Quit in the tray really exits.
    }
  });
  applyViewOrder();
  shellWindow.on('closed', () => {
    for (const view of spaceViews.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
    spaceViews.clear();
    for (const timer of retryTimers.values()) clearTimeout(timer);
    retryTimers.clear();
    monitors.clear();
    if (uiView && !uiView.webContents.isDestroyed()) uiView.webContents.close();
    shellWindow = null; uiView = null;
  });
  layout();
  // A sign-in launch shows the tray and the bubble instead. If neither exists there would be no way back
  // to the hub, so the dashboard is shown anyway rather than leaving a running app with no way in.
  if ((!SMOKE && !LIVE_CHECK) && (!LAUNCHED_AT_LOGIN || !(tray || state.bubble))) shellWindow.show();
  if (LIVE_CHECK) shellWindow.show();
}

/**
 * The address a space should be showing, or the reason there is nothing to show.
 *
 * `spaces.openTarget` owns the rule; this only adds the smoke run's one exception, because a fixture
 * page is served from disk and has no address to compare — the page already in the view is the page
 * being asked about. A blank view has no URL, so the "no empty pane" rule below still holds.
 */
function openTargetFor(space) {
  const target = spaces.openTarget(space);
  if (!target.error || !SMOKE) return target;
  const view = spaceViews.get(space.id);
  const url = view && !view.webContents.isDestroyed() ? view.webContents.getURL() : '';
  return url.startsWith('file://') ? { url, error: null } : target;
}

/**
 * Loads a space's page into its own view and returns that view, or null when the space has no page to
 * load. A space with no address never gets a view created for it: an empty pane covers the hub and eats
 * the clicks meant for it, which is the state measured on 0.1.4 (see [spaces.openTarget]).
 */
function loadSpaceInBackground(id) {
  const space = spaces.accountFor(state, id);
  if (!space) return null;
  const target = openTargetFor(space);
  if (target.error) return null;
  const view = spaceView(id);
  if (!view) return null;
  if (!view.webContents.getURL()) {
    state = spaces.rememberLoaded(state, id);
    saveSettings();
    view.webContents.loadURL(target.url).catch(() => {}); // did-fail-load reports the error to Alerts.
  }
  layout();
  return view;
}

/**
 * Opens a space, or explains why it cannot be opened. The dashboard turns a refusal into the Edit dialog
 * for that space, so a broken space is one click away from being fixed instead of an empty pane the user
 * cannot click out of.
 */
function openSpace(id) {
  const space = spaces.accountFor(state, id);
  if (!space) return { ok: false, error: 'That space does not exist any more.' };
  const target = openTargetFor(space);
  if (target.error) {
    // Close whatever pane is open: the user asked for this space, and leaving the previous one on screen
    // under the dialog would read as "it opened the wrong account". A refusal shows the hub instead.
    if (openSpaceId) { openSpaceId = null; layout(); }
    broadcast();
    return { ok: false, error: target.error, needsEdit: true };
  }
  if (!loadSpaceInBackground(id)) return { ok: false, error: 'This space could not be opened.', needsEdit: true };
  if (monitors.get(id)?.status === 'temporarily-unavailable') {
    clearTimeout(retryTimers.get(id)); retryTimers.delete(id);
    monitors.get(id).failures = 0;
    monitors.get(id).start(true);
    spaceViews.get(id).webContents.reload();
  }
  openSpaceId = id;
  layout();
  broadcast();
  return { ok: true };
}

function closeSpace() {
  openSpaceId = null;
  layout();
  broadcast();
}

// ---------------------------------------------------------------------------------------------
// The bubble: frameless, always on top, and parked exactly where the user dropped it.
// ---------------------------------------------------------------------------------------------
function createBubble() {
  if (bubbleWindow) return;
  const display = screen.getPrimaryDisplay();
  const size = bubbleSize();
  const prefs = bubblePrefs();
  bubbleWindow = new BrowserWindow({
    width: size,
    height: size,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    focusable: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  bubbleWindow.setAlwaysOnTop(true, 'floating');
  bubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: prefs.overFullscreen });
  bubbleWindow.setOpacity(prefs.opacity / 100);
  bubbleWindow.loadFile(path.join(__dirname, '..', 'renderer', 'bubble.html'));
  bubbleWindow.once('ready-to-show', () => {
    // The stored spot comes back exactly as it was left, with the screen edge as the only correction.
    const area = display.workArea;
    const restored = docking.restore(prefs.spotX, prefs.spotY, size, area.width, area.height);
    bubbleSpot = docking.free(restored.x, restored.y, size, area.width, area.height);
    applyBubbleSpot();
    bubbleWindow.show();
  });
  // The window itself is the drag surface (-webkit-app-region), so the OS moves it and Bop only has to
  // notice where it ended up. Polling the cursor inside a 56px window would lose the release as soon as
  // the pointer left it; a native drag cannot.
  bubbleWindow.on('move', onBubbleMoved);
  bubbleWindow.on('blur', () => endBubbleDrag(null)); // never leave a drag running for a window that lost the pointer
  bubbleWindow.on('closed', () => { bubbleWindow = null; });
}

function onBubbleMoved() {
  if (!bubbleWindow) return;
  if (drag) return; // the gesture Bop is running owns the position; see [bubbleDragMove]
  if (Date.now() < suppressDockUntil) return; // a move Bop itself caused is not a drag
  const [x, y] = bubbleWindow.getPosition();
  const area = screen.getDisplayNearestPoint({ x, y }).workArea;
  bubbleSpot = { x: x - area.x, y: y - area.y };
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { settleTimer = null; settleBubble(); }, 220);
}

// ---------------------------------------------------------------------------------------------
// Moving the bubble.
//
// The gesture is Bop's own, not Chromium's `-webkit-app-region: drag`. That is what the machine
// measured on 0.1.7 with the operating system's real pointer: a fast drag asked for 260×150 points and
// the bubble arrived 227×131 — 33 points short of the hand that dragged it — and the only part of a
// 64px bubble that could be dragged at all was the ~13px ring around the round button, because the
// button is `no-drag`. A press that looks like a grab therefore lands on the button and opens the menu
// instead of moving the bubble, which is what the user's own screenshot shows.
//
// So the renderer reports the pointer, [bubbleDrag] decides the geometry (and is unit-tested), and the
// window is placed directly: one point in, one point out, no edge behaviour except the screen edge being
// the limit. A press that never travels is still a tap, so clicking is exactly as easy as before.
// ---------------------------------------------------------------------------------------------
let drag = null;
let dragTimer = null;
const DRAG_LIMIT_MS = 30_000;

function bubbleDragStart(point) {
  if (!bubbleWindow || !point) return;
  const [x, y] = bubbleWindow.getPosition();
  drag = bubbleDrag.begin(point, { x, y });
  clearTimeout(dragTimer);
  // A gesture whose end never arrives — a lost pointer, a remote desktop hiccup — must not leave the
  // bubble glued to the cursor for the rest of the session.
  dragTimer = setTimeout(() => endBubbleDrag(null), DRAG_LIMIT_MS);
}

function bubbleDragMove(point) {
  if (!bubbleWindow || !drag || !point) return;
  const step = bubbleDrag.advance(drag, point);
  drag = step.session;
  if (!step.position) return;
  const size = bubbleSize();
  suppressDockUntil = Date.now() + 400; // the move this is about to cause is Bop's own
  bubbleWindow.setBounds({ x: step.position.x, y: step.position.y, width: size, height: size });
}

function endBubbleDrag(point) {
  clearTimeout(dragTimer);
  dragTimer = null;
  const session = drag;
  drag = null;
  if (!bubbleWindow || !session) return;
  const size = bubbleSize();
  const area = workAreaFor();
  const origin = { x: area.x, y: area.y };
  const inArea = (wanted) => {
    const spot = docking.free(wanted.x - area.x, wanted.y - area.y, size, area.width, area.height);
    return { x: area.x + spot.x, y: area.y + spot.y };
  };
  // A tap asks for nothing at all: no re-place, no saved spot, so a click cannot nudge the bubble.
  const settled = bubbleDrag.finish(session, point, origin, inArea);
  if (!settled.dragged) return;
  bubbleSpot = settled.spot;
  applyBubbleSpot();
  rememberBubbleSpot(area);
  saveSettings();
}

/**
 * Release is the only thing that moves the bubble, and it keeps the spot it was dropped in: the free
 * placement maths is already the whole correction, so a drop in the middle of the desktop stays there
 * instead of jumping to an edge.
 *
 * The size check is the one exception. Dragging a frameless window against the top of the screen is an
 * Aero Snap gesture, and a snapped window is no longer a 64px circle — measured on this build, letting
 * go at the top edge maximised it. Taking the frame back is what keeps "the bubble stays where you put
 * it" true on a desktop that would rather tile it.
 */
function settleBubble() {
  if (!bubbleWindow) return;
  const area = workAreaFor();
  const size = bubbleSize();
  const [width, height] = bubbleWindow.getSize();
  const snapped = width !== size || height !== size;
  bubbleSpot = docking.free(bubbleSpot.x, bubbleSpot.y, size, area.width, area.height);
  applyBubbleSpot();
  if (snapped) return; // applyBubbleSpot already put the real size back; nothing to remember yet
  rememberBubbleSpot(area);
  saveSettings();
}

/** The spot is stored as a fraction of the screen, so a resize or a new monitor keeps it in place. */
function rememberBubbleSpot(area) {
  state = spaces.setBubblePref(state, {
    spotX: docking.fraction(bubbleSpot.x, area.width),
    spotY: docking.fraction(bubbleSpot.y, area.height),
  });
}

function applyBubbleSpot() {
  if (!bubbleWindow) return;
  const area = workAreaFor();
  const size = bubbleSize();
  // Free placement on both axes: any spot inside the work area is legal, including flush against any
  // of the four edges, because the bubble is now something the user parks rather than something that
  // pins itself to a side.
  bubbleSpot = docking.free(bubbleSpot.x, bubbleSpot.y, size, area.width, area.height);
  suppressDockUntil = Date.now() + 150;
  bubbleWindow.setBounds({
    x: Math.round(area.x + bubbleSpot.x),
    y: Math.round(area.y + bubbleSpot.y),
    width: size,
    height: size,
  });
}

/** Applies the bubble settings to the live window: opacity, fullscreen behaviour, and a re-place at the
 *  new size so a resize cannot push the bubble half off the screen it was parked on. */
function applyBubblePrefs() {
  if (!bubbleWindow) return;
  const prefs = bubblePrefs();
  bubbleWindow.setOpacity(hovered ? 1 : prefs.opacity / 100);
  bubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: prefs.overFullscreen });
  settleBubble();
}

function workAreaFor() {
  // The window's own position is the only coordinates that mean anything here: `bubbleSpot` is relative
  // to a work area, so asking about it directly looked up the wrong display whenever a monitor sat to
  // the left of the primary one.
  const [x, y] = bubbleWindow && !bubbleWindow.isDestroyed()
    ? bubbleWindow.getPosition()
    : [bubbleSpot.x, bubbleSpot.y];
  return screen.getDisplayNearestPoint({ x, y }).workArea;
}

function destroyBubble() {
  if (menuWindow) { menuWindow.close(); menuWindow = null; }
  if (bubbleWindow) { bubbleWindow.close(); bubbleWindow = null; }
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
  drag = null;
  clearTimeout(dragTimer);
  dragTimer = null;
  hovered = false; // a fresh bubble must not inherit the old one's hover state
}

function openSpaceMenu() {
  if (!bubbleWindow) return;
  if (menuWindow) { menuWindow.close(); menuWindow = null; return; }
  const area = workAreaFor();
  const width = MENU_WIDTH;
  const rows = spaces.enabledSpaces(state);
  // 146 = the card's own chrome (10px margins, 14px padding, header, footer) + 44 per row; the list
  // scrolls, so this is a preferred height rather than a hard one.
  const height = Math.min(146 + rows.length * 44, Math.max(area.height - BUBBLE_MARGIN * 2, 220));
  // Centred on the display, not hung off the bubble. Measured with a bubble in the top-left corner: the
  // anchored panel was clamped against the left edge and its first word was cut off.
  const placed = docking.centered(area.width, area.height, width, height, BUBBLE_MARGIN);
  menuWindow = new BrowserWindow({
    x: Math.round(area.x + placed.x),
    y: Math.round(area.y + placed.y),
    width, height, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    // Transparent so the card can be a rounded panel with its own shadow instead of a raw square of
    // colour — on this Windows build a frameless window gets no rounded corners of its own.
    transparent: true, show: false, hasShadow: false,
    webPreferences: {
      preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false,
      additionalArguments: [`--bop-theme=${resolveTheme()}`],
    },
  });
  menuWindow.setAlwaysOnTop(true, 'floating');
  menuWindow.loadFile(path.join(__dirname, '..', 'renderer', 'menu.html'));
  menuWindow.once('ready-to-show', () => menuWindow && menuWindow.show());
  menuWindow.on('blur', () => { if (menuWindow) { menuWindow.close(); menuWindow = null; } });
  menuWindow.on('closed', () => { menuWindow = null; });
}

// ---------------------------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------------------------
function pushAlert(alert) {
  alerts = spaces.addAlert(alerts, { acknowledged: false, at: Date.now(), ...alert });
  const decision = notifyLog.arrive(notifyLogState, alert);
  notifyLogState = decision.log;
  if (shellWindow) shellWindow.setTitle(`Bop · ${alerts.filter((value) => !value.acknowledged).length} new`);
  broadcast();
  // The card and the OS notification are the two ways the user is actually interrupted; a repeat of the
  // last notification of that space is silent in both. Returns whether this was worth interrupting for,
  // which is what `publishMessage` uses to decide the native notification.
  if (decision.notify) showReminder(alert);
  return decision.notify;
}

// ---------------------------------------------------------------------------------------------
// The reminder card. A native toast would be the obvious surface, but Windows only shows a toast for
// an application that has a Start Menu shortcut carrying its AppUserModelID, and Bop also ships as a
// portable executable that has none — measured on this machine: no shortcut, no per-app notification
// entry, and a toast that never appears. The same silence applies to the space's own page, so a web
// notification reached Alerts and nothing was seen on screen. Bop therefore draws this card itself.
// ---------------------------------------------------------------------------------------------
const POPUP_WIDTH = 336;
const POPUP_HEIGHT = 128;

let reminderWindow = null;
let reminderQueue = popup.empty();
let reminderTimer = null;
let reminderLoaded = false;

/** The bubble's rectangle, so the card can step around it instead of covering it. */
function bubbleRect() {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return null;
  const [width, height] = bubbleWindow.getSize();
  const [x, y] = bubbleWindow.getPosition();
  return { x, y, width, height };
}

function showReminder(alert) {
  if (!state) return;
  reminderQueue = popup.arrive(reminderQueue, alert, Date.now());
  if (!reminderQueue.current) return;
  const area = screen.getPrimaryDisplay().workArea;
  const spot = popup.spot(area, { width: POPUP_WIDTH, height: POPUP_HEIGHT }, bubbleRect());
  if (!reminderWindow) {
    reminderWindow = new BrowserWindow({
      x: spot.x, y: spot.y, width: POPUP_WIDTH, height: POPUP_HEIGHT,
      frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: true, show: false,
      webPreferences: {
        preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false,
        additionalArguments: [`--bop-theme=${resolveTheme()}`],
      },
    });
    reminderWindow.setAlwaysOnTop(true, 'floating');
    reminderWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: bubblePrefs().overFullscreen });
    reminderWindow.loadFile(path.join(__dirname, '..', 'renderer', 'alert.html'));
    reminderLoaded = false;
    reminderWindow.webContents.on('did-finish-load', () => { reminderLoaded = true; deliverReminder(); });
    reminderWindow.on('closed', () => { reminderWindow = null; reminderLoaded = false; });
  } else {
    reminderWindow.setBounds({ x: spot.x, y: spot.y, width: POPUP_WIDTH, height: POPUP_HEIGHT });
    deliverReminder();
  }
  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(hideReminder, popup.POPUP_MS);
}

/** showInactive: a reminder must never take the keyboard focus from what the user is doing. */
function deliverReminder() {
  const card = popup.card(reminderQueue);
  if (!card || !reminderWindow || reminderLoaded === false) return;
  const space = spaces.accountFor(state, card.spaceId);
  reminderWindow.webContents.send('bop:reminder', {
    ...card,
    theme: state.theme,
    accent: space ? spaces.hexColor(space.appId) : null,
    spaceLabel: space ? space.label : null,
  });
  reminderWindow.showInactive();
}

function hideReminder() {
  clearTimeout(reminderTimer);
  reminderTimer = null;
  reminderQueue = popup.dismiss();
  if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.hide();
}

function acknowledgeKey(alertKey) {
  if (typeof alertKey !== 'string' || !alertKey) return;
  alerts = alerts.map((alert) => (`${alert.spaceId}:${alert.tag}` === alertKey ? { ...alert, acknowledged: true } : alert));
  if (shellWindow) shellWindow.setTitle(`Bop · ${alerts.filter((value) => !value.acknowledged).length} new`);
  broadcast();
}

function focusSpace(id) {
  showDashboard(id);
}

/** Bring the hub forward. With an id it opens that space and jumps to Alerts; without one it just
 * shows the bento dashboard, which is what the "open the dashboard" double-click action wants. */
function showDashboard(id) {
  if (!shellWindow) return;
  shellWindow.show();
  shellWindow.focus();
  if (id) {
    openSpace(id);
    uiView.webContents.send('bop:focus-space', id);
  } else {
    closeSpace();
  }
}

/**
 * What a double-click on the bubble does. Configurable because people disagree: the menu is the
 * default, "open the space I was last in" is the fast path, and the dashboard is the calm one.
 */
function bubbleDoubleAction() {
  const choice = bubblePrefs().doubleClick;
  if (choice === 'menu') return openSpaceMenu();
  const first = (spaces.enabledSpaces(state)[0] || {}).id;
  if (choice === 'last-space') return showDashboard(openSpaceId || first || null);
  return showDashboard(null);
}

/** Right-click on the bubble: a native menu, so the common actions need no window at all. */
function openBubbleContextMenu() {
  if (!bubbleWindow) return;
  const enabled = spaces.enabledSpaces(state);
  const template = [
    { label: 'Open Bop', click: () => showDashboard(openSpaceId || (enabled[0] || {}).id || null) },
    { label: 'Space menu', click: () => openSpaceMenu() },
  ];
  if (enabled.length) {
    template.push({ type: 'separator' });
    for (const space of enabled.slice(0, 8)) template.push({ label: `Open ${space.label}`, click: () => focusSpace(space.id) });
  }
  template.push(
    { type: 'separator' },
    { label: 'Check watched pages now', click: () => runWatcher() },
    { type: 'separator' },
    { label: 'Stop the bubble', click: () => { state = { ...state, bubble: false }; destroyBubble(); saveSettings(); broadcast(); } },
  );
  Menu.buildFromTemplate(template).popup({ window: bubbleWindow });
}

// ---------------------------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------------------------
async function readSpace(space) {
  // The page that is actually loaded is what gets read, even when the space has no address of its own
  // (a fixture page a smoke run loaded directly). Only when there is nothing to read does the reason
  // have to be the missing address: "Page is not loaded yet" for a space that has none sent the user
  // looking at a page instead of at the field that is empty.
  const existing = spaceViews.get(space.id);
  const view = loadSpaceInBackground(space.id) || existing;
  if (!view) return { error: openTargetFor(space).error || 'This space could not be loaded.' };
  if (view.webContents.isLoadingMainFrame()) {
    const ready = await new Promise((resolve) => {
      const stopped = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { view.webContents.removeListener('did-stop-loading', stopped); resolve(false); }, 10_000);
      view.webContents.once('did-stop-loading', stopped);
    });
    if (!ready) return { error: 'Page load timed out; no reading was taken.' };
  }
  if (!view.webContents.getURL()) return { error: 'Page is not loaded yet.' };
  const selector = JSON.stringify(space.watch.selector || '');
  const source = `(() => {
    const selector = ${selector};
    let text = '';
    try {
      if (selector) text = Array.from(document.querySelectorAll(selector)).map((node) => node.innerText || node.textContent || '').join(' ').slice(0, 20000);
      if (!text) text = (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 20000);
    } catch (_) { text = ''; }
    return { title: document.title || '', text };
  })();`;
  try {
    const result = await view.webContents.executeJavaScript(source, true);
    return result && typeof result === 'object' ? result : null;
  } catch (failure) {
    return { error: failure && failure.message ? failure.message : 'read failed' };
  }
}

let watcherRunning = false;
let watcherTimer = null;

function scheduleWatcher() {
  const watched = state && state.watchWhileRunning && spaces.enabledSpaces(state).filter(space => space.watch.enabled);
  if (!watched || !watched.length) { clearTimeout(watcherTimer); watcherTimer = null; return; }
  if (watcherTimer || watcherRunning || SMOKE) return;
  const now = Date.now();
  const next = Math.min(...watched.map(space => (space.watch.lastCheckAt || 0) + watcher.intervalMinutes(space.watch) * 60_000));
  watcherTimer = setTimeout(async () => {
    watcherTimer = null;
    try { await readAlertingSpaces(); }
    finally { scheduleWatcher(); }
  }, Math.max(next - now, 1000));
}

async function runWatcher(now = Date.now()) {
  if (watcherRunning) return [];
  watcherRunning = true;
  try {
  const due = watcher.dueSpaces(spaces.enabledSpaces(state), now);
  const results = [];
  for (const space of due) {
    const reading = await readSpace(space);
    const outcome = watcher.apply(space.watch, reading, now);
    state = spaces.setWatch(state, space.id, outcome.watch);
    if (outcome.alert) {
      pushAlert({
        spaceId: space.id,
        tag: `watch:${space.id}`,
        kind: 'watch',
        title: `${space.label} changed`,
        body: outcome.summary,
      });
    }
    results.push({ id: space.id, alert: outcome.alert, failures: outcome.watch.failures });
  }
  if (results.length) { saveSettings(); broadcast(); }
  return results;
  } finally { watcherRunning = false; scheduleWatcher(); }
}

/**
 * Pages loaded while the user is inside Bop, read without a reload. A reload would be destructive on a
 * chat page and pointless on an SPA that already updates itself.
 */
async function readAlertingSpaces() {
  if (!state.watchWhileRunning) return;
  await runWatcher();
}

// ---------------------------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------------------------
function notesWithTombstones(first, second) {
  const byId = new Map();
  for (const note of [...(first || []), ...(second || [])]) {
    const normalized = notesSync.normalizeNote(note);
    if (!normalized) continue;
    const previous = byId.get(normalized.id);
    if (!previous || normalized.deletedAt > previous.deletedAt ||
        (normalized.deletedAt === previous.deletedAt && normalized.timestamp > previous.timestamp)) byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort((left, right) => Math.max(left.timestamp, left.deletedAt) - Math.max(right.timestamp, right.deletedAt) || left.id.localeCompare(right.id)).slice(-notesSync.MAX_MESSAGES);
}

function snapshot() {
  return {
    spaces: state.spaces,
    notes: state.notes,
    notesSync: { enabled: state.notesEnabled, running: !!notesServer, error: notesSyncError,
      token: state.notesToken || '', port: notesSync.PORT, addresses: notesSync.localAddresses(),
      pairingCode: state.notesEnabled ? notesSync.makePairingCode(state.notesToken).code : '',
      lastSyncAt: state.notesLastSyncAt || 0, localDirty: state.notesDirty === true },
    slots: spaces.sortedSlots(state),
    enabled: spaces.enabledSpaces(state).map((space) => ({
      ...space,
      accent: spaces.hexColor(space.appId),
      hosts: spaces.hostsFor(space),
      // Whether Open has a page to show, decided by the same rule the main process uses, so the UI can
      // say "this needs an address" before the user clicks instead of after.
      openable: !spaces.openTarget(space).error,
      openError: spaces.openTarget(space).error,
      pending: spaces.pendingFor(alerts, space.id),
      open: space.id === openSpaceId,
      loaded: spaceViews.has(space.id) && !!spaceViews.get(space.id).webContents.getURL(),
      monitoring: monitors.get(space.id)?.status || 'not-loaded',
      unread: monitors.get(space.id)?.unread ?? null,
      notificationStatus: monitors.get(space.id)?.notificationStatus || null,
      browserNote: monitors.get(space.id)?.browserNote || null,
    })),
    alerts,
    theme: state.theme,
    bubble: state.bubble,
    bubblePrefs: state.bubblePrefs,
    // The bubble's face, ready to be an `img src`: the same data URL the settings file keeps.
    bubbleAvatar: bubblePrefs().avatar || '',
    bubbleSizes: spaces.BUBBLE_SIZES,
    bubbleDoubleClick: spaces.BUBBLE_DOUBLE_CLICK,
    defaultPhoneLayout: spaces.DEFAULT_PHONE_LAYOUT,
    watchWhileRunning: state.watchWhileRunning,
    messageSound: state.messageSound,
    keepPagesAlive: state.keepPagesAlive !== false,
    startAtLogin: state.startAtLogin !== false,
    notesUiEnabled: state.notesEnabled === true,
    notesSyncRunning: !!notesServer,
    autoStart: autoStartInfo(),
    tray: !!tray,
    dashboardVisible: !!(shellWindow && !shellWindow.isDestroyed() && shellWindow.isVisible()),
    startedAtLogin: LAUNCHED_AT_LOGIN,
    packaged: app.isPackaged,
    diskError,
    encryption: safeStorage.isEncryptionAvailable(),
    apps: spaces.APPS.map((app) => ({ ...app, accent: spaces.hexColor(app.id) })),
    versions: {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: `${process.platform} ${process.arch}`,
      os: require('node:os').release(),
      partitionPrefix: PARTITION_PREFIX,
    },
  };
}

function broadcast() {
  scheduleWatcher();
  refreshTray();
  const current = snapshot();
  if (uiView) uiView.webContents.send('bop:changed', current);
  if (menuWindow) menuWindow.webContents.send('bop:changed', current);
  if (bubbleWindow) bubbleWindow.webContents.send('bop:changed', current);
  if (notesWindow && !notesWindow.isDestroyed()) {
    notesWindow.webContents.send('bop:notes-changed');
    notesWindow.webContents.send('bop:notes-settings', snapshot().notesSync);
  }
}

async function setNotesSync(enabled) {
  notesSyncGeneration += 1;
  const generation = notesSyncGeneration;
  const previous = notesServer;
  notesServer = null;
  if (previous) await previous.close();
  if (!enabled) {
    clearTimeout(notesSyncDeadline); notesSyncDeadline = null;
    notesSyncError = null;
    state = { ...state, notesEnabled: false, notesToken: '', notesDirty: false };
  } else {
    const wasEnabled = state.notesEnabled;
    state = { ...state, notesEnabled: true, notesDirty: true,
      notesToken: !wasEnabled || !state.notesToken ? randomBytes(32).toString('hex') : state.notesToken };
    await startNotesServer(generation);
    scheduleNotesSync(0);
  }
  saveSettings();
  broadcast();
  return snapshot().notesSync;
}

function scheduleNotesSync(delay = 10_000) {
  clearTimeout(notesSyncDeadline);
  if (!state?.notesEnabled || app.isQuitting) return;
  notesSyncDeadline = setTimeout(() => { notesSyncDeadline = null; void syncNotesWithPair(generationAtSchedule()); }, delay);
}

function generationAtSchedule() { return notesSyncGeneration; }

async function syncNotesWithPair(generation) {
  if (!state?.notesEnabled || !state.notesToken || generation !== notesSyncGeneration || !notesServer) return;
  const notesBefore = state.notes;
  const dirtyBefore = state.notesDirty === true;
  const operation = notesSyncJob.then(async () => {
    if (!state.notesEnabled || generation !== notesSyncGeneration || !notesServer) return;
    const localNotes = notesWithTombstones(notesBefore, state.noteTombstones || []);
    const result = await notesSync.syncWithDesktop('127.0.0.1', notesSync.PORT, state.notesToken,
      dirtyBefore ? localNotes : []);
    if (generation !== notesSyncGeneration || !state.notesEnabled) return;
    const all = notesWithTombstones(state.noteTombstones || [], notesSync.mergeNotesIncludingDeleted(state.notes, result));
    const merged = all.filter((note) => note.deletedAt <= 0);
    const acknowledged = result.some((note) => dirtyBefore && localNotes.some((local) => local.id === note.id));
    const previousNotes = state.notes;
    const previousTombstones = state.noteTombstones || [];
    const previousDirty = state.notesDirty;
    const previousLastSyncAt = state.notesLastSyncAt;
    state = { ...state, notes: merged, noteTombstones: all.filter((note) => note.deletedAt > 0), notesDirty: !acknowledged, notesLastSyncAt: Date.now() };

    if (!saveSettings()) {
      state = { ...state, notes: previousNotes, noteTombstones: previousTombstones, notesDirty: previousDirty, notesLastSyncAt: previousLastSyncAt };
      throw new Error('Notes could not be persisted; local edits are retained in memory.');
    }
    notesSyncError = state.notesDirty ? 'Waiting for desktop to confirm local note updates.' : null;
    broadcast();
  });
  notesSyncJob = operation.catch(() => {});
  try { await operation; }
  catch (failure) {
    if (generation === notesSyncGeneration && state.notesEnabled) notesSyncError = `LAN sync failed (${failure.message}).`;
  } finally {
    if (generation === notesSyncGeneration && state.notesEnabled) {
      broadcast(); scheduleNotesSync(dirtyBefore ? 5000 : 15_000);
    }
  }
}

async function startNotesServer(generation = notesSyncGeneration) {
  if (!state.notesEnabled || generation !== notesSyncGeneration) return;
  if (notesServer) { const previous = notesServer; notesServer = null; await previous.close(); }
  if (!state.notesEnabled || generation !== notesSyncGeneration) return;
  try {
    const server = notesSync.createServer({ token: state.notesToken,
      getNotes: () => notesWithTombstones(state.notes, state.noteTombstones || []),
      onNotes: (incoming) => {
        const previous = state.notes;
        const previousTombstones = state.noteTombstones || [];
        const previousDirty = state.notesDirty;
        const all = notesWithTombstones(previousTombstones, notesSync.mergeNotesIncludingDeleted(previous, incoming));
        const removed = previous.filter((note) => all.some((item) => item.id === note.id && item.deletedAt > 0));
        const merged = all.filter((note) => note.deletedAt <= 0);
        const hasNewNotes = incoming.some((note) => !previous.some((old) => old.id === note.id) && !previousTombstones.some((old) => old.id === note.id));
        const nextDirty = previousDirty === true || hasNewNotes || removed.length > 0;
        state = { ...state, notes: merged, noteTombstones: all.filter((note) => note.deletedAt > 0), notesDirty: nextDirty };
        if (!saveSettings()) {
          state = { ...state, notes: previous, noteTombstones: previousTombstones, notesDirty: previousDirty };
          notesSyncError = 'Notes could not be saved; received updates were not acknowledged.';
          throw new Error(notesSyncError);
        }
        notesSyncError = null;
        broadcast();
        scheduleNotesSync(250);
      },
    });
    await server.start();
    if (!state.notesEnabled || generation !== notesSyncGeneration) { await server.close(); return; }
    notesServer = server;
    notesSyncError = null;
  } catch (failure) {
    if (generation !== notesSyncGeneration) return;
    notesServer = null;
    notesSyncError = `LAN sync unavailable (${failure.message}).`;
  }
}

function openNotesWindow() {
  if (notesWindow && !notesWindow.isDestroyed()) { notesWindow.show(); notesWindow.focus(); return; }
  notesWindow = new BrowserWindow({ width: 660, height: 760, minWidth: 420, minHeight: 480,
    title: 'Bop · Quick notes', backgroundColor: '#F7F5FA',
    webPreferences: { preload: path.join(__dirname, 'notes-preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, additionalArguments: [`--bop-theme=${resolveTheme()}`] },
  });
  notesWindow.loadFile(path.join(__dirname, '..', 'renderer', 'notes.html'));
  notesWindow.on('closed', () => { notesWindow = null; });
}

function registerIpc() {
  ipcMain.handle('bop:snapshot', () => snapshot());
  ipcMain.handle('bop:notes-snapshot', () => ({ notes: state.notes, notesSync: snapshot().notesSync, theme: resolveTheme() }));
  ipcMain.handle('bop:notes-paste-image', async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return { ok: false, error: 'No image was found on the clipboard.' };
    const size = image.getSize();
    const resized = size.width > 1280 || size.height > 1280
      ? image.resize({ width: Math.min(1280, size.width), height: Math.min(1280, size.height), quality: 'good' }) : image;
    const bytes = resized.toJPEG(82);
    if (bytes.length > notesSync.MAX_IMAGE_BYTES) return { ok: false, error: 'Clipboard image is over 500 KB; choose a smaller image.' };
    return { ok: true, image: bytes.toString('base64'), mime: 'image/jpeg' };
  });
  ipcMain.handle('bop:notes-copy-pairing', async () => {
    if (!state.notesEnabled || !state.notesToken) return { ok: false, error: 'Start LAN sync before pairing.' };
    const pairing = notesSync.makePairingCode(state.notesToken);
    if (!pairing.code) return { ok: false, error: 'No private Wi‑Fi address is available.' };
    clipboard.writeText(pairing.code);
    return { ok: true, addresses: pairing.addresses, port: pairing.port };
  });
  ipcMain.handle('bop:notes-delete', (_event, id) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid note.' };
    const note = state.notes.find((item) => item.id === id);
    if (!note) return { ok: false, error: 'That note no longer exists.' };
    const deletedAt = Date.now();
    const previous = state.notes;
    const previousTombstones = state.noteTombstones || [];
    const tombstone = notesSync.normalizeNote({ ...note, text: '', image: '', mime: '', deletedAt });
    const previousDirty = state.notesDirty;
    state = { ...state, notes: state.notes.filter((item) => item.id !== id),
      noteTombstones: notesWithTombstones(previousTombstones, [tombstone]), notesDirty: true };
    if (!saveSettings()) { state = { ...state, notes: previous, noteTombstones: previousTombstones, notesDirty: previousDirty }; return { ok: false, error: 'Could not save deletion; the note was kept.' }; }

    broadcast(); scheduleNotesSync(0);
    return { ok: true };
  });
  ipcMain.handle('bop:notes-add', (_event, value) => {
    if (!value || typeof value !== 'object' || (value.text != null && typeof value.text !== 'string') ||
        (value.image != null && typeof value.image !== 'string') || (value.mime != null && typeof value.mime !== 'string')) {
      return { ok: false, error: 'That note is not valid.' };
    }
    const note = notesSync.normalizeNote({ ...value, id: randomUUID(), sender: 'Desktop', timestamp: Date.now() });
    if (!note) return { ok: false, error: 'Add some text or a supported image first.' };
    const previous = state.notes;
    const previousTombstones = state.noteTombstones || [];
    const previousDirty = state.notesDirty;
    state = { ...state, notes: notesSync.mergeNotes(state.notes, [note]), noteTombstones: previousTombstones.filter((item) => item.id !== note.id), notesDirty: true };
    if (!saveSettings()) { state = { ...state, notes: previous, noteTombstones: previousTombstones, notesDirty: previousDirty }; return { ok: false, error: 'Could not save this note. Remove older images and try again.' }; }
    broadcast(); scheduleNotesSync(0); return { ok: true, note };
  });
  ipcMain.handle('bop:notes-enable', async (_event, enabled) => {
    const result = await setNotesSync(enabled === true);
    return { ok: !notesSyncError, error: notesSyncError, status: result };
  });
  ipcMain.on('bop:notes-changed', (_event) => { if (notesWindow && !notesWindow.isDestroyed()) notesWindow.webContents.send('bop:notes-changed'); });
  ipcMain.handle('bop:notes-settings-enable', async (_event, enabled) => {
    const status = await setNotesSync(enabled === true);
    return { ok: !notesSyncError, status, error: notesSyncError };
  });
  ipcMain.on('bop:open-notes', () => openNotesWindow());
  ipcMain.handle('bop:notes-open', () => { openNotesWindow(); return { ok: true }; });

  ipcMain.handle('bop:add-space', (_event, request) => {
    const id = spaces.nextFree(state);
    if (!id) return { ok: false, error: 'No space name is available.' };
    state = spaces.enableSlot(state, id, {
      appId: request && request.appId,
      kind: request && request.kind,
      url: request && request.url,
      label: request && request.label,
    });
    saveSettings();
    broadcast();
    return { ok: true, id };
  });

  ipcMain.handle('bop:remove-space', (_event, id) => {
    const next = spaces.disableSlot(state, id);
    if (next.slots.includes(id)) return { ok: false, error: 'Keep the two base spaces; stop monitoring instead.' };
    stopSpace(id, true);
    state = { ...next, monitorState: state.monitorState };
    alerts = alerts.filter(alert => alert.spaceId !== id);
    saveSettings();
    layout();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('bop:rename', (_event, id, label) => { state = spaces.rename(state, id, label); saveSettings(); broadcast(); return { ok: true }; });
  ipcMain.handle('bop:select-app', (_event, id, appId, kind) => {
    const previous = spaces.accountFor(state, id);
    state = spaces.selectApp(state, id, appId, { kind });
    if (previous && previous.appId !== state.spaces.find(space => space.id === id)?.appId) {
      stopSpace(id, true);
      alerts = alerts.filter(alert => alert.spaceId !== id);
    }
    saveSettings();
    broadcast();
    return { ok: true, space: spaces.accountFor(state, id) };
  });
  ipcMain.handle('bop:set-url', (_event, id, url) => {
    const previous = spaces.accountFor(state, id);
    state = spaces.setUrl(state, id, url);
    if (previous?.appId === 'custom' && previous.url !== spaces.accountFor(state, id)?.url) {
      stopSpace(id, true);
      alerts = alerts.filter(alert => alert.spaceId !== id);
    }
    saveSettings(); layout(); broadcast(); return { ok: true };
  });
  ipcMain.handle('bop:set-watch', (_event, id, patch) => { state = spaces.setWatch(state, id, patch); saveSettings(); broadcast(); return { ok: true, space: spaces.accountFor(state, id) }; });
  ipcMain.handle('bop:set-phone-layout', (_event, id, on) => {
    state = spaces.setPhoneLayout(state, id, on === true);
    saveSettings();
    applyLayoutMode(id);
    // The layout is picked while the page is being served, so the switch only takes effect on a reload.
    const view = spaceViews.get(id);
    if (view) view.webContents.reload();
    broadcast();
    return { ok: true, space: spaces.accountFor(state, id) };
  });
  ipcMain.handle('bop:set-preference', async (_event, key, value) => {
    if (key === 'theme' && ['system', 'light', 'dark'].includes(value)) state = { ...state, theme: value };
    if (key === 'notesSync') {
      const status = await setNotesSync(value === true);
      return { ok: !notesSyncError, status, error: notesSyncError };
    }
    if (key === 'watchWhileRunning') state = { ...state, watchWhileRunning: value === true };
    if (key === 'messageSound') state = { ...state, messageSound: value === true };
    if (key === 'bubble') { setBubbleRunning(value === true); return { ok: true }; }
    if (key === 'startAtLogin') { setStartAtLogin(value === true); return { ok: true }; }
    if (key === 'keepPagesAlive') {
      const next = value === true;
      if (next !== (state.keepPagesAlive !== false)) {
        state = { ...state, keepPagesAlive: next };
        // Throttling is fixed when a webContents is created, so a live space has to be rebuilt to change
        // it. Sessions, cookies and watch fingerprints are untouched; each space simply reloads.
        const live = [...spaceViews.keys()].filter((id) => (state.loadedSlots || []).includes(id));
        for (const id of live) stopSpace(id);
        for (const id of live) loadSpaceInBackground(id);
      }
    }
    saveSettings();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('bop:set-bubble', (_event, patch) => {
    state = spaces.setBubblePref(state, patch || {});
    saveSettings();
    applyBubblePrefs();
    broadcast();
    return { ok: true, bubblePrefs: state.bubblePrefs };
  });

  // The bubble's picture. The dialog is the only picker; the file is decoded and bounded here, and only
  // the small result is stored — see [avatar.js] for why it is a data URL and not a path.
  ipcMain.handle('bop:choose-bubble-avatar', async () => {
    const picked = await dialog.showOpenDialog(shellWindow && !shellWindow.isDestroyed() ? shellWindow : null, {
      title: 'Picture for the bubble',
      buttonLabel: 'Use this picture',
      properties: ['openFile'],
      filters: [
        { name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true };
    const result = avatar.avatarFromFile(picked.filePaths[0], nativeImage);
    if (result.error) return { ok: false, error: result.error };
    state = spaces.setBubblePref(state, { avatar: result.dataUrl });
    saveSettings();
    broadcast();
    return { ok: true, pixels: result.pixels, length: result.dataUrl.length };
  });
  ipcMain.handle('bop:clear-bubble-avatar', () => {
    state = spaces.setBubblePref(state, { avatar: '' });
    saveSettings();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('bop:open-space', (_event, id) => openSpace(id));
  ipcMain.handle('bop:close-space', () => { closeSpace(); return { ok: true }; });
  ipcMain.handle('bop:reload-space', (_event, id) => {
    // Reloading must not *create* a pane: a space with no address would get an empty view that covers
    // the hub, which is the state this build removed.
    const view = spaceViews.get(id);
    if (view && view.webContents.getURL()) view.webContents.reload();
    return { ok: true };
  });
  ipcMain.handle('bop:load-space', (_event, id) => {
    const space = spaces.accountFor(state, id);
    if (!space) return { ok: false, error: 'This space no longer exists.' };
    const result = openSpace(id);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });

  ipcMain.handle('bop:stop-space', (_event, id) => {
    stopSpace(id);
    state = spaces.setWatch(state, id, { enabled: false });
    saveSettings(); layout(); broadcast();
    return { ok: true };
  });

  ipcMain.handle('bop:clear-space', async (_event, id) => {
    stopSpace(id, true);
    state = spaces.setWatch(state, id, { enabled: false });
    alerts = alerts.filter(alert => alert.spaceId !== id);
    const target = session.fromPartition(`${PARTITION_PREFIX}${id.toLowerCase()}`);
    await target.clearStorageData();
    await target.clearCache();
    saveSettings(); layout(); broadcast();
    return { ok: true };
  });

  ipcMain.handle('bop:check-now', async () => {
    const results = await runWatcher();
    return { ok: true, results };
  });

  ipcMain.handle('bop:ack', (_event, alertKey) => { acknowledgeKey(alertKey); return { ok: true }; });
  ipcMain.handle('bop:ack-all', (_event, id) => {
    alerts = alerts.map((alert) => (!id || alert.spaceId === id ? { ...alert, acknowledged: true } : alert));
    broadcast();
    return { ok: true };
  });
  ipcMain.handle('bop:clear-alerts', () => { alerts = []; broadcast(); return { ok: true }; });
  ipcMain.handle('bop:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
    return { ok: true };
  });

  // A click on the reminder card opens the account it names and counts that alert as seen; × only
  // hides the card, so the alert stays unread in the list.
  ipcMain.on('bop:reminder-open', (_event, payload) => {
    const id = payload && payload.spaceId;
    acknowledgeKey(payload && payload.key);
    hideReminder();
    if (typeof id === 'string' && spaces.accountFor(state, id)) focusSpace(id);
  });
  ipcMain.on('bop:reminder-hide', () => hideReminder());

  // A dialog is up in the dashboard: keep the dashboard view above the space panes while it is, so the
  // dialog is not just visible but clickable (see [applyViewOrder]).
  ipcMain.on('bop:modal', (_event, open) => {
    modalOpen = open === true;
    applyViewOrder();
  });

  // Bubble and menu windows
  ipcMain.on('bop:bubble-click', () => openSpaceMenu());
  ipcMain.on('bop:bubble-double', () => bubbleDoubleAction());
  ipcMain.on('bop:bubble-menu', () => openBubbleContextMenu());
  // The drag itself: the bubble reports the pointer, main places the window. See [bubbleDragStart].
  ipcMain.on('bop:bubble-drag-start', (_event, point) => bubbleDragStart(point));
  ipcMain.on('bop:bubble-drag-move', (_event, point) => bubbleDragMove(point));
  ipcMain.on('bop:bubble-drag-end', (_event, point) => endBubbleDrag(point));
  ipcMain.on('bop:bubble-hover', (_event, on) => {
    hovered = on === true;
    if (!bubbleWindow) return;
    // A translucent bubble comes back to full strength under the cursor, so it stays easy to hit.
    bubbleWindow.setOpacity(hovered ? 1 : bubblePrefs().opacity / 100);
  });
  ipcMain.on('bop:bubble-stop', () => {
    state = { ...state, bubble: false };
    destroyBubble();
    saveSettings();
    broadcast();
  });
  ipcMain.on('bop:menu-open-space', (_event, id) => { if (menuWindow) { menuWindow.close(); menuWindow = null; } focusSpace(id); });
  ipcMain.on('bop:menu-close', () => { if (menuWindow) { menuWindow.close(); menuWindow = null; } });
  ipcMain.on('bop:web-notification', (event, payload) => {
    if (event.senderFrame !== event.sender.mainFrame) return;
    const owner = [...spaceViews.entries()].find(([, view]) => view.webContents.id === event.sender.id);
    if (!owner) return;
    const space = spaces.accountFor(state, owner[0]);
    if (!space || !(spaces.pageAllowed(space, event.sender.getURL()) || (SMOKE && event.sender.getURL().startsWith('file://')))) return;
    const alert = spaces.webAlert(space, payload);
    if (alert && monitorFor(space.id).website(payload)) publishMessage(space, alert);
  });
}

// ---------------------------------------------------------------------------------------------
// Starting with the computer
// ---------------------------------------------------------------------------------------------
let autoStartRegistered = false;

/**
 * Applies the preference to the operating system. Only a packaged copy registers anything: a development
 * run would otherwise add an entry that launches a bare Electron with no app at every sign-in.
 */
function applyAutoStart() {
  const wanted = !state || state.startAtLogin !== false;
  const item = autostart.loginItem({
    execPath: process.execPath,
    portableExe: process.env.PORTABLE_EXECUTABLE_FILE,
    packaged: app.isPackaged,
  });
  if (!item) {
    autoStartRegistered = false;
    autoStartError = app.isPackaged ? null : 'A development run never registers a start-up entry; the packaged app does.';
    return;
  }
  try {
    app.setLoginItemSettings({ openAtLogin: wanted, path: item.path, args: item.args });
    // Read back rather than assume: the OS is the source of truth, and a locked-down machine can refuse.
    autoStartRegistered = app.getLoginItemSettings({ path: item.path, args: item.args }).openAtLogin === true;
    autoStartError = wanted && !autoStartRegistered ? 'Windows did not accept the start-up entry.' : null;
  } catch (failure) {
    autoStartRegistered = false;
    autoStartError = `The start-up entry could not be written (${failure.message}).`;
  }
}

function setStartAtLogin(on) {
  state = { ...state, startAtLogin: on === true };
  applyAutoStart();
  saveSettings();
  broadcast();
}

function autoStartInfo() {
  return {
    wanted: !state || state.startAtLogin !== false,
    supported: app.isPackaged, // A development run must not register the Electron binary itself.
    registered: autoStartRegistered,
    portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
    error: autoStartError,
  };
}

// ---------------------------------------------------------------------------------------------
// Tray and lifecycle
// ---------------------------------------------------------------------------------------------
function bubbleRunning() {
  return !!(bubbleWindow && !bubbleWindow.isDestroyed());
}

/** One place that turns the bubble on and off, so the tray, the menu and Settings cannot disagree. */
function setBubbleRunning(on) {
  state = { ...state, bubble: on === true };
  if (state.bubble) createBubble(); else destroyBubble();
  saveSettings();
  broadcast();
}

/**
 * A left-click on the tray icon: the hub when it is not in front, put away when it is. That is the
 * "open it and hide it again" pair the tray exists for.
 */
function toggleDashboard() {
  if (!shellWindow) { createShellWindow(); return; }
  if (shellWindow.isVisible() && shellWindow.isFocused()) {
    shellWindow.hide();
    saveSettings();
    return;
  }
  showDashboard(openSpaceId);
}

function trayTemplate() {
  const enabled = spaces.enabledSpaces(state);
  const unread = alerts.filter((alert) => !alert.acknowledged).length;
  const auto = autoStartInfo();
  const template = [
    { label: 'Open Bop', click: () => showDashboard(openSpaceId || (enabled[0] || {}).id || null) },
    { label: unread ? `${unread} new alert${unread === 1 ? '' : 's'}` : 'No new alerts', enabled: false },
    { type: 'separator' },
    { label: bubbleRunning() ? 'Hide the bubble' : 'Show the bubble', click: () => setBubbleRunning(!bubbleRunning()) },
    { label: 'Hide the dashboard', click: () => { if (shellWindow) { shellWindow.hide(); saveSettings(); } } },
    { label: 'Check watched pages now', click: () => runWatcher() },
  ];
  if (enabled.length) {
    template.push({ type: 'separator' });
    for (const space of enabled.slice(0, 8)) template.push({ label: `Open ${space.label}`, click: () => focusSpace(space.id) });
  }
  template.push(
    { type: 'separator' },
    {
      label: auto.supported ? 'Start Bop when I sign in' : 'Start Bop when I sign in (installed app only)',
      type: 'checkbox',
      checked: auto.supported ? auto.registered : false,
      enabled: auto.supported,
      click: (item) => setStartAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  );
  return template;
}

/**
 * Rebuilds the tray menu when something it shows has changed. The menu carries the unread count and the
 * "start at sign-in" tick, so a menu built once at launch would quietly go stale — which is what the old
 * frozen "N new alerts" line did.
 */
function refreshTray() {
  if (!tray) return;
  const auto = autoStartInfo();
  const signature = [
    bubbleRunning(),
    alerts.filter((alert) => !alert.acknowledged).length,
    auto.registered, auto.wanted, auto.supported,
    spaces.enabledSpaces(state).map((space) => `${space.id}:${space.label}`).join(','),
  ].join('|');
  if (signature === traySignature) return;
  traySignature = signature;
  tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
  tray.setToolTip(spaces.enabledSpaces(state).length ? `Bop · ${spaces.enabledSpaces(state).length} spaces` : 'Bop');
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'bop.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Bop');
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
    traySignature = null;
    refreshTray();
    tray.on('click', () => toggleDashboard());
    tray.on('double-click', () => showDashboard(openSpaceId));
  } catch (_) {
    tray = null; // A tray is a convenience, never a reason to fail to start.
  }
}

async function smokeRun() {
  const steps = SMOKE_STEPS;
  const record = (name, detail) => { steps.push({ name, detail }); process.stdout.write(`smoke step ${name}: ${detail}\n`); };

  // 0. The app can read its own files. Inside a packaged build these live in `app.asar`, which is the
  //    first thing that breaks when packaging goes wrong — and a silently empty tray icon is the usual
  //    symptom, so this asserts on the very image the tray is built from.
  const iconPath = path.join(__dirname, '..', 'renderer', 'bop.png');
  const icon = nativeImage.createFromPath(iconPath);
  const ownFiles = [
    path.join(__dirname, 'main.js'),
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, 'space-preload.js'),
    // The bubble's own files, because a feature that ships half of itself is exactly what this step is
    // for: the drag lives in bubble-drag.js, the face in avatar.js and bubble.css, and the gesture in
    // bubble.js.
    path.join(__dirname, 'bubble-drag.js'),
    path.join(__dirname, 'avatar.js'),
    path.join(__dirname, '..', 'renderer', 'index.html'),
    path.join(__dirname, '..', 'renderer', 'app.js'),
    path.join(__dirname, '..', 'renderer', 'bubble.html'),
    path.join(__dirname, '..', 'renderer', 'bubble.js'),
    path.join(__dirname, '..', 'renderer', 'bubble.css'),
    path.join(__dirname, '..', 'renderer', 'bop.png'),
  ];
  const missingFiles = ownFiles.filter((file) => !fs.existsSync(file)).map((file) => path.relative(path.join(__dirname, '..'), file));
  record('packaged-files', JSON.stringify({ packaged: app.isPackaged, iconEmpty: icon.isEmpty(), icon: icon.getSize(), missingFiles }));
  if (icon.isEmpty()) throw new Error(`the tray icon did not load from ${iconPath} (packaging problem)`);
  if (missingFiles.length) throw new Error(`the packaged app is missing ${missingFiles.join(', ')}`);
  const notesFiles = ['notes-sync.js', 'notes-preload.js'].map((name) => path.join(__dirname, name))
    .concat(['notes.html', 'notes.js'].map((name) => path.join(__dirname, '..', 'renderer', name)));
  const missingNotesFiles = notesFiles.filter((file) => !fs.existsSync(file)).map((file) => path.relative(path.join(__dirname, '..'), file));
  if (missingNotesFiles.length) throw new Error(`the notes feature is missing from the package: ${missingNotesFiles.join(', ')}`);
  const notesToken = randomBytes(32).toString('hex');
  const noteRead = notesSync.normalizeNote({ id: 'android-note-1', text: 'encrypted LAN round trip', sender: 'Android', timestamp: 1 });
  let syncedNotes = [];
  const notesServer = notesSync.createServer({ token: notesToken, port: 0, host: '127.0.0.1',
    getNotes: () => syncedNotes, onNotes: (incoming) => { syncedNotes = incoming; } });
  const address = await notesServer.start();
  try {
    const merged = await notesSync.syncWithDesktop('127.0.0.1', address.port, notesToken, [noteRead]);
    record('linked-notes-sync', JSON.stringify({ count: merged.length, sender: merged[0]?.sender }));
    if (merged.length !== 1 || merged[0].sender !== 'Android') throw new Error('the Android-compatible encrypted notes client did not complete its LAN round trip');
    const deleted = notesSync.normalizeNote({ ...noteRead, text: '', deletedAt: Date.now() });
    const afterDelete = await notesSync.syncWithDesktop('127.0.0.1', address.port, notesToken, [deleted]);
    if (afterDelete.length !== 0 || syncedNotes.length !== 0) throw new Error('a note deleted on a paired device was not removed from the desktop');
  } finally { await notesServer.close(); }

  // 0b. A fresh profile starts with the bubble running, keeps its pages alive, and asks the machine to
  //     launch Bop at sign-in — the three things that have to be true before the first message arrives.
  const fresh = spaces.defaultState();
  const installedPlan = autostart.loginItem({ execPath: 'C:/app/Bop.exe', portableExe: null, packaged: true });
  const portablePlan = autostart.loginItem({ execPath: 'C:/Users/me/AppData/Local/Temp/xyz/Bop.exe', portableExe: 'C:/Users/me/OneDrive/Desktop/Bop-portable.exe', packaged: true });
  const devPlan = autostart.loginItem({ execPath: 'C:/dev/node_modules/electron/dist/electron.exe', portableExe: null, packaged: false });
  record('defaults', JSON.stringify({ bubble: fresh.bubble, startAtLogin: fresh.startAtLogin, keepPagesAlive: fresh.keepPagesAlive, installedPlan, portablePlan, devPlan }));
  if (fresh.bubble !== true) throw new Error('a fresh profile must start with the bubble running');
  if (fresh.startAtLogin !== true) throw new Error('a fresh profile must ask to start with the machine');
  if (fresh.keepPagesAlive !== true) throw new Error('a fresh profile must keep its pages alive');
  if (!installedPlan || installedPlan.path !== 'C:/app/Bop.exe' || installedPlan.args.length !== 1) throw new Error('an installed build must register its own executable');
  if (!portablePlan || portablePlan.path !== 'C:/Users/me/OneDrive/Desktop/Bop-portable.exe') throw new Error('a portable build must register the file the user launched, never the temp copy');
  if (devPlan !== null) throw new Error('a development run must never register electron.exe to start with the machine');
  const storedBubble = spaces.normalize({ version: spaces.STATE_VERSION, bubble: false, startAtLogin: false, keepPagesAlive: false });
  if (storedBubble.bubble !== false || storedBubble.startAtLogin !== false || storedBubble.keepPagesAlive !== false) throw new Error('a choice the user made must survive a relaunch');
  const upgraded = spaces.normalize({ version: 2, bubble: false });
  if (upgraded.bubble !== true) throw new Error('a profile from before the bubble default cannot tell "never started" from "stopped"; it must switch the bubble on once');

  // 0c. The tray is the way back to a hidden dashboard, so this build has to have one.
  record('tray', JSON.stringify({ tray: !!tray, packaged: app.isPackaged }));
  if (!tray) throw new Error('the tray icon is missing: a sign-in launch with no tray has no way in');

  // 0d. "Start with the machine" must not write anything on a machine that is only running the source.
  record('autostart', JSON.stringify({ ...autoStartInfo(), executable: app.isPackaged ? 'app' : 'development' }));
  if (app.isPackaged && !autoStartInfo().supported) throw new Error('a packaged build must be able to register a start-up entry');
  if (!app.isPackaged && autoStartInfo().registered) throw new Error('a development run registered itself: that would launch a bare Electron at sign-in');

  // 1. Spaces exist, are isolated, and the model round-trips through real persistence.
  const first = spaces.enabledSpaces(state);
  record('spaces', first.map((space) => `${space.id}:${space.label}:${space.appId}`).join(' '));

  const sessionA = sessionFor('A');
  const sessionB = sessionFor('B');
  await sessionA.cookies.set({ url: 'https://example.com', name: 'bop-isolation', value: 'space-a' });
  const leakedIntoB = await sessionB.cookies.get({ name: 'bop-isolation' });
  const presentInA = await sessionA.cookies.get({ name: 'bop-isolation' });
  record('cookie-isolation', `A=${presentInA.length} B=${leakedIntoB.length} separate=${sessionA !== sessionB}`);
  if (presentInA.length !== 1 || leakedIntoB.length !== 0) throw new Error('sessions are not isolated');

  // 2. A watched page really reports a change, through a real page, on a real timer.
  const watchId = 'C';
  state = spaces.enableSlot(state, watchId, { appId: 'custom', kind: 'tasks', label: 'Watch test' });
  const watchView = spaceView(watchId);
  const pagePath = path.join(SMOKE_OUT, 'watch.html');
  const secondPath = path.join(SMOKE_OUT, 'watch-changed.html');
  fs.mkdirSync(SMOKE_OUT, { recursive: true });
  fs.writeFileSync(pagePath, '<!doctype html><title>Studies</title><body><div id="list">1 study available</div></body>');
  fs.writeFileSync(secondPath, '<!doctype html><title>Studies</title><body><div id="list">3 studies available</div></body>');
  state = spaces.setWatch(state, watchId, { enabled: true, minutes: 1, selector: '#list' });
  await watchView.webContents.loadFile(pagePath);
  const beforeAnyRead = spaces.accountFor(state, watchId).watch.fingerprint;
  const baseline = await runWatcher(Date.now());
  const afterFirstRead = spaces.accountFor(state, watchId).watch.fingerprint;
  // Force the schedule open so the unchanged page really is read a second time, rather than the
  // scheduler simply finding nothing due — otherwise "no alert" would prove nothing.
  state = spaces.setWatch(state, watchId, { lastCheckAt: 0 });
  const quiet = await runWatcher(Date.now());
  record('fingerprints', JSON.stringify({ beforeAnyRead, afterFirstRead, afterSecondRead: spaces.accountFor(state, watchId).watch.fingerprint, baseline, quiet }));
  await watchView.webContents.loadFile(secondPath);
  state = spaces.setWatch(state, watchId, { lastCheckAt: 0 });
  const afterChange = await runWatcher(Date.now());
  record('watcher', JSON.stringify({ baseline, quiet, afterChange }));
  if (baseline[0]?.alert !== false || quiet[0]?.alert !== false) throw new Error('an unchanged page raised a card');
  if (afterChange[0]?.alert !== true) throw new Error('a changed page did not raise a card');
  const watchAlerts = alerts.filter((alert) => alert.spaceId === watchId && alert.kind === 'watch');
  if (watchAlerts.length !== 1) throw new Error(`expected exactly one watch alert, got ${watchAlerts.length}`);
  if (watchAlerts[0].body !== '3 studies available') throw new Error(`unexpected body: ${watchAlerts[0].body}`);

  // 2b. A phrase filter turns a noisy board into "only tell me when a study really is available".
  const filteredPath = path.join(SMOKE_OUT, 'watch-filtered.html');
  const availablePath = path.join(SMOKE_OUT, 'watch-available.html');
  fs.writeFileSync(filteredPath, '<!doctype html><title>Studies</title><body><div id="list">3 studies open</div></body>');
  fs.writeFileSync(availablePath, '<!doctype html><title>Studies</title><body><div id="list">5 studies available</div></body>');
  state = spaces.setWatch(state, watchId, { require: 'available', lastCheckAt: 0 });
  await watchView.webContents.loadFile(filteredPath);
  const filtered = await runWatcher(Date.now());
  if (filtered[0]?.alert !== false) throw new Error('a change that failed the phrase filter still raised a card');
  state = spaces.setWatch(state, watchId, { lastCheckAt: 0 });
  await watchView.webContents.loadFile(availablePath);
  const available = await runWatcher(Date.now());
  if (available[0]?.alert !== true) throw new Error('a change that matched the phrase filter did not raise a card');
  const filteredAlerts = alerts.filter((alert) => alert.spaceId === watchId && alert.kind === 'watch');
  record('watcher-filter', JSON.stringify({ filtered, available, body: filteredAlerts[0]?.body }));
  if (filteredAlerts[0].body !== '5 studies available') throw new Error(`unexpected filtered body: ${filteredAlerts[0].body}`);
  state = spaces.setWatch(state, watchId, { require: '', lastCheckAt: 0 });

  // 3. A page's own Notification reaches Bop's alert list, which is the whole desktop advantage.
  const notifyPath = path.join(SMOKE_OUT, 'notify.html');
  fs.writeFileSync(notifyPath, `<!doctype html><title>Notify</title><body><script>
    document.title = 'Ready';
    setTimeout(() => { new Notification('New study', { body: 'Prolific · 2 places left', tag: 'study-1' }) }, 50);
  </script></body>`);
  await watchView.webContents.loadFile(notifyPath);
  // Hidden Chromium pages now retain normal throttling: wait for the real event rather than assuming
  // a website's 50ms timer runs within 900ms off-screen. Still fail if no alert arrives in 8 seconds.
  const notificationDeadline = Date.now() + 8000;
  while (!alerts.some(alert => alert.spaceId === watchId && alert.kind === 'web') && Date.now() < notificationDeadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const webAlerts = alerts.filter((alert) => alert.spaceId === watchId && alert.kind === 'web');
  record('web-notification', JSON.stringify(webAlerts.map((alert) => alert.title)));
  if (webAlerts.length !== 1) throw new Error(`expected one captured web notification, got ${webAlerts.length}`);
  if (!webAlerts[0].title.includes('New study')) throw new Error(`unexpected web alert title: ${webAlerts[0].title}`);

  // 3a. The same notification again is not a second notification. Reported: "once it has notified me, if
  //     it is still exactly the same it must not notify again — only notify when there is something
  //     new." The fixture page is loaded again, so the site really raises the identical notification a
  //     second time, with its own event id — the monitor cannot hide it, the wording rule has to. The
  //     alert list still records it; what must not happen again is the interruption, which is measured on
  //     the same counters the notification path itself increments.
  const webNow = () => alerts.find((alert) => alert.spaceId === watchId && alert.kind === 'web');
  const firstAt = webNow().at;
  const attemptsBefore = notificationAttempts;
  const queueBefore = reminderQueue.count;
  await watchView.webContents.loadFile(notifyPath);
  const repeatDeadline = Date.now() + 8000;
  const arrivedAgain = () => { const now = webNow(); return !!now && now.at > firstAt; };
  while (!arrivedAgain() && Date.now() < repeatDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
  record('notification-repeat-silent', JSON.stringify({
    arrivedAgain: arrivedAgain(), attemptsBefore, attemptsAfter: notificationAttempts,
    cardBefore: queueBefore, cardAfter: reminderQueue.count, title: webNow() && webNow().title,
  }));
  if (!arrivedAgain()) throw new Error('the repeated notification never reached Bop, so nothing was proven');
  if (notificationAttempts !== attemptsBefore) throw new Error('an unchanged notification was shown on the desktop a second time');
  if (reminderQueue.count !== queueBefore) throw new Error('an unchanged notification drew the card a second time');

  // 3a2. A *different* message from the same page is news: it must notify and card as usual, so the rule
  //      above cannot quietly turn into "never notify twice from one space".
  const changedPath = path.join(SMOKE_OUT, 'notify-changed.html');
  fs.writeFileSync(changedPath, `<!doctype html><title>Notify 2</title><body><script>
    setTimeout(() => { new Notification('New study', { body: 'Prolific · 5 places left', tag: 'study-1' }) }, 50);
  </script></body>`);
  await watchView.webContents.loadFile(changedPath);
  const changedDeadline = Date.now() + 8000;
  const changedArrived = () => (notificationAttempts > attemptsBefore || reminderQueue.count > queueBefore);
  while (!changedArrived() && Date.now() < changedDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
  record('notification-changed-notifies', JSON.stringify({
    attempts: notificationAttempts, card: reminderQueue.count, title: webNow() && webNow().title, body: webNow() && webNow().body,
  }));
  if (notificationAttempts !== attemptsBefore + 1) throw new Error('a changed message was swallowed as a repeat');
  if (reminderQueue.count !== queueBefore + 1) throw new Error('a changed message did not draw the card');

  // 3b. Two sessions on the SAME origin request permission through the native API, notify in an
  // inline startup script, reuse a conversation tag, and notify again while Bop is hidden.
  const fixture = require('node:http').createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><title>Two account notification test</title><body>
      <button id="later">Send another message</button>
      <button id="newer">Send a third message</button><script>
      window.permissionSeen = Notification.permission;
      Notification.requestPermission().then(permission => {
        window.permissionResult = permission;
        window.notice = new Notification('Same chat', {body:'First message',tag:'same-thread'});
      }).catch(error => { window.notifyError = String(error); });
      document.getElementById('later').onclick = () => { new Notification('Same chat', {body:'Second message',tag:'same-thread'}); };
      // A genuinely new message. Step 10 drives this one, because later's wording is one the run has
      // already been notified about — clicking it again must stay silent (asserted at step 3a).
      document.getElementById('newer').onclick = () => { new Notification('Same chat', {body:'Third message',tag:'same-thread'}); };
      </script></body>`);
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${fixture.address().port}/chat`;
    for (const id of ['A', 'B']) {
      state = spaces.selectApp(state, id, 'custom', { kind: 'social' });
      state = spaces.setUrl(state, id, url);
    }
    for (const id of ['A', 'B']) {
      const clicked = await uiView.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('[data-open="${id}"]');
        if (!button) return false;
        button.click(); return true;
      })()`, true);
      if (!clicked) throw new Error(`space ${id} has no Open control`);
      await new Promise(resolve => setTimeout(resolve, 650));
      const view = spaceViews.get(id);
      const observed = await view.webContents.executeJavaScript(`({permission: Notification.permission, initial: window.permissionSeen, requested: window.permissionResult, error: window.notifyError || null, tag: window.notice && window.notice.tag})`);
      record(`same-origin-permission-${id}`, JSON.stringify(observed));
      if (observed.initial !== 'granted' || observed.requested !== 'granted' || observed.error || observed.tag !== `bop:${id}:same-thread`) {
        throw new Error(`notification API failed for ${id}: ${JSON.stringify(observed)}`);
      }
    }
    const counts = ['A', 'B'].map(id => alerts.filter(alert => alert.spaceId === id && alert.kind === 'web').length);
    record('same-origin-two-accounts', JSON.stringify({ counts, loaded: state.loadedSlots }));
    if (counts.some(count => count !== 1)) throw new Error('same-origin accounts did not both notify independently');
    saveSettings();
    const restoredState = loadSettings();
    record('opened-spaces-disk', JSON.stringify({ loaded: restoredState.loadedSlots, urls: restoredState.spaces.filter(space => ['A', 'B'].includes(space.id)).map(space => space.url) }));
    if (restoredState.loadedSlots.join(',') !== 'A,B' || restoredState.spaces.filter(space => ['A', 'B'].includes(space.id)).some(space => space.url !== url)) throw new Error('opened-space restore failed through the settings file');
    shellWindow.show();
    shellWindow.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!shellWindow || shellWindow.isVisible()) throw new Error('Close did not hide Bop without destroying sessions');
    await spaceViews.get('A').webContents.executeJavaScript(`document.getElementById('later').click(); true`);
    await new Promise(resolve => setTimeout(resolve, 300));
    const later = alerts.find(alert => alert.spaceId === 'A' && alert.tag === 'web:same-thread');
    const untouched = alerts.find(alert => alert.spaceId === 'B' && alert.tag === 'web:same-thread');
    record('hidden-account-notification', JSON.stringify({ hidden: !shellWindow.isVisible(), A: later?.body, B: untouched?.body }));
    if (later?.body !== 'Second message' || untouched?.body !== 'First message') throw new Error('hidden session lost or misrouted its notification');
    shellWindow.show();
  } finally {
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
  }

  // 4. A navigation outside the allow-list is refused and handed to the system instead.
  await watchView.webContents.loadFile(path.join(SMOKE_OUT, 'watch.html'));
  let denied = false;
  watchView.webContents.once('will-navigate', (event) => { denied = event.defaultPrevented !== false; });
  const allowed = spaces.pageAllowed(spaces.accountFor(state, watchId), 'https://evil.test/');
  record('navigation-policy', `outside-host-allowed=${allowed}`);
  if (allowed) throw new Error('an outside host was allowed');

  // 5. The bubble keeps the spot it was dropped in, and the space menu is centred on the display.
  //    Both are measured here on the real work area at the configured size: a free drop must survive
  //    with the screen edge as the only correction, and the menu must come back to the middle instead of
  //    hanging off an edge — measured on 0.1.6 with the bubble in the top-left corner, where the anchored
  //    panel was clamped against the left edge and its first word was cut off.
  const area = screen.getPrimaryDisplay().workArea;
  const size = bubbleSize();
  const dropped = docking.free(377, 512, size, area.width, area.height);
  const pulledTopLeft = docking.free(-400, -400, size, area.width, area.height);
  const pulledBottomRight = docking.free(area.width + 400, area.height + 400, size, area.width, area.height);
  const menuSpot = docking.centered(area.width, area.height, MENU_WIDTH, 240, BUBBLE_MARGIN);
  const menuOffCentre = Math.abs(menuSpot.x + MENU_WIDTH / 2 - area.width / 2);
  record('docking', JSON.stringify({ size, dropped, pulledTopLeft, pulledBottomRight, menuSpot, menuOffCentre }));
  if (dropped.x !== 377 || dropped.y !== 512) throw new Error(`a free drop was moved: ${JSON.stringify(dropped)}`);
  if (pulledTopLeft.x !== 0 || pulledTopLeft.y !== 0) {
    throw new Error(`a drop off the top-left was not pulled back to the corner: ${JSON.stringify(pulledTopLeft)}`);
  }
  if (pulledBottomRight.x !== area.width - size || pulledBottomRight.y !== area.height - size) {
    throw new Error(`a drop off the bottom-right was not pulled back in: ${JSON.stringify(pulledBottomRight)}`);
  }
  if (menuOffCentre > 1) throw new Error(`the space menu is not centred: ${JSON.stringify(menuSpot)}`);

  // 5b. Fitting the pane. A space must be served the layout that fits the width it actually has, so this
  //     is measured from the page's own `navigator.userAgent` rather than from the setting: a switch that
  //     never reached the engine would pass a model-only check and fail here.
  const fitId = 'D';
  state = spaces.enableSlot(state, fitId, { appId: 'custom', kind: 'tasks', label: 'Fit test' });
  const fitView = spaceView(fitId);
  const uaPath = path.join(SMOKE_OUT, 'ua.html'); // Also the \"loads normally\" fixture for step 5e.
  fs.writeFileSync(uaPath, '<!doctype html><title>UA</title><body>ua</body>');
  const readAgent = async () => {
    await fitView.webContents.loadFile(uaPath);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return String(await fitView.webContents.executeJavaScript('navigator.userAgent', true));
  };
  const phoneSeen = await readAgent();
  const defaultedToPhone = spaces.accountFor(state, fitId).phoneLayout === true;
  state = spaces.setPhoneLayout(state, fitId, false);
  applyLayoutMode(fitId);
  const desktopSeen = await readAgent();
  state = spaces.setPhoneLayout(state, fitId, true);
  applyLayoutMode(fitId);
  const phoneAgain = await readAgent();
  const isPhone = (agent) => /Android/.test(agent) && /Mobile/.test(agent);
  // A site that is told the browser is Electron is a site that may refuse to serve at all — measured
  // against app.usercrowd.com, which answered an "unsupported browser" page for the Electron default
  // and its sign-in page for the same engine asked as Chrome. The agents are asserted clean here, not
  // only in the unit test, because this is the string the engine actually sends.
  const names = (agent) => /electron|bop\//i.test(agent);
  const agents = { phone: phoneSeen, desktop: desktopSeen, phoneAgain };
  record('phone-layout', JSON.stringify({ defaultedToPhone, phone: isPhone(phoneSeen), desktop: isPhone(desktopSeen), switchedBack: isPhone(phoneAgain), agents, namesTheApp: Object.fromEntries(Object.entries(agents).map(([key, agent]) => [key, names(agent)])) }));
  if (!defaultedToPhone) throw new Error('a new space must default to the layout that fits');
  if (!isPhone(phoneSeen)) throw new Error(`the pane did not ask for the mobile site: ${phoneSeen}`);
  if (isPhone(desktopSeen)) throw new Error(`the desktop site was still requested as a phone: ${desktopSeen}`);
  if (!isPhone(phoneAgain)) throw new Error('switching back to the mobile site did not take effect');
  if (!desktopSeen.includes(String(process.versions.chrome).split('.')[0])) throw new Error('the desktop agent lost the real engine version');
  for (const [key, agent] of Object.entries(agents)) {
    if (names(agent)) throw new Error(`the ${key} agent still names Bop or Electron, which is what lets a site refuse to serve it: ${agent}`);
  }

  // 5c. A pane is a page the user is looking at, so Chromium must not treat it as a background tab.
  //     This is the deepest bug this build had: a child view of a BaseWindow is never told that it became
  //     visible, so every space — and the dashboard itself — reported `document.visibilityState`
  //     `hidden` and clamped its timers to roughly one per second. A site in that state behaves like a
  //     background tab: it hands its messages to a service worker, which Electron does not run.
  //     Two things have to hold. A space that is *not* the open one sits off screen and is allowed to
  //     look like a background tab to its site — that is the state in which a chat page notifies — but it
  //     must still run at full speed instead of being throttled to about one tick a second. And the
  //     dashboard window, which the user is genuinely looking at, must not report itself as hidden.
  const paneProbe = await fitView.webContents.executeJavaScript('({ state: document.visibilityState, hidden: document.hidden, focus: document.hasFocus() })', true);
  await fitView.webContents.executeJavaScript('(() => { window.__bopTicks = 0; window.__bopTick = setInterval(() => { window.__bopTicks += 1; }, 100); return true; })()', true);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const paneTicks = await fitView.webContents.executeJavaScript('(() => { clearInterval(window.__bopTick); return window.__bopTicks; })()', true);
  // Put the dashboard in front before reading it: "a window the user is looking at" is the state this
  // asserts, and the engine reports a window that another window covers as hidden by itself — this step
  // failed once while the user's own copy of Bop sat maximised over the smoke's window, and passed with
  // nothing else changed. With the 0.1.4 defect (a view never told it had become visible) focusing
  // changes nothing and the assertion still fails, so the check keeps its teeth.
  const front = { requested: true, visible: false, focused: false, minimized: false };
  if (shellWindow && !shellWindow.isDestroyed()) {
    shellWindow.show();
    shellWindow.focus();
    front.visible = shellWindow.isVisible();
    front.focused = shellWindow.isFocused();
    front.minimized = shellWindow.isMinimized();
  } else {
    front.requested = false;
  }
  const dashWaitedFrom = Date.now();
  let uiProbe = { state: 'unknown', hidden: true };
  for (;;) {
    uiProbe = await uiView.webContents.executeJavaScript('({ state: document.visibilityState, hidden: document.hidden })', true);
    if (uiProbe.state === 'visible' || Date.now() - dashWaitedFrom > 5000) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  record('pane-visibility', JSON.stringify({ pane: paneProbe, ticksIn1200ms: paneTicks, dashboard: uiProbe, dashboardWaitedMs: Date.now() - dashWaitedFrom, shellWindow: front, keepPagesAlive: state.keepPagesAlive !== false }));
  if (uiProbe.state !== 'visible') {
    throw new Error(`the dashboard reports ${uiProbe.state} after ${Date.now() - dashWaitedFrom} ms in front (visible=${front.visible} focused=${front.focused} minimized=${front.minimized}): a window the user is looking at must not be a background tab`);
  }
  if (state.keepPagesAlive !== false && paneTicks < 6) throw new Error(`a background pane is throttled: ${paneTicks} ticks in 1200ms`);

  // 5d. A dialog must be *clickable*, not only visible, and a space with no address must never open an
  //     empty pane. Both were measured failures on 0.1.4 with a real mouse: the new-space picker was
  //     drawn under the open space's pane, so every control in it sent its click to the page behind it
  //     (and with a pane that had never navigated, the dialog looked perfect and was silently deaf),
  //     while a `custom` space with no address opened a blank pane that covered the hub. The view order
  //     is checked here because that is the mechanism the fix relies on, and the refusal is checked
  //     because a second empty pane would put the user back in the same dead end.
  const blankId = 'E';
  state = spaces.enableSlot(state, blankId, { appId: 'custom', kind: 'tasks', label: 'No address' });
  const refused = openSpace(blankId);
  record('space-without-address', JSON.stringify({ refused, panes: [...spaceViews.keys()], open: openSpaceId }));
  if (refused.ok !== false || spaceViews.has(blankId) || openSpaceId === blankId) {
    throw new Error('a space with no address opened an empty pane instead of asking for one');
  }
  state = spaces.disableSlot(state, blankId);
  broadcast();

  const dashboardOnTop = () => {
    const children = shellWindow.contentView.children;
    return children.indexOf(uiView) === children.length - 1;
  };
  await uiView.webContents.executeJavaScript('document.getElementById("new-space").click(); true', true);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const pickerShown = await uiView.webContents.executeJavaScript('!!document.querySelector("#modal-root .modal")', true);
  const raised = dashboardOnTop();
  await uiView.webContents.executeJavaScript('document.querySelector("#modal-root #cancel").click(); true', true);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const pickerClosed = await uiView.webContents.executeJavaScript('!document.querySelector("#modal-root .modal")', true);
  const lowered = !dashboardOnTop();
  record('dialog-view-order', JSON.stringify({ pickerShown, raised, pickerClosed, lowered, children: shellWindow.contentView.children.length }));
  if (!pickerShown || !raised) throw new Error('an open dialog is not the top view: its controls would be sent to the pane behind it');
  if (!pickerClosed || !lowered) throw new Error('the dashboard stayed above the space panes after the dialog closed');

  // 5e. A page can also answer by refusing the browser outright instead of serving itself, which leaves
  //     a pane that loads perfectly and shows nothing usable — the state the user can only read as "Bop
  //     failed to load". Measured on 0.1.5 against app.usercrowd.com: the site saw "Electron" in the
  //     agent and answered `https://app.usercrowd.com/unsupported_browser`. The agent is fixed above;
  //     this is the second half — that such a page is *named* on the space card, and that the note goes
  //     away again once a page loads normally. The fixture is named neutrally so the title is what has to
  //     be recognised; the URL rule is unit-tested.
  const refusedPath = path.join(SMOKE_OUT, 'refused-by-page.html');
  fs.writeFileSync(refusedPath, '<!doctype html><title>Sorry, you can\u2019t use UserCrowd on this version of Electron</title><body>refused</body>');
  await fitView.webContents.loadFile(refusedPath);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const refusalTitle = fitView.webContents.getTitle();
  const refusalNote = monitorFor(fitId).browserNote;
  await fitView.webContents.loadFile(uaPath);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const clearedNote = monitorFor(fitId).browserNote;
  record('browser-refusal-note', JSON.stringify({ refusalTitle, noteSet: !!refusalNote, noteCleared: !clearedNote, text: refusalNote }));
  if (!refusalNote) throw new Error('a page that refused the browser left the user with an unexplained empty pane');
  if (clearedNote) throw new Error('the refusal note survived a page that loads normally');

  // 5f. Both themes have to be readable, and the operating system's light/dark switch is a live setting.
  //     `nativeTheme.themeSource` is the same switch Electron hands the app, so this drives the real
  //     event instead of describing it, and the assertion is read back from the rendered windows rather
  //     than from the model. `tools/contrast.js` is the human-facing version of the colour half of this
  //     check: measured on 0.1.6 in dark theme it found six elements at a 1.36:1 ratio — the app names in
  //     the new-space dialog were black text on a #262235 tile, because a `button` does not inherit
  //     `color` and nothing set it.
  const themeSourceBefore = nativeTheme.themeSource;
  const themeOf = async () => ({
    dashboard: await uiView.webContents.executeJavaScript('document.documentElement.dataset.theme', true),
    colourScheme: await uiView.webContents.executeJavaScript('getComputedStyle(document.documentElement).colorScheme', true),
  });
  const startTheme = state.theme;
  state = { ...state, theme: 'system' };
  broadcast();
  nativeTheme.themeSource = 'light';
  await new Promise((resolve) => setTimeout(resolve, 350));
  const followedLight = await themeOf();
  nativeTheme.themeSource = 'dark';
  await new Promise((resolve) => setTimeout(resolve, 350));
  const followedDark = await themeOf();
  nativeTheme.themeSource = themeSourceBefore;
  state = { ...state, theme: startTheme };
  broadcast();
  record('theme-follows-system', JSON.stringify({ light: followedLight, dark: followedDark }));
  if (followedLight.dashboard !== 'light' || followedDark.dashboard !== 'dark') {
    throw new Error(`the app did not follow the system theme: ${JSON.stringify([followedLight, followedDark])}`);
  }
  if (followedLight.colourScheme !== 'light' || followedDark.colourScheme !== 'dark') {
    throw new Error(`native controls did not follow the theme: ${JSON.stringify([followedLight, followedDark])}`);
  }

  // 6. Screenshots, captured by the app itself, so the UI can be inspected without a human.
  if (shellWindow) {
    shellWindow.show();
    // First with nothing open, so the bento page itself is what gets captured, then again with a space
    // open, where the space's own web view paints over the pane.
    await new Promise((resolve) => setTimeout(resolve, 600));
    fs.writeFileSync(path.join(SMOKE_OUT, 'dashboard.png'), (await uiView.webContents.capturePage()).toPNG());
    openSpace(watchId);
    await new Promise((resolve) => setTimeout(resolve, 700));
    // The pane the user has just opened must tell its site that it is on screen, otherwise the page
    // behaves like a background tab while it is the one being looked at.
    const openedPane = await spaceView(watchId).webContents.executeJavaScript('({ state: document.visibilityState })', true);
    record('open-pane-visible', JSON.stringify(openedPane));
    if (openedPane.state !== 'visible') throw new Error(`the open pane reports ${openedPane.state}`);
    fs.writeFileSync(path.join(SMOKE_OUT, 'dashboard-open.png'), (await uiView.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(SMOKE_OUT, 'space-page.png'), (await spaceView(watchId).webContents.capturePage()).toPNG());
    // Start the bubble the way the app does: the setting first, then the window, so the dashboard
    // really believes a bubble is running while the screenshots are taken.
    state = { ...state, bubble: true };
    createBubble();
    broadcast();
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (bubbleWindow) {
      const readBadge = () => bubbleWindow.webContents.executeJavaScript(`({ hidden: document.getElementById('badge').hidden, text: document.getElementById('badge').textContent })`);
      const firstBadge = await readBadge();
      if (firstBadge.hidden || firstBadge.text !== String(alerts.filter(alert => !alert.acknowledged).length)) throw new Error('bubble has no initial unread snapshot');
      await uiView.webContents.executeJavaScript(`window.bop.acknowledgeAll('A')`);
      await new Promise(resolve => setTimeout(resolve, 150));
      const nextBadge = await readBadge();
      record('bubble-unread-live', JSON.stringify({ before: firstBadge, after: nextBadge }));
      if (nextBadge.text !== String(alerts.filter(alert => !alert.acknowledged).length) || nextBadge.text === firstBadge.text) throw new Error('bubble badge did not follow acknowledgement');
      await bubbleWindow.webContents.executeJavaScript(`window.bop.bubble.click(); true`);
      await new Promise(resolve => setTimeout(resolve, 450));
      if (!menuWindow) throw new Error('bubble click did not open its menu');
      // The panel is centred on the display, which is the reported defect: anchored to a bubble in a
      // corner it was clamped against that edge and cut off.
      const menuBounds = menuWindow.getBounds();
      const menuOffCentre = Math.abs(menuBounds.x + menuBounds.width / 2 - (area.x + area.width / 2));
      record('bubble-menu-centred', JSON.stringify({ bounds: menuBounds, offCentre: menuOffCentre, theme: await menuWindow.webContents.executeJavaScript('document.documentElement.dataset.theme') }));
      if (menuOffCentre > 1) throw new Error(`the space menu is not centred on the display: ${JSON.stringify(menuBounds)}`);
      const rows = await menuWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-open]')).map(button => ({ id: button.dataset.open, badge: button.querySelector('.badge')?.textContent || null }))`);
      record('bubble-menu-initial', JSON.stringify(rows));
      if (rows.length !== state.slots.length || rows.find(row => row.id === 'B')?.badge !== '1') throw new Error('bubble menu is missing spaces or account B unread count');
      await menuWindow.webContents.executeJavaScript(`document.querySelector('[data-open="B"]').click(); true`);
      await new Promise(resolve => setTimeout(resolve, 200));
      if (openSpaceId !== 'B') throw new Error('bubble menu did not open account B');
      fs.writeFileSync(path.join(SMOKE_OUT, 'bubble.png'), (await bubbleWindow.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(SMOKE_OUT, 'bubble-bounds.json'), JSON.stringify({ spot: bubbleSpot, area }, null, 2));

      // Drive the real release path, not just the maths: move the window like a drag would, then let
      // the live 'move' handler settle it, and measure where it actually ended up. The reported defect
      // was that it jumped to an edge, so the assertion is that it stayed exactly where it was dropped —
      // deliberately not a multiple of anything and not near an edge.
      suppressDockUntil = 0;
      const dropX = Math.round(area.x + area.width / 2 + 37);
      const dropY = Math.round(area.y + area.height / 2 - 11);
      bubbleWindow.setPosition(dropX, dropY);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const [bubbleX, bubbleY] = bubbleWindow.getPosition();
      const stayed = bubbleX - area.x === dropX - area.x && bubbleY - area.y === dropY - area.y;
      const [keptWidth, keptHeight] = bubbleWindow.getSize();
      record('bubble-release-free', JSON.stringify({ wanted: { x: dropX - area.x, y: dropY - area.y }, got: { x: bubbleX - area.x, y: bubbleY - area.y }, stayed, size: { width: keptWidth, height: keptHeight } }));
      if (!stayed) throw new Error(`the bubble moved itself to ${bubbleX - area.x},${bubbleY - area.y} instead of staying at ${dropX - area.x},${dropY - area.y}`);
      if (keptWidth !== size || keptHeight !== size) throw new Error('a drop changed the bubble size');
      fs.writeFileSync(path.join(SMOKE_OUT, 'bubble-docked.png'), (await bubbleWindow.webContents.capturePage()).toPNG());

      // 7. Bubble preferences: a real resize and re-dock, real transparency, and a spot that survives
      //    a restart through the same file the app writes.
      const target = spaces.BUBBLE_SIZES[0];
      state = spaces.setBubblePref(state, { size: target, opacity: 80, doubleClick: 'last-space', overFullscreen: false });
      applyBubblePrefs();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const small = bubbleWindow.getBounds();
      const smallSpot = { x: small.x - area.x, y: small.y - area.y };
      record('bubble-prefs', JSON.stringify({ size: small.width, spot: smallSpot, opacity: bubbleWindow.getOpacity(), onScreen: smallSpot.x >= 0 && smallSpot.y >= 0 && smallSpot.x + small.width <= area.width && smallSpot.y + small.height <= area.height }));
      if (small.width !== target) throw new Error(`the bubble did not resize (${small.width} vs ${target})`);
      if (smallSpot.x !== dropX - area.x || smallSpot.y !== dropY - area.y) throw new Error(`a resize moved the bubble (${JSON.stringify(smallSpot)})`);
      if (bubbleWindow.getOpacity() > 0.95) throw new Error(`the bubble did not become translucent (${bubbleWindow.getOpacity()})`);
      fs.writeFileSync(path.join(SMOKE_OUT, 'bubble-small.png'), (await bubbleWindow.webContents.capturePage()).toPNG());

      const stored = spaces.normalize(JSON.parse(JSON.stringify({ ...state, alerts: undefined }))).bubblePrefs;
      const restored = docking.free(
        docking.restore(stored.spotX, stored.spotY, stored.size, area.width, area.height).x,
        docking.restore(stored.spotX, stored.spotY, stored.size, area.width, area.height).y,
        stored.size, area.width, area.height);
      record('bubble-restore', JSON.stringify({ stored: { x: stored.spotX, y: stored.spotY, size: stored.size }, restored, keptSpot: Math.abs(restored.x - smallSpot.x) <= 1 && Math.abs(restored.y - smallSpot.y) <= 1 }));
      if (stored.size !== target || stored.doubleClick !== 'last-space' || stored.overFullscreen !== false || stored.opacity !== 80) {
        throw new Error(`bubble settings did not persist: ${JSON.stringify(stored)}`);
      }
      if (Math.abs(restored.x - smallSpot.x) > 1 || Math.abs(restored.y - smallSpot.y) > 1) {
        throw new Error(`the stored spot did not restore to where it was left (${JSON.stringify(restored)} vs ${JSON.stringify(smallSpot)})`);
      }

      // 8. The settings page carries the bubble controls. Captured last, with the bubble running and
      //    its settings non-default, so the screenshot shows the real controls rather than a stub.
      closeSpace();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await uiView.webContents.executeJavaScript(`document.querySelector('button[data-page="settings"]').click(); true`, true);
      await new Promise((resolve) => setTimeout(resolve, 350));
      // Assert on the *rendered* page, not just on the model, so a broken template cannot pass.
      const settingsText = await uiView.webContents.executeJavaScript(`document.querySelector('.main').innerText`, true);
      const wanted = ['48px', 'Transparency', '20% see-through', 'Open the last space I used', 'Bubble picture', 'Choose a picture', 'follows the pointer'];
      record('settings-ui', JSON.stringify({ missing: wanted.filter((phrase) => !String(settingsText).includes(phrase)) }));
      if (wanted.some((phrase) => !String(settingsText).includes(phrase))) throw new Error(`the bubble settings page is missing controls: ${settingsText}`);
      uiView.webContents.invalidate(); // force a fresh frame so the screenshot is not a stale tile
      await new Promise((resolve) => setTimeout(resolve, 400));
      fs.writeFileSync(path.join(SMOKE_OUT, 'settings.png'), (await uiView.webContents.capturePage()).toPNG());

      // 9. Drive a bubble control the way a user does: a real click in the dashboard renderer, through
      //    preload and IPC into the live window — not a direct call to the model.
      const clicked = await uiView.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('[data-bubble-size="64"]');
        if (!button) return false;
        button.click();
        return true;
      })()`, true);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const grown = bubbleWindow.getBounds();
      record('bubble-controls-click', JSON.stringify({ clicked, width: grown.width, spot: { x: grown.x - area.x, y: grown.y - area.y }, stored: state.bubblePrefs.size }));
      if (!clicked) throw new Error('the bubble size control is not on the settings page');
      if (grown.width !== 64 || state.bubblePrefs.size !== 64) throw new Error(`clicking 64px did not resize the bubble (${grown.width}, model ${state.bubblePrefs.size})`);
      if (grown.x - area.x !== dropX - area.x || grown.y - area.y !== dropY - area.y) throw new Error('a size click moved the bubble instead of growing it in place');

      // 10. The reminder card, on the corner the bubble already occupies. A message has to be *seen*:
      //     Windows shows no toast for an application without a Start Menu shortcut carrying its
      //     AppUserModelID, which is exactly the portable build, and that silence applies to a space
      //     page's own notification too. So this drives the whole real path — a page notifies, Bop's own
      //     card appears with the account's wording, it steps above the bubble instead of covering it,
      //     and opening it opens that space and counts the alert as seen.
      bubbleWindow.setPosition(Math.round(area.x + area.width - 200), Math.round(area.y + area.height - 200));
      await new Promise((resolve) => setTimeout(resolve, 450));
      const cardQueueBefore = reminderQueue.count;
      await spaceViews.get('A').webContents.executeJavaScript(`document.getElementById('newer').click(); true`);
      // Wait for the card itself, not for a fixed pause: the first card of a run has to create the
      // window and load alert.html before it can be shown, and a machine busy with something else takes
      // longer than any pause picked here (measured: this step failed once with 2 GB free and passed on
      // the same build once the load was gone). Bounded, and the timeout is reported with the wait.
      const cardWaitedFrom = Date.now();
      const cardAbsent = () => !reminderWindow || reminderWindow.isDestroyed() || !reminderWindow.isVisible();
      while (cardAbsent() && Date.now() - cardWaitedFrom < 8000) await new Promise((resolve) => setTimeout(resolve, 40));
      if (cardAbsent()) throw new Error(`no reminder card appeared for a web notification within ${Date.now() - cardWaitedFrom} ms`);
      if (reminderQueue.count !== cardQueueBefore + 1) throw new Error('a new message did not take the card over');
      const cardBounds = reminderWindow.getBounds();
      const bubbleBounds = bubbleWindow.getBounds();
      const cardText = String(await reminderWindow.webContents.executeJavaScript(`document.getElementById('card').innerText.replace(/\\s+/g, ' ').trim()`, true));
      const onScreen = cardBounds.x >= area.x && cardBounds.y >= area.y
        && cardBounds.x + cardBounds.width <= area.x + area.width && cardBounds.y + cardBounds.height <= area.y + area.height;
      const clearOfBubble = cardBounds.y + cardBounds.height <= bubbleBounds.y || cardBounds.y >= bubbleBounds.y + bubbleBounds.height;
      record('reminder-card', JSON.stringify({ text: cardText, card: cardBounds, bubble: bubbleBounds, onScreen, clearOfBubble }));
      if (!cardText.includes('Account A')) throw new Error(`the reminder card does not name the account: ${cardText}`);
      if (!cardText.includes('Third message')) throw new Error(`the reminder card does not carry the message text: ${cardText}`);
      if (!onScreen) throw new Error('the reminder card is not fully on screen');
      if (!clearOfBubble) throw new Error('the reminder card covers the bubble');
      fs.writeFileSync(path.join(SMOKE_OUT, 'reminder.png'), (await reminderWindow.webContents.capturePage()).toPNG());
      await reminderWindow.webContents.executeJavaScript(`document.getElementById('open').click(); true`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const seenAlert = alerts.find((alert) => alert.spaceId === 'A' && alert.tag === 'web:same-thread');
      record('reminder-opened', JSON.stringify({ acknowledged: !!(seenAlert && seenAlert.acknowledged), open: openSpaceId, hidden: !reminderWindow.isVisible() }));
      if (!seenAlert || seenAlert.acknowledged !== true) throw new Error('opening the reminder card did not count that alert as seen');
      if (openSpaceId !== 'A') throw new Error('opening the reminder card did not open its account');
      if (reminderWindow.isVisible()) throw new Error('the reminder card stayed on screen after it was opened');

      // 11. Switching a section has to work while a space is open. Measured on 0.1.7: Spaces, Alerts,
      //     Settings and Guide changed the page *behind* the open space, so the section looked broken and
      //     the only way to reach it was the ✕. The click below is a real click in the dashboard renderer,
      //     and the assertion is on the live views: the pane has to step aside while the space keeps its
      //     session and its monitor.
      const panesBefore = spaceViews.size;
      const monitoringBefore = monitors.get('A') && monitors.get('A').status;
      const paneXBefore = spaceViews.get('A').getBounds().x;
      await uiView.webContents.executeJavaScript(`document.querySelector('button[data-page="settings"]').click(); true`, true);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const paneXAfter = spaceViews.get('A').getBounds().x;
      const switched = await uiView.webContents.executeJavaScript(`({
        spaceOpen: document.body.classList.contains('space-open'),
        page: document.querySelector('.nav button[aria-current="true"]').dataset.page,
        text: String(document.querySelector('.main').innerText).slice(0, 80),
      })`, true);
      record('nav-switch-while-open', JSON.stringify({
        before: { open: 'A', panes: panesBefore, monitoring: monitoringBefore, paneX: paneXBefore },
        after: { open: openSpaceId, panes: spaceViews.size, monitoring: monitors.get('A') && monitors.get('A').status, paneX: paneXAfter },
        switched,
      }));
      if (openSpaceId !== null) throw new Error('switching a section left the space covering it');
      if (paneXAfter > -100) throw new Error(`the space pane is still over the section: x=${paneXAfter}`);
      if (switched.spaceOpen) throw new Error('the dashboard still believes a space is open');
      if (switched.page !== 'settings' || !switched.text.includes('Settings')) {
        throw new Error(`the Settings section did not come forward: ${JSON.stringify(switched)}`);
      }
      if (spaceViews.size !== panesBefore || !monitors.get('A')) throw new Error('switching a section dropped the space it was showing');

      // 12. The bubble's drag, driven through the bubble's own renderer: pointerdown, moves and pointerup
      //     on the real page, so the whole path — handler, IPC, geometry, window — is the one a hand uses.
      //     Measured on 0.1.7 with the machine's own pointer, the operating system's drag arrived 33 points
      //     short of the hand that dragged it, and only the thin ring around the button moved the window at
      //     all; this asserts an exact, point-for-point follow, a size that never changes, and a saved spot.
      const dragFrom = bubbleWindow.getPosition();
      const dragSize = bubbleWindow.getSize();
      const dragDelta = { x: 90, y: 110 };
      const gesture = await bubbleWindow.webContents.executeJavaScript(`(() => {
        const orb = document.getElementById('bubble');
        const init = (x, y) => ({ screenX: x, screenY: y, button: 0, buttons: 1, isPrimary: true, pointerId: 7, pointerType: 'mouse', bubbles: true, cancelable: true });
        const start = { x: ${dragFrom[0]} + 22, y: ${dragFrom[1]} + 32 };
        const steps = 12;
        orb.dispatchEvent(new PointerEvent('pointerdown', init(start.x, start.y)));
        for (let step = 1; step <= steps; step += 1) {
          orb.dispatchEvent(new PointerEvent('pointermove', init(
            start.x + Math.round(${dragDelta.x} * step / steps),
            start.y + Math.round(${dragDelta.y} * step / steps),
          )));
        }
        const end = { x: start.x + ${dragDelta.x}, y: start.y + ${dragDelta.y} };
        orb.dispatchEvent(new PointerEvent('pointerup', init(end.x, end.y)));
        return { start, end };
      })()`, true);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const dragTo = bubbleWindow.getPosition();
      const dragWanted = { x: dragFrom[0] + dragDelta.x, y: dragFrom[1] + dragDelta.y };
      const dragSizeAfter = bubbleWindow.getSize();
      const savedSpot = spaces.normalize(JSON.parse(JSON.stringify({ ...state, alerts: undefined }))).bubblePrefs;
      // Written against the named fields on purpose: an index into an object reads as `undefined`, every
      // comparison against it is false, and the check silently stops being a check.
      const offBy = Math.abs(dragTo[0] - dragWanted.x) + Math.abs(dragTo[1] - dragWanted.y);
      record('bubble-drag-live', JSON.stringify({
        from: { x: dragFrom[0], y: dragFrom[1] },
        wanted: dragWanted,
        got: { x: dragTo[0], y: dragTo[1] },
        offBy,
        size: dragSizeAfter,
        savedSpot: { x: savedSpot.spotX, y: savedSpot.spotY },
        gesture,
      }));
      if (!Number.isFinite(offBy) || offBy > 1) {
        throw new Error(`the bubble did not follow the pointer: wanted ${JSON.stringify(dragWanted)}, got ${JSON.stringify([dragTo[0], dragTo[1]])}`);
      }
      if (dragSizeAfter[0] !== dragSize[0] || dragSizeAfter[1] !== dragSize[1]) throw new Error('a drag changed the bubble size');
      if (Math.abs(savedSpot.spotX - docking.fraction(dragTo[0] - area.x, area.width)) > 0.001) {
        throw new Error(`the dragged spot was not remembered: ${JSON.stringify(savedSpot)}`);
      }
      fs.writeFileSync(path.join(SMOKE_OUT, 'bubble-dragged.png'), (await bubbleWindow.webContents.capturePage()).toPNG());

      // 12b. A press that does not travel has to stay a click: the drag threshold must not turn the
      //      bubble into something that moves when it is tapped, and the menu must still open.
      const tapAt = bubbleWindow.getPosition();
      await bubbleWindow.webContents.executeJavaScript(`(() => {
        const orb = document.getElementById('bubble');
        const init = (x, y) => ({ screenX: x, screenY: y, button: 0, buttons: 1, isPrimary: true, pointerId: 8, pointerType: 'mouse', bubbles: true, cancelable: true });
        const at = { x: ${tapAt[0]} + 32, y: ${tapAt[1]} + 32 };
        orb.dispatchEvent(new PointerEvent('pointerdown', init(at.x, at.y)));
        orb.dispatchEvent(new PointerEvent('pointerup', init(at.x, at.y)));
        return true;
      })()`, true);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const afterTap = bubbleWindow.getPosition();
      const menuAfterTap = !!menuWindow;
      record('bubble-tap-still-clicks', JSON.stringify({ at: tapAt, after: afterTap, moved: afterTap[0] !== tapAt[0] || afterTap[1] !== tapAt[1], menu: menuAfterTap }));
      if (afterTap[0] !== tapAt[0] || afterTap[1] !== tapAt[1]) throw new Error('a tap moved the bubble');
      if (!menuAfterTap) throw new Error('a tap on the bubble no longer opens the space menu');
      menuWindow.close();
      menuWindow = null;

      // 13. The bubble's picture: a real PNG written to disk, decoded by Electron's own decoder, cropped
      //     to a square and shown by the real window — where the page's own content policy decides whether
      //     the data URL may load at all.
      const picturePath = path.join(SMOKE_OUT, 'avatar-source.png');
      const source = await uiView.webContents.capturePage();
      fs.writeFileSync(picturePath, source.toPNG());
      const sourceSize = source.getSize();
      const decoded = avatar.avatarFromFile(picturePath, nativeImage);
      record('bubble-avatar-decoded', JSON.stringify({
        source: sourceSize,
        error: decoded.error || null,
        pixels: decoded.pixels,
        length: decoded.dataUrl ? decoded.dataUrl.length : 0,
      }));
      if (decoded.error) throw new Error(`a real PNG was refused as a bubble picture: ${decoded.error}`);
      if (decoded.pixels.kept !== Math.min(avatar.MAX_EDGE, Math.min(sourceSize.width, sourceSize.height))) {
        throw new Error(`a ${sourceSize.width}×${sourceSize.height} picture was kept as ${decoded.pixels.kept}`);
      }
      const fat = avatar.avatarFromFile(picturePath, nativeImage, () => Buffer.alloc(avatar.MAX_FILE_BYTES + 1));
      if (!fat.error) throw new Error('an oversized file was accepted as a bubble picture');
      state = spaces.setBubblePref(state, { avatar: decoded.dataUrl });
      broadcast();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const face = await bubbleWindow.webContents.executeJavaScript(`(() => {
        const picture = document.getElementById('picture');
        return {
          shown: !picture.hidden,
          drawn: document.getElementById('mark').hidden,
          loaded: picture.complete && picture.naturalWidth > 0,
        };
      })()`, true);
      record('bubble-avatar-shown', JSON.stringify(face));
      if (!face.shown || !face.drawn) throw new Error(`the bubble did not take the picture: ${JSON.stringify(face)}`);
      if (!face.loaded) throw new Error('the bubble picture never loaded — the page policy refused the data URL');
      fs.writeFileSync(path.join(SMOKE_OUT, 'bubble-avatar.png'), (await bubbleWindow.webContents.capturePage()).toPNG());

      await uiView.webContents.executeJavaScript(`document.querySelector('button[data-page="settings"]').click(); true`, true);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const preview = await uiView.webContents.executeJavaScript(`({
        image: !!document.querySelector('.face-preview img'),
        back: !!document.getElementById('bubble-picture-clear'),
      })`, true);
      record('settings-avatar', JSON.stringify(preview));
      if (!preview.image || !preview.back) throw new Error(`the Settings page does not show the picture it just took: ${JSON.stringify(preview)}`);
      fs.writeFileSync(path.join(SMOKE_OUT, 'settings-avatar.png'), (await uiView.webContents.capturePage()).toPNG());
      const cleared = await uiView.webContents.executeJavaScript(`document.getElementById('bubble-picture-clear').click(); true`, true);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const drawnAgain = await bubbleWindow.webContents.executeJavaScript(`({
        shown: !document.getElementById('picture').hidden,
        drawn: !document.getElementById('mark').hidden,
      })`, true);
      record('bubble-avatar-cleared', JSON.stringify({ clicked: cleared, ...drawnAgain, stored: state.bubblePrefs.avatar.length }));
      if (drawnAgain.shown || !drawnAgain.drawn) throw new Error('the drawn face did not come back when the picture was cleared');
      if (state.bubblePrefs.avatar !== '') throw new Error('clearing the picture did not reach the settings');

      // 14. The spaces grid has to use the window it is given. Measured on 0.1.7 in a 1568px window: three
      //     cards sat in the first three of nine `auto-fill` tracks and the rest of the window stayed empty,
      //     because the tracks nothing landed in were still reserved. `auto-fit` collapses them, so this
      //     measures the cards at two window sizes and the row against the grid it lives in.
      await uiView.webContents.executeJavaScript(`document.querySelector('button[data-page="spaces"]').click(); true`, true);
      const measureGrids = async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return uiView.webContents.executeJavaScript(`[...document.querySelectorAll('.grid')].map((grid) => {
          const box = grid.getBoundingClientRect();
          const cards = [...grid.querySelectorAll('.card')].map((card) => card.getBoundingClientRect());
          return {
            cards: cards.length,
            cardWidth: cards.length ? Math.round(cards[0].width) : 0,
            rowWidth: cards.length ? Math.round(cards[cards.length - 1].right - box.left) : 0,
            gridWidth: Math.round(box.width),
          };
        })`, true);
      };
      shellWindow.setContentSize(1000, 700);
      const narrowGrid = await measureGrids();
      shellWindow.setContentSize(1860, 1000);
      const wideGrid = await measureGrids();
      record('spaces-grid-grows', JSON.stringify({ narrow: narrowGrid, wide: wideGrid }));
      if (!narrowGrid.length || !wideGrid.length) throw new Error('the spaces page has no grid to measure');
      if (wideGrid[0].cardWidth <= narrowGrid[0].cardWidth) {
        throw new Error(`the space cards did not grow with the window: ${narrowGrid[0].cardWidth} → ${wideGrid[0].cardWidth}`);
      }
      const unfilled = wideGrid.filter((grid) => grid.cards && grid.rowWidth / grid.gridWidth < 0.9);
      if (unfilled.length) throw new Error(`a wide window leaves the row unfilled: ${JSON.stringify(unfilled)}`);
      fs.writeFileSync(path.join(SMOKE_OUT, 'dashboard-wide.png'), (await uiView.webContents.capturePage()).toPNG());
      shellWindow.setContentSize(1280, 820);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    record('screenshots', SMOKE_OUT);
  }

  fs.writeFileSync(path.join(SMOKE_OUT, 'smoke.json'), JSON.stringify({ ok: true, steps, alerts: alerts.length }, null, 2));
  process.stdout.write(`SMOKE OK ${JSON.stringify(steps)}\n`);
}

if (singleInstance) app.whenReady().then(async () => {
  state = loadSettings();
  if (!SMOKE && !LIVE_CHECK) applyAutoStart(); // Verification must never change this machine's startup registration.
  registerIpc();
  // The operating system's light/dark switch is a live setting, so every window has to be told when it
  // changes: with the app set to "System colours", flipping Windows to dark used to leave every open
  // window painted in the old theme until something else happened to broadcast. One native event, and
  // all four surfaces (dashboard, bubble menu, reminder card, tray) re-read the same snapshot.
  nativeTheme.on('updated', () => { if (state) broadcast(); });
  createShellWindow();
  if (state.bubble) createBubble();
  createTray();
  if (!SMOKE || LIVE_CHECK) for (const id of state.loadedSlots) loadSpaceInBackground(id);

  if (SMOKE) {
    try {
      if (MONITOR_SMOKE) await require('./monitor-smoke.js')({
        app, shellWindow, uiView, spaceViews, monitors, retryTimers, SMOKE_OUT,
        configure: (id, url) => {
          state = spaces.enableSlot(state, id, { appId: 'custom', kind: 'social' });
          state = spaces.selectApp(state, id, 'custom', { kind: 'social' });
          state = spaces.setUrl(state, id, url);
          broadcast();
        },
        openSpace, closeSpace, stopSpace, loadSpaceInBackground, snapshot, saveSettings, loadSettings,
        notificationAttempts: () => notificationAttempts,
        notificationDiagnostics: () => ({ ...notificationDiagnostics }),
        mute: value => { state = { ...state, messageSound: !value }; },
      });
      else await smokeRun();
      app.exit(0);
    } catch (failure) {
      fs.mkdirSync(SMOKE_OUT, { recursive: true });
      fs.writeFileSync(path.join(SMOKE_OUT, 'smoke.json'), JSON.stringify({ ok: false, error: String(failure && failure.stack || failure), steps: SMOKE_STEPS }, null, 2));
      process.stdout.write(`SMOKE FAILED ${failure && failure.message}\n`);
      app.exit(1);
    }
    return;
  }

  if (!LIVE_CHECK) scheduleWatcher();
  if (SMOKE_ACTIVE) setTimeout(() => readAlertingSpaces(), 5_000);
  if (state.notesEnabled) {
    notesSyncGeneration += 1;
    await startNotesServer(notesSyncGeneration);
    scheduleNotesSync(0);
  }
  app.on('activate', () => { if (!shellWindow) createShellWindow(); });
});

app.on('before-quit', () => { app.isQuitting = true; if (notesServer) void notesServer.close(); if (state) saveSettings(); });
app.on('window-all-closed', () => { if (!SMOKE) app.quit(); });
