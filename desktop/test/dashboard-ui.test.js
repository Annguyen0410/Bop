'use strict';

/**
 * The live-page control on the real dashboard, in a real DOM.
 *
 * These few strings are the only place a user meets the memory policy: if the settings card stops drawing
 * the button set, or a click stops reaching the main process, the policy might as well not exist. jsdom
 * runs `app.js` exactly as the window does — [notes-ui.test.js] takes the same approach for the notes view.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const renderer = path.join(__dirname, '..', 'src', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');

function space(id, extra) {
  return {
    id,
    label: `Account ${id}`,
    appId: 'facebook',
    kind: 'social',
    url: 'https://www.facebook.com/messages/',
    phoneLayout: false,
    watch: { enabled: false, minutes: 5, selector: '', require: '', quiet: '', lastCheckAt: 0, fingerprint: '' },
    accent: '#4267b2',
    hosts: ['www.facebook.com'],
    openable: true,
    openError: null,
    pending: 0,
    open: false,
    loaded: false,
    sleeping: false,
    monitoring: 'not-loaded',
    unread: null,
    notificationStatus: null,
    browserNote: null,
    ...extra,
  };
}

function snapshot(overrides) {
  return {
    spaces: [],
    notes: [],
    slots: ['A', 'B', 'C', 'D'],
    notesSync: { enabled: false, running: false, error: null, token: '', port: 38671, addresses: [], pairingCode: '', lastSyncAt: 0, localDirty: false },
    enabled: [space('A'), space('B', { kind: 'tasks' }), space('C'), space('D')],
    alerts: [],
    theme: 'system',
    bubble: true,
    bubblePrefs: { size: 64, opacity: 1, doubleClick: 'menu', overFullscreen: false, avatar: '' },
    bubbleAvatar: '',
    bubbleSizes: [48, 64, 80],
    bubbleDoubleClick: ['menu', 'toggle'],
    defaultPhoneLayout: false,
    watchWhileRunning: true,
    messageSound: true,
    keepPagesAlive: true,
    startAtLogin: true,
    liveLimit: 5,
    liveLimits: [3, 5, 8, 0],
    sleeping: [],
    notesUiEnabled: false,
    notesSyncRunning: false,
    autoStart: { wanted: true, supported: true, registered: true, portable: false, error: null },
    tray: true,
    dashboardVisible: true,
    startedAtLogin: false,
    packaged: true,
    diskError: null,
    encryption: true,
    apps: [{ id: 'facebook', label: 'Facebook', kind: 'social' }],
    versions: { app: '0.2.1', electron: '31.0.0', chrome: '126.0.0', platform: 'win32 x64', os: '10.0', partitionPrefix: 'persist:bop-' },
    ...overrides,
  };
}

async function loadDashboard(state) {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(html, { url: 'file:///index.html', runScripts: 'outside-only', virtualConsole });
  const preferences = [];
  const deleted = [];
  const added = [];
  const hostAnswers = [];
  let hostHandler = null;
  const bridge = new Proxy({}, {
    // Every bridge call answers like the real one: a promise. The few the tests care about are recorded.
    get: (_target, key) => {
      if (key === 'snapshot') return async () => state;
      if (key === 'setPreference') return async (name, value) => { preferences.push([name, value]); return { ok: true }; };
      if (key === 'deleteSpace') return async (id) => { deleted.push(id); return { ok: true }; };
      if (key === 'addSpace') return async (request) => { added.push(request); return { ok: true, id: 'C' }; };
      if (key === 'respondHostPermission') return async (requestId, allow) => { hostAnswers.push([requestId, allow]); return { ok: true }; };
      if (key === 'onHostRequest') return (handler) => { hostHandler = handler; };
      if (key === 'onChanged' || key === 'onFocusSpace' || key === 'onReminder') return () => {};
      return async () => ({ ok: true });
    },
  });
  dom.window.bop = bridge;
  dom.window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  dom.window.eval(script);
  await settle();
  return { dom, preferences, deleted, added, hostAnswers, host: (request) => hostHandler(request), errors };
}

async function settle() {
  for (let tick = 0; tick < 8; tick += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** The page the dashboard is showing; `nav` buttons switch it exactly as a click would. */
async function show(dom, name) {
  dom.window.document.querySelector(`button[data-page="${name}"]`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await settle();
}

function click(dom, selector) {
  const button = dom.window.document.querySelector(selector);
  assert.ok(button, `the dashboard did not draw ${selector}`);
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

test('the live-page control offers every limit and marks the one in force', async () => {
  const { dom, errors } = await loadDashboard(snapshot({ liveLimit: 3, sleeping: ['A', 'B'] }));
  try {
    await show(dom, 'settings');
    const limits = [...dom.window.document.querySelectorAll('[data-live-limit]')].map((button) => button.dataset.liveLimit);
    assert.deepStrictEqual(limits, ['3', '5', '8', '0']);
    assert.strictEqual(dom.window.document.querySelector('[data-live-limit="3"]').className, 'primary');
    assert.strictEqual(dom.window.document.querySelector('[data-live-limit="5"]').className, 'ghost');
    // The choice has to be readable, not just clickable: which pages are asleep right now.
    assert.match(dom.window.document.getElementById('main').textContent, /3 at a time · A, B asleep/);
    assert.deepStrictEqual(errors, []);
  } finally {
    dom.window.close();
  }
});

test('choosing a limit sends it to the main process', async () => {
  const { dom, preferences, errors } = await loadDashboard(snapshot({ liveLimit: 5 }));
  try {
    await show(dom, 'settings');
    click(dom, '[data-live-limit="3"]');
    await settle();
    assert.deepStrictEqual(preferences, [['liveLimit', 3]]);
    assert.deepStrictEqual(errors, []);
  } finally {
    dom.window.close();
  }
});

test('cache budget is visible and changing it sends the selected bounded value', async () => {
  const { dom, preferences, errors } = await loadDashboard(snapshot({ cacheBudgetMb: 512, cacheUsageMb: 80 }));
  try {
    await show(dom, 'settings');
    assert.match(dom.window.document.getElementById('main').textContent, /80 MB \/ 512 MB/);
    assert.strictEqual(dom.window.document.querySelector('[data-cache-budget="512"]').className, 'primary');
    click(dom, '[data-cache-budget="256"]');
    await settle();
    assert.deepStrictEqual(preferences, [['cacheBudgetMb', 256]]);
    assert.deepStrictEqual(errors, []);
  } finally {
    dom.window.close();
  }
});

test('an extra space can be deleted from its card, after a confirmation that names it', async () => {
  const { dom, deleted, errors } = await loadDashboard(snapshot({
    enabled: [space('A'), space('B'), space('C', { label: 'Duplicate panel', kind: 'tasks' }), space('D')],
  }));
  try {
    // The two starter spaces never offer deletion.
    assert.strictEqual(dom.window.document.querySelector('[data-delete="A"]'), null);
    assert.strictEqual(dom.window.document.querySelector('[data-delete="B"]'), null);
    click(dom, '[data-delete="C"]');
    await settle();
    const modal = dom.window.document.getElementById('modal-root');
    assert.match(modal.textContent, /Delete Duplicate panel\?/);
    assert.match(modal.textContent, /cookies, cache and saved login/);
    click(dom, '#delete-confirm');
    await settle();
    assert.deepStrictEqual(deleted, ['C']);
    assert.deepStrictEqual(errors, []);
  } finally {
    dom.window.close();
  }
});

test('AI accounts have their own section and the picker creates an AI space', async () => {
  const { dom, added, errors } = await loadDashboard(snapshot({
    enabled: [
      space('A'), space('B'),
      space('C', { appId: 'chatgpt', kind: 'ai', label: 'ChatGPT personal', accent: '#10a37f' }),
    ],
    apps: [
      { id: 'facebook', label: 'Facebook', kind: 'social' },
      { id: 'chatgpt', label: 'ChatGPT', kind: 'ai' },
      { id: 'claude', label: 'Claude', kind: 'ai' },
      { id: 'gemini', label: 'Gemini', kind: 'ai' },
    ],
  }));
  try {
    const main = dom.window.document.getElementById('main').textContent;
    assert.match(main, /AI accounts/);
    assert.match(main, /1 AI/);
    click(dom, '#hero-add');
    await settle();
    click(dom, '[data-kind="ai"]');
    await settle();
    const modal = dom.window.document.getElementById('modal-root');
    assert.match(modal.textContent, /One space is one AI login/);
    assert.match(modal.textContent, /ChatGPT/);
    assert.match(modal.textContent, /Gemini/);
    click(dom, '[data-app="chatgpt"]');
    await settle();
    assert.deepStrictEqual(added.map((request) => ({ appId: request.appId, kind: request.kind })),
      [{ appId: 'chatgpt', kind: 'ai' }]);
    assert.deepStrictEqual(errors, []);
  } finally {
    dom.window.close();
  }
});

test('a blocked sign-in host is asked about, and the answer is sent back to main', async () => {
  const { dom, host, hostAnswers, errors } = await loadDashboard(snapshot());
  try {
    host({ requestId: 'request-1', spaceId: 'C', label: 'Studies', host: 'accounts.google.com',
      url: 'https://accounts.google.com/o/oauth2/auth', reason: 'sign-in page' });
    await settle();
    const modal = dom.window.document.getElementById('modal-root');
    assert.match(modal.textContent, /Allow accounts\.google\.com\?/);
    assert.match(modal.textContent, /Studies is trying to open its sign-in page/);
    // The dialog has to be raised above the space panes while it is up; this is the same switch the
    // edit and watch dialogs use.
    assert.match(modal.textContent, /does not\s+open that site for any other space/);
    click(dom, '#host-allow');
    await settle();
    assert.deepStrictEqual(hostAnswers, [['request-1', true]]);
    assert.strictEqual(dom.window.document.querySelector('#modal-root .modal'), null);
    assert.deepStrictEqual(errors, []);
  } finally {
    dom.window.close();
  }
});

test('a sleeping space says so instead of reading like an account that was never opened', async () => {
  const { dom, errors } = await loadDashboard(snapshot({
    liveLimit: 3,
    sleeping: ['B'],
    enabled: [space('A', { loaded: true, open: true, monitoring: 'watching' }), space('B', { sleeping: true }), space('C'), space('D')],
  }));
  try {
    const text = dom.window.document.getElementById('main').textContent;
    assert.match(text, /Asleep: its sign-in and cookies are kept/);
    // And the ordinary wording is untouched for the spaces that are simply not open.
    assert.match(text, /Open once to resume monitoring with saved session cookies\./);
    assert.deepStrictEqual(errors, []);
  } finally {
    dom.window.close();
  }
});
