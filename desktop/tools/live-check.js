'use strict';

/* Live acceptance run for Bop Desktop. Uses an isolated profile and local fixtures only. */
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DESKTOP = path.join(__dirname, '..');
const OUT_ARG = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const APP_ARG = process.argv.includes('--app') ? process.argv[process.argv.indexOf('--app') + 1] : null;
const HTTP_PORT_ARG = process.argv.includes('--http-port') ? process.argv[process.argv.indexOf('--http-port') + 1] : null;
const CDP_PORT_ARG = process.argv.includes('--cdp-port') ? process.argv[process.argv.indexOf('--cdp-port') + 1] : null;
const WATCH_WAIT_ARG = process.argv.includes('--watch-wait') ? process.argv[process.argv.indexOf('--watch-wait') + 1] : null;
const OUT = path.resolve(OUT_ARG || process.env.BOP_LIVE_OUT || path.join(os.tmpdir(), 'bop-live-run'));
const USER_DATA = path.join(OUT, 'userdata');
const USER_DATA_FLAG = `--user-data-dir=${USER_DATA}`;
const KEEP = process.argv.includes('--keep');
const HTTP_PORT = Number(HTTP_PORT_ARG || process.env.BOP_LIVE_HTTP_PORT || 8791);
const CDP_PORT = Number(CDP_PORT_ARG || process.env.BOP_LIVE_CDP_PORT || 9333);
const WATCH_WAIT_MS = Number(WATCH_WAIT_ARG || process.env.BOP_LIVE_WATCH_WAIT_MS || 110000);
const ORIGIN = `http://127.0.0.1:${HTTP_PORT}`;
const ELECTRON = path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP = APP_ARG;
const DRAG_SCRIPT = path.join(__dirname, 'os-drag.ps1');

function pointer(args) {
  return spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DRAG_SCRIPT, ...args], { encoding: 'utf8' }).stdout.trim();
}
const steps = [];
function record(name, detail, ok = true) {
  steps.push({ name, detail, ok });
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}\n`);
}
async function step(name, run) {
  try { const detail = await run(); record(name, detail ?? 'done'); return { ok: true, detail }; }
  catch (failure) { record(name, String(failure?.message || failure), false); return { ok: false }; }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(label, probe, timeoutMs = 20000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms`);
}
async function targets() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  if (!response.ok) throw new Error(`devtools list failed: ${response.status}`);
  return response.json();
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
    });
    socket.addEventListener('error', () => reject(new Error('devtools socket error')));
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = ++nextId;
        return new Promise((done, fail) => { pending.set(id, { resolve: done, reject: fail }); socket.send(JSON.stringify({ id, method, params })); });
      },
      close() { socket.close(); },
    }));
  });
}
async function evaluate(target, expression, attempts = 6) {
  const where = `${target.url.split('/').pop()} · ${expression.replace(/\s+/g, ' ').slice(0, 70)}`;
  for (let attempt = 1; ; attempt += 1) {
    let client;
    try {
      client = await connect(target.webSocketDebuggerUrl);
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        const details = result.exceptionDetails;
        const description = details.exception?.description || details.text;
        const frames = (details.stackTrace?.callFrames || []).slice(0, 3)
          .map((frame) => `${frame.functionName || '<anonymous>'}@${frame.url}:${frame.lineNumber}`).join(' <- ');
        throw new Error(`${description}${frames ? ` [${frames}]` : ''}`);
      }
      return result.result.value;
    } catch (failure) {
      const retryable = /context was destroyed|Cannot find context/i.test(String(failure.message));
      if (attempt >= attempts || !retryable) throw new Error(`${failure.message} (${where})`);
    } finally { if (client) client.close(); }
    await sleep(300);
  }
}
async function screenshot(target, file) {
  const client = await connect(target.webSocketDebuggerUrl);
  try { const result = await client.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(result.data, 'base64')); }
  finally { client.close(); }
}
const BOARD_URL = `${ORIGIN}/board.html`;
const CHAT_URL = `${ORIGIN}/chat.html`;
const SPACE_D_LABEL = 'Live chat';
const boardPage = '<!doctype html><html><head><meta charset="utf-8"/><title>Live board</title></head><body><h1>Studies</h1><div id="list">1 study available</div></body></html>';
const chatPage = '<!doctype html><html><head><meta charset="utf-8"/><title>Live chat</title></head><body><h1>Live chat</h1><p>Fixture for title and notification events.</p></body></html>';
function startServer() {
  const server = http.createServer((request, response) => {
    const page = request.url.startsWith('/board') ? boardPage : request.url.startsWith('/chat') ? chatPage : null;
    if (!page) { response.writeHead(404); response.end('not found'); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(page);
  });
  return new Promise((resolve, reject) => { server.on('error', reject); server.listen(HTTP_PORT, '0.0.0.0', () => resolve(server)); });
}
function writeProfile(userData) {
  fs.mkdirSync(userData, { recursive: true });
  const watch = { enabled: false, minutes: 1, selector: '', require: '', ignore: '', fingerprint: null, lastCheckAt: 0, lastChangeAt: 0, failures: 0 };
  const space = (id, label, appId, kind, url, patch, enabled = false) => ({ id, label, appId, kind, url, enabled, phoneLayout: kind === 'tasks', watch: { ...watch, ...(patch || {}) } });
  const state = {
    version: 4,
    spaces: [space('A', 'Account A', 'messenger', 'social', '', null), space('B', 'Account B', 'messenger', 'social', '', null),
      space('C', 'Live board', 'custom', 'tasks', BOARD_URL, { enabled: true, minutes: 1, selector: '#list' }, true),
      space('D', 'Live chat', 'custom', 'social', CHAT_URL, null, true)],
    slots: ['A', 'B', 'C', 'D'], loadedSlots: ['C', 'D'], theme: 'system', bubble: true,
    notes: [], notesEnabled: true, notesToken: '1234567890abcdef'.repeat(4),
    // Keep the acceptance bubble away from an already-running Bop user's always-on-top bubble.
    bubblePrefs: { size: 64, opacity: 100, doubleClick: 'menu', overFullscreen: true, spotX: 0.72, spotY: 0.35 },
    watchWhileRunning: true, messageSound: true, monitorState: {},
  };
  state.slots = ['A', 'B', 'C', 'D'];
  state.loadedSlots = ['C', 'D'];
  state.notesEnabled = true;
  state.notesToken = '1234567890abcdef'.repeat(4);
  fs.writeFileSync(path.join(userData, 'bop-settings.bin'), Buffer.concat([Buffer.from('BOP0'), Buffer.from(JSON.stringify(state))]));
  return state;
}
function launch(userData) {
  const args = [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userData}`, '--bop-live-check', '--bop-out', OUT];
  const command = APP ? path.resolve(DESKTOP, APP) : ELECTRON;
  if (!APP) args.unshift('.');
  const child = spawn(command, args, { cwd: DESKTOP, env: { ...process.env,
    BOP_LIVE_USER_DATA: userData,
    BOP_LIVE_SETTINGS: path.join(userData, 'bop-settings.bin'),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(OUT, 'launch.log'));
  child.stdout.pipe(log); child.stderr.pipe(log);
  child.on('exit', (code) => log.write(`\n[electron exited with ${code}]\n`));
  return child;
}
function targetFor(list, predicate) { return list.find((target) => target.type === 'page' && predicate(target.url)); }
async function windowTarget(suffix) { return targetFor(await targets(), (url) => url.endsWith(suffix)) || null; }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userData = USER_DATA;
  if (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true).catch(() => false)) {
    record('port-free', `something is already listening on ${CDP_PORT}; choose another --cdp-port`, false);
    process.exitCode = 1; return;
  }
  const server = await startServer();
  writeProfile(userData);
  const child = launch(userData);
  let ok = false;
  const dashboardTarget = async () => {
    const target = targetFor(await targets(), (url) => url.endsWith('/renderer/index.html'));
    if (!target) throw new Error('dashboard window is gone');
    await until('dashboard ready', async () => evaluate(target, 'document.readyState === "complete" && !!document.querySelector(".shell")').catch(() => false), 20000, 200);
    return target;
  };
  const spaceTarget = async (part) => {
    const target = await until(`space ${part}`, async () => targetFor(await targets(), (url) => url.includes(part)), 30000, 250);
    await until(`document ${part} committed`, async () => {
      const value = await evaluate(target, '({ href: location.href, ready: document.readyState })').catch(() => null);
      return value && value.href.includes(part) && value.ready === 'complete';
    }, 30000, 200);
    return target;
  };
  try {
    await until('isolated profile exists', () => fs.existsSync(path.join(userData, 'bop-settings.bin')), 10000, 100);
    const list = await until('app dashboard', async () => {
      const value = await targets().catch(() => []);
      const dashboard = targetFor(value, (url) => url.endsWith('/renderer/index.html'));
      if (dashboard) return value;
      const child = await targets().catch(() => []);
      const childDashboard = targetFor(child, (url) => url.endsWith('/renderer/index.html'));
      return childDashboard ? child : null;
    }, APP ? 90000 : 45000);
    record('app-started', `${APP || 'source tree'} · ${list.length} targets`);

    await step('dashboard-ipc', async () => {
      const snapshot = await evaluate(await dashboardTarget(), 'window.bop.snapshot()');
      const ids = snapshot.enabled.map((space) => space.id).join(',');
      if (ids !== 'A,B,C,D' || !snapshot.bubble || !snapshot.notesUiEnabled) throw new Error(`fixture spaces, bubble, or notes did not survive startup: ${JSON.stringify({ ids, bubble: snapshot.bubble, notesUiEnabled: snapshot.notesUiEnabled, diskError: snapshot.diskError })}`);
      return JSON.stringify({ spaces: snapshot.enabled.map((space) => space.id), notesUiEnabled: snapshot.notesUiEnabled, encryption: snapshot.encryption });
    });

    await step('notes-ui', async () => {
      const dashboard = await dashboardTarget();
      await evaluate(dashboard, 'window.bop.openNotes()');
      const notes = await until('notes window', () => windowTarget('/renderer/notes.html'), 15000);
      await until('notes document ready', () => evaluate(notes, 'document.readyState === "complete" && !!document.getElementById("note-form")').catch(() => false), 15000, 200);
      const before = await evaluate(notes, 'window.bop.notes.snapshot()');
      if (typeof await evaluate(notes, 'typeof window.bop.notes.snapshot') !== 'string' || !before.notesSync.pairingCode.startsWith('BOPNOTES1:')) throw new Error('notes bridge or pairing UI missing');
      await evaluate(notes, `document.getElementById('note-text').value = 'live quick note'; document.getElementById('note-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); true`);
      const note = await until('saved note', () => evaluate(notes, 'window.bop.notes.snapshot().then(s => s.notes.find(n => n.text === "live quick note") || null)'), 8000, 200);
      if (!note || note.sender !== 'Desktop') throw new Error('notes UI did not save a desktop note');
      const deletion = await evaluate(notes, `window.bop.notes.remove("${note.id}")`);
      if (!deletion.ok) throw new Error(deletion.error || 'notes UI could not delete the note');
      const deleted = await until('deleted note', () => evaluate(notes, `window.bop.notes.snapshot().then(s => !s.notes.some(n => n.id === "${note.id}"))`), 8000, 200);
      return JSON.stringify({ note: note.sender, deleted, pairing: before.notesSync.pairingCode.slice(0, 24) });
    });

    await step('bubble-window', async () => {
      const target = await until('bubble window', () => windowTarget('/renderer/bubble.html'), 20000);
      // The bubble is on screen before it is listening: its own script attaches the pointer handlers and
      // finishes by rendering the first snapshot, so a title on the core button is the proof that a
      // gesture will be received. Without this wait a cold portable launch — the slowest kind, because
      // the launcher unpacks the app first — lost the whole drag measured once on this machine.
      await until('bubble ready for a gesture', async () => {
        const ready = await evaluate(target, 'document.readyState === "complete" && !!(document.getElementById("core") || {}).title').catch(() => false);
        return ready === true;
      }, 20000, 200);
      const bounds = await evaluate(target, '({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight })');
      if (bounds.width !== 64 || bounds.height !== 64 || bounds.x < 0 || bounds.y < 0) throw new Error(`bubble bounds invalid: ${JSON.stringify(bounds)}`);
      await screenshot(target, path.join(OUT, 'bubble.png')); return JSON.stringify(bounds);
    });

    await step('bubble-drag-pointer', async () => {
      const target = await windowTarget('/renderer/bubble.html');
      const cursorAtStart = pointer(['-Query']);
      const delta = { x: 220, y: 130 };
      let before = null;
      let after = null;
      let grab = null;       // the pointer-to-window offset the grab was made with
      let wanted = null;     // where the hand actually ended, so the window must be exactly that far along
      let moved = 0;
      // The gesture is the operating system's own pointer, which is the only way to prove a window drag.
      // A freshly written EXE can swallow the very first one — measured twice on this machine, on the first
      // launch after a build, while every CDP-driven step around it passed — so the same gesture is
      // repeated a bounded number of times, with the same requirement each time it is sent.
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        before = await evaluate(target, '({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight })');
        // The center is the button, not a drag surface; grab the rim as an actual user would.
        const press = { x: Math.round(before.x + 5), y: Math.round(before.y + before.h / 2) };
        pointer(['-X1', String(press.x), '-Y1', String(press.y), '-X2', String(press.x + delta.x), '-Y2', String(press.y + delta.y)]);
        await sleep(600);
        after = await evaluate(target, '({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight })');
        moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
        // The hand, not the request, is the truth: the injected pointer is delivered in steps and the last
        // step Chromium processes can be a fraction of one short, so the window is compared with where the
        // pointer really ended. "One point in, one point out" is the property this asserts.
        const [handX, handY] = pointer(['-Query']).split(',').map(Number);
        grab = { x: press.x - before.x, y: press.y - before.y };
        wanted = { x: handX - grab.x, y: handY - grab.y };
        if (moved > 50 && Math.abs(after.x - wanted.x) + Math.abs(after.y - wanted.y) <= 4) break;
      }
      try {
        if (after.w !== before.w || after.h !== before.h) throw new Error(`the drag changed the bubble size ${JSON.stringify({ before, after })}`);
        if (moved <= 50) throw new Error(`the bubble did not follow the pointer at all ${JSON.stringify({ before, after })}`);
        const offBy = Math.abs(after.x - wanted.x) + Math.abs(after.y - wanted.y);
        if (offBy > 4) throw new Error(`the bubble is not under the hand that dropped it: ${JSON.stringify({ before, after, wanted, grab, offBy })}`);
        const dashboard = await dashboardTarget();
        const prefs = await evaluate(dashboard, 'window.bop.snapshot().then(s => s.bubblePrefs)');
        const area = await evaluate(dashboard, '({ left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight })');
        const spot = { x: Math.round(area.left + prefs.spotX * area.width), y: Math.round(area.top + prefs.spotY * area.height) };
        if (Math.abs(spot.x - after.x) > 3 || Math.abs(spot.y - after.y) > 3) throw new Error(`dragged bubble spot was not persisted ${JSON.stringify({ spot, after })}`);
        await screenshot(target, path.join(OUT, 'bubble-dragged.png'));
        return JSON.stringify({ before, after, hand: wanted, grab, spot });
      } finally {
        // Give the user's pointer back exactly where this run found it.
        const [startX, startY] = cursorAtStart.split(',').map(Number);
        if (Number.isFinite(startX) && Number.isFinite(startY)) pointer(['-MoveTo', '-X1', String(startX), '-Y1', String(startY)]);
      }
    });

    await step('space-loaded', async () => {
      const target = await spaceTarget('/chat.html');
      const probe = await evaluate(target, '({ url: location.href, bridge: typeof window.__bopNotify, permission: Notification.permission })');
      if (!probe.url.includes(String(HTTP_PORT)) || probe.bridge !== 'function' || probe.permission !== 'granted') throw new Error(JSON.stringify(probe));
      return JSON.stringify(probe);
    });
    await step('web-notification', async () => {
      const raised = await evaluate(await spaceTarget('/chat.html'), `(() => { const n = new Notification('Live check', { body:'hello from the page', tag:'live-1' }); return { body:n.body, silent:n.silent }; })()`);
      const alert = await until('web notification alert', async () => (await evaluate(await dashboardTarget(), 'window.bop.snapshot()')).alerts.find((item) => item.kind === 'web' && item.spaceId === 'D'), 15000);
      const card = await until('reminder card', () => windowTarget('/renderer/alert.html'), 15000);
      const text = await until('reminder contents', () => evaluate(card, 'document.getElementById("card")?.innerText.replace(/\\s+/g," ").trim()').catch(() => ''), 15000, 200);
      if (!text.includes(SPACE_D_LABEL) || !text.includes('hello from the page')) throw new Error(text);
      await screenshot(card, path.join(OUT, 'card.png'));
      return JSON.stringify({ raised, title: alert.title, card: text.slice(0, 100) });
    });
    await step('title-unread', async () => {
      await evaluate(await spaceTarget('/chat.html'), 'document.title = "(3) Live chat"; true');
      const alert = await until('unread title alert', async () => (await evaluate(await dashboardTarget(), 'window.bop.snapshot()')).alerts.find((item) => item.tag === 'unread' && item.spaceId === 'D'), 15000);
      return JSON.stringify({ title: alert.title, body: alert.body });
    });

    await step('watch-scheduled', async () => {
      // Configure the isolated fixture first, baseline from its DOM reader, then update the SPA in place.
      // We expire this fixture's baseline to exercise the real ordinary scheduler in this test run.
      await evaluate(await dashboardTarget(), 'window.bop.setPreference("watchWhileRunning", false)');
      await evaluate(await dashboardTarget(), 'window.bop.setWatch("C", { enabled: true, lastCheckAt: 0, fingerprint: null })');
      await evaluate(await dashboardTarget(), 'window.bop.setPreference("watchWhileRunning", true)');
      const baseline = await until('watcher baseline', async () => {
        const snapshot = await evaluate(await dashboardTarget(), 'window.bop.snapshot()');
        return snapshot.spaces.find((space) => space.id === 'C').watch.fingerprint || null;
      }, 30000);
      await evaluate(await dashboardTarget(), 'window.bop.setPreference("watchWhileRunning", false)');
      await evaluate(await dashboardTarget(), 'window.bop.setWatch("C", { lastCheckAt: 0 })');
      await evaluate(await spaceTarget('/board.html'), 'document.getElementById("list").textContent = "2 studies available"; true');
      const changeTime = Date.now();
      await evaluate(await dashboardTarget(), 'window.bop.setPreference("watchWhileRunning", true)');
      await evaluate(await dashboardTarget(), 'window.bop.setWatch("C", { enabled: true, lastCheckAt: 0 })');
      const alerted = await until('scheduled page change alert', async () => {
        const snapshot = await evaluate(await dashboardTarget(), 'window.bop.snapshot()');
        const item = snapshot.alerts.find((alert) => alert.kind === 'watch' && alert.spaceId === 'C');
        return item && item.at >= changeTime ? item : null;
      }, WATCH_WAIT_MS, 250);
      if (alerted.body !== '2 studies available') throw new Error(`unexpected card body ${alerted.body}`);
      return JSON.stringify({ baseline: baseline.slice(0, 8), body: alerted.body });
    });

    await step('alerts-page', async () => {
      const target = await dashboardTarget();
      await evaluate(target, 'document.querySelector(\'button[data-page="alerts"]\').click(); true');
      await sleep(500);
      const page = await evaluate(target, `(() => { const rows=Array.from(document.querySelectorAll('.alert')).map(row=>row.querySelector('.row-title').textContent); return { rows, summary:document.querySelector('.section-title span').textContent }; })()`);
      const expected = ['Live chat · Live check', 'Live chat · unread increased', 'Live board changed'];
      const missing = expected.filter((value) => !page.rows.includes(value));
      if (missing.length) throw new Error(`missing ${JSON.stringify(missing)} from ${JSON.stringify(page.rows)}`);
      await screenshot(target, path.join(OUT, 'alerts.png')); return JSON.stringify(page);
    });

    await step('bubble-badge', async () => {
      const target = targetFor(await targets(), (url) => url.endsWith('/renderer/bubble.html'));
      const badge = await evaluate(target, '({ hidden: document.getElementById("badge").hidden, text: document.getElementById("badge").textContent })');
      if (badge.hidden || Number(badge.text) < 3) throw new Error(JSON.stringify(badge));
      return JSON.stringify(badge);
    });

    const tickRate = async (target, ms) => {
      await evaluate(target, '(() => { window.__bopTicks=0; window.__bopTimer=setInterval(()=>window.__bopTicks+=1,100); return true; })()');
      await sleep(ms);
      return evaluate(target, '(() => { clearInterval(window.__bopTimer); return { ticks:window.__bopTicks, state:document.visibilityState, hidden:document.hidden }; })()');
    };
    await step('pane-unthrottled-when-open', async () => {
      const dashboard = await dashboardTarget(); await evaluate(dashboard, 'window.bop.openSpace("C")'); await sleep(1200);
      const open = await evaluate(dashboard, 'window.bop.snapshot().then(s=>s.enabled.filter(v=>v.open).map(v=>v.id))');
      const pane = await tickRate(await spaceTarget('/board.html'), 2000);
      if (open.join(',') !== 'C' || pane.ticks < 15) throw new Error(JSON.stringify({ open, pane }));
      return JSON.stringify({ open, pane });
    });
    await step('background-pane-unthrottled', async () => {
      await evaluate(await dashboardTarget(), 'window.bop.closeSpace()'); await sleep(800);
      const pane = await tickRate(await spaceTarget('/board.html'), 2000);
      if (pane.ticks < 15) throw new Error(JSON.stringify(pane)); return JSON.stringify(pane);
    });
    await step('nav-switch-while-open', async () => {
      const dashboard = await dashboardTarget(); await evaluate(dashboard, 'window.bop.openSpace("C")'); await sleep(1000);
      await evaluate(dashboard, 'document.querySelector(\'button[data-page="settings"]\').click(); true'); await sleep(700);
      const page = await evaluate(dashboard, `({ page:document.querySelector('.nav button[aria-current="true"]').dataset.page, open:document.body.classList.contains('space-open'), text:document.querySelector('.main').innerText.slice(0,40) })`);
      const snapshot = await evaluate(dashboard, 'window.bop.snapshot()');
      const paneText = await evaluate(await spaceTarget('/board.html'), 'document.getElementById("list").textContent');
      if (page.page !== 'settings' || page.open || !page.text.includes('Settings') || snapshot.enabled.some((space) => space.open) || !paneText) throw new Error(JSON.stringify({ page, paneText }));
      await screenshot(dashboard, path.join(OUT, 'settings-while-space-open.png')); return JSON.stringify({ page, paneText });
    });
    await step('tray-and-dashboard', async () => {
      const state = await evaluate(await dashboardTarget(), 'window.bop.snapshot()');
      if (!state.tray || !state.dashboardVisible) throw new Error(JSON.stringify({ tray: state.tray, dashboardVisible: state.dashboardVisible }));
      return JSON.stringify({ tray: state.tray, dashboardVisible: state.dashboardVisible, packaged: state.packaged });
    });
    await step('start-at-login-plan', async () => {
      const state = await evaluate(await dashboardTarget(), 'window.bop.snapshot()');
      if (!state.packaged) {
        if (state.autoStart.registered) throw new Error('source run registered Electron in startup');
        return 'source run correctly avoids startup registration';
      }
      // Login-item settings write to this Windows user profile, outside the isolated test data directory.
      // Do not toggle or overwrite a real Bop startup entry during acceptance; verify the portable launch
      // and default plan here, while autostart.test.js covers the target path and flag without OS writes.
      if (!state.autoStart.portable) return 'packaged app verified; portable launcher environment is absent, so OS startup was left untouched';
      if (!state.autoStart.supported || !state.autoStart.wanted || state.startAtLogin !== true) {
        throw new Error(`portable startup preference is not enabled: ${JSON.stringify({ autoStart: state.autoStart, startAtLogin: state.startAtLogin })}`);
      }
      return 'portable launcher detected; startup preference is enabled and OS startup was left untouched';
    });
    ok = steps.every((item) => item.ok);
  } catch (failure) { record('run', failure.stack || String(failure), false); }
  finally {
    if (!KEEP) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    server.close();
    fs.writeFileSync(path.join(OUT, 'live-check.json'), JSON.stringify({ ok, steps }, null, 2));
    process.stdout.write(`${ok ? 'LIVE CHECK OK' : 'LIVE CHECK FAILED'} · ${steps.filter((item) => !item.ok).length} failed · report ${path.join(OUT, 'live-check.json')}\n`);
    process.exitCode = ok ? 0 : 1;
  }
}
main();
