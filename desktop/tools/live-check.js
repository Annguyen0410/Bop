'use strict';

/*
 * Live check: the app as a user runs it.
 *
 * The smoke run (`--bop-smoke`) proves the machinery with fixture pages and its own isolated profile.
 * This runs the *normal* startup path instead — no smoke flag, a real Chromium profile under a scratch
 * `--user-data-dir`, real `http://127.0.0.1` pages — and then looks at what a person would see, through
 * the app's own DevTools endpoint:
 *
 *   - the dashboard window answers its own preload IPC,
 *   - the bubble window is on screen at the configured size,
 *   - a page's own `new Notification(...)` reaches the alert list and draws Bop's card,
 *   - an unread increase in the tab title reaches the alert list,
 *   - a watched page that changes *in place* raises a card on the watcher's own timer.
 *
 * Every step is recorded; a failing step does not stop the rest, so one run reports everything that is
 * broken rather than only the first thing. Exit code is 0 only when all steps pass.
 *
 *   node tools/live-check.js
 *   node tools/live-check.js --out D:/bop-dev/live-run --keep   (leave the app running)
 */

const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DESKTOP = path.join(__dirname, '..');
const OUT = valueAfter('--out') || process.env.BOP_LIVE_OUT || path.join(os.tmpdir(), 'bop-live-run');
const KEEP = process.argv.includes('--keep');
const HTTP_PORT = Number(valueAfter('--http-port') || process.env.BOP_LIVE_HTTP_PORT || 8791);
const CDP_PORT = Number(valueAfter('--cdp-port') || process.env.BOP_LIVE_CDP_PORT || 9333);
const WATCH_WAIT_MS = Number(valueAfter('--watch-wait') || 110000);
const ORIGIN = `http://127.0.0.1:${HTTP_PORT}`;
const ELECTRON = path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron.exe');
// A packaged build is what a user actually runs, so the harness can be pointed at one. Without it the
// source tree is launched with `electron .`, which is the faster loop while developing.
const APP = valueAfter('--app');

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const DRAG_SCRIPT = path.join(__dirname, 'os-drag.ps1');

/** Drives the machine's own pointer for the drag step. See os-drag.ps1 for why a synthetic event cannot
 *  stand in for it. */
function pointer(args) {
  return spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DRAG_SCRIPT, ...args], { encoding: 'utf8' }).stdout.trim();
}

const steps = [];
function record(name, detail, ok = true) {
  steps.push({ name, detail, ok });
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}\n`);
}

/** Runs one check; a thrown error is recorded as a failed step instead of ending the run. */
async function step(name, run) {
  try {
    const detail = await run();
    record(name, detail === undefined ? 'done' : detail, true);
    return { ok: true, detail };
  } catch (failure) {
    record(name, String((failure && failure.message) || failure), false);
    return { ok: false };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, probe, timeoutMs = 20000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms${last === undefined ? '' : ''}`);
}

// ---------------------------------------------------------------------------------------------
// DevTools protocol
// ---------------------------------------------------------------------------------------------
async function targets() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  if (!response.ok) throw new Error(`devtools list failed: ${response.status}`);
  return response.json();
}

function connect(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    });
    socket.addEventListener('error', () => reject(new Error('devtools socket error')));
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        nextId += 1;
        const id = nextId;
        return new Promise((done, fail) => {
          pending.set(id, { resolve: done, reject: fail });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { socket.close(); },
    }));
  });
}

/**
 * Evaluates in a target's main world and returns the value. Detaches again so nothing leaks.
 *
 * A context that is still committing reports "Execution context was destroyed", which is a moment in
 * the page's life rather than a broken app, so that one is retried.
 */
async function evaluate(target, expression, attempts = 6) {
  const where = `${target.url.split('/').pop()} · ${expression.replace(/\s+/g, ' ').slice(0, 70)}`;
  for (let attempt = 1; ; attempt += 1) {
    let client = null;
    try {
      client = await connect(target.webSocketDebuggerUrl);
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        const details = result.exceptionDetails;
        const description = (details.exception && details.exception.description) || details.text;
        const frames = ((details.stackTrace && details.stackTrace.callFrames) || [])
          .slice(0, 3).map((frame) => `${frame.functionName || '<anonymous>'}@${frame.url}:${frame.lineNumber}`).join(' <- ');
        throw new Error(`${description}${frames ? ` [${frames}]` : ''}`);
      }
      return result.result.value;
    } catch (failure) {
      const retryable = /context was destroyed|Cannot find context/i.test(String(failure.message));
      if (attempt >= attempts || !retryable) throw new Error(`${failure.message} (${where})`);
    } finally {
      if (client) client.close();
    }
    await sleep(300);
  }
}

async function screenshot(target, file) {
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    const result = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  } catch (failure) {
    throw new Error(`screenshot of ${target.url.split('/').pop()} failed: ${failure.message}`);
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------
const BOARD_URL = `${ORIGIN}/board.html`;
const CHAT_URL = `${ORIGIN}/chat.html`;
const SPACE_D_LABEL = 'Live chat'; // The card names the space, so the assertion has to use the real label.

const boardPage = '<!doctype html><html><head><meta charset="utf-8" /><title>Live board</title></head>'
  + '<body><h1>Studies</h1><div id="list">1 study available</div></body></html>';
const chatPage = '<!doctype html><html><head><meta charset="utf-8" /><title>Live chat</title></head>'
  + '<body><h1>Live chat</h1><p>This page exists so the title and the Notification API can be driven.</p></body></html>';

function startServer() {
  const server = http.createServer((request, response) => {
    const page = request.url.startsWith('/board') ? boardPage : request.url.startsWith('/chat') ? chatPage : null;
    if (!page) { response.writeHead(404); response.end('not found'); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(HTTP_PORT, '127.0.0.1', () => resolve(server));
  });
}

/** The profile the app is pointed at: a real one, written in the file format the app reads. */
function writeProfile(userData) {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });
  const watch = { enabled: false, minutes: 1, selector: '', require: '', ignore: '', fingerprint: null, lastCheckAt: 0, lastChangeAt: 0, failures: 0 };
  const space = (id, label, appId, kind, url, watchPatch) => ({
    id, label, appId, kind, url, phoneLayout: kind !== 'social',
    watch: { ...watch, ...(watchPatch || {}) },
  });
  const state = {
    version: 2,
    spaces: [
      space('A', 'Account A', 'messenger', 'social', '', null),
      space('B', 'Account B', 'messenger', 'social', '', null),
      space('C', 'Live board', 'custom', 'tasks', BOARD_URL, { enabled: true, minutes: 1, selector: '#list' }),
      space('D', 'Live chat', 'custom', 'social', CHAT_URL, null),
    ],
    slots: ['A', 'B', 'C', 'D'],
    loadedSlots: ['C', 'D'],
    theme: 'system',
    // No `bubble` field on purpose: the point of the check is that a profile which never asks for a
    // bubble still gets one, because that is what a fresh install looks like.
    bubblePrefs: { size: 64, opacity: 100, doubleClick: 'menu', overFullscreen: true, spotX: 0.02, spotY: 0.35 },
    watchWhileRunning: true,
    messageSound: true,
    monitorState: {},
  };
  fs.writeFileSync(path.join(userData, 'bop-settings.bin'),
    Buffer.concat([Buffer.from('BOP0', 'utf8'), Buffer.from(JSON.stringify(state), 'utf8')]));
  return state;
}

function launch(userData) {
  const args = [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userData}`];
  const command = APP || ELECTRON;
  if (!APP) args.unshift('.');
  const child = spawn(command, args, {
    cwd: DESKTOP,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = fs.createWriteStream(path.join(OUT, 'launch.log'));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on('exit', (code) => log.write(`\n[electron exited with ${code}]\n`));
  return child;
}

async function windowTarget(suffix) {
  const current = await targets();
  return targetFor(current, (url) => url.endsWith(suffix)) || null;
}

function targetFor(list, test) {
  return list.find((target) => target.type === 'page' && test(target.url));
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------
async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const userData = path.join(OUT, 'userdata');

  // A leftover instance from an earlier run would answer the DevTools port and every measurement below
  // would silently describe that app instead of the one just launched.
  const squatter = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true).catch(() => false);
  if (squatter) {
    record('port-free', `something is already listening on ${CDP_PORT}; close it or pass --cdp-port`, false);
    process.exitCode = 1;
    return;
  }

  const server = await startServer();
  writeProfile(userData);
  const child = launch(userData);

  let ok = false;
  try {
    const list = await until('the app to expose a dashboard page', async () => {
      const current = await targets().catch(() => []);
      return targetFor(current, (url) => url.endsWith('/renderer/index.html')) ? current : null;
    }, APP ? 90000 : 45000);
    record('app-started', `${APP ? APP : 'source tree'} · ${list.length} devtools targets`, true);

    // 1. The dashboard, through its own preload IPC — the surface every other step depends on.
    const dashboardTarget = async () => {
      const current = await targets();
      const target = targetFor(current, (url) => url.endsWith('/renderer/index.html'));
      if (!target) throw new Error('the dashboard window is gone');
      await until('the dashboard document to finish loading', async () => {
        const ready = await evaluate(target, 'document.readyState === "complete" && !!document.querySelector(".shell")').catch(() => false);
        return ready === true ? true : null;
      }, 20000, 200);
      return target;
    };
    await step('dashboard-ipc', async () => {
      const target = await dashboardTarget();
      const snapshot = await evaluate(target, 'window.bop.snapshot()');
      const ids = snapshot.enabled.map((space) => space.id).join(',');
      if (ids !== 'A,B,C,D') throw new Error(`spaces did not survive the profile: ${ids}`);
      if (snapshot.bubble !== true) throw new Error('the bubble setting is not on');
      if (!snapshot.enabled.find((space) => space.id === 'C')?.watch?.enabled) throw new Error('the watched space lost its watch settings');
      return JSON.stringify({ spaces: ids, bubble: snapshot.bubble, theme: snapshot.theme, encryption: snapshot.encryption });
    });

    // 2. The bubble window: really on screen, at the size the settings ask for.
    await step('bubble-window', async () => {
      const target = await until('the bubble window', () => windowTarget('/renderer/bubble.html'), 20000);
      const bounds = await evaluate(target, '({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight })');
      if (bounds.width !== 64 || bounds.height !== 64) throw new Error(`the bubble is ${bounds.width}x${bounds.height}, not 64x64`);
      if (bounds.x < 0 || bounds.y < 0) throw new Error(`the bubble is off screen at ${bounds.x},${bounds.y}`);
      await screenshot(target, path.join(OUT, 'bubble.png'));
      return JSON.stringify(bounds);
    });

    // 2b. The bubble's drag, with the machine's own pointer, through the normal build the user runs. This
    //     is the gesture that was reported as impossible, and it is the one thing a synthetic event cannot
    //     prove: on 0.1.7 the operating system's own drag arrived 33 points short of the hand that dragged
    //     it, and only the ~13px ring around the centre button moved the window at all — a press on the
    //     button opened the menu instead. So the press below is on the *centre*, which is where a hand
    //     aims, and the assertion is that the window arrives exactly where the pointer ended.
    //     The pointer is taken over for about a second and put back where it was.
    await step('bubble-drag-pointer', async () => {
      const target = await until('the bubble window', () => windowTarget('/renderer/bubble.html'), 20000);
      const before = await evaluate(target, '({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight })');
      const press = { x: Math.round(before.x + before.w / 2), y: Math.round(before.y + before.h / 2) };
      const delta = { x: 220, y: 130 };
      pointer(['-Return', '-X1', String(press.x), '-Y1', String(press.y), '-X2', String(press.x + delta.x), '-Y2', String(press.y + delta.y)]);
      await sleep(600);
      const after = await evaluate(target, '({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight })');
      const offBy = Math.abs(after.x - (before.x + delta.x)) + Math.abs(after.y - (before.y + delta.y));
      if (!Number.isFinite(offBy) || offBy > 2) {
        throw new Error(`the bubble did not follow the pointer: ${JSON.stringify({ before, after, wanted: { x: before.x + delta.x, y: before.y + delta.y } })}`);
      }
      if (after.w !== before.w || after.h !== before.h) throw new Error('a drag changed the bubble size');
      // The spot is stored as a fraction of the work area, so it has to describe where the bubble actually
      // ended up — otherwise the next launch puts it somewhere the user never dropped it.
      const dashboard = await dashboardTarget();
      const remembered = await evaluate(dashboard, 'window.bop.snapshot().then((s) => s.bubblePrefs)');
      const area = await evaluate(dashboard, '({ left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight })');
      const spot = { x: Math.round(area.left + remembered.spotX * area.width), y: Math.round(area.top + remembered.spotY * area.height) };
      if (Math.abs(spot.x - after.x) > 2 || Math.abs(spot.y - after.y) > 2) {
        throw new Error(`the dragged spot was not remembered: ${JSON.stringify({ spot, after, area })}`);
      }
      await screenshot(target, path.join(OUT, 'bubble-dragged.png'));
      return JSON.stringify({ press, before, after, offBy, spotFraction: { x: remembered.spotX, y: remembered.spotY }, spot, area });
    });

    // 3. The loaded space pages and the notification bridge inside them.
    const spaceTarget = async (page) => {
      const target = await until(`the ${page} space page`, async () => {
        const current = await targets();
        return targetFor(current, (url) => url.includes(page)) || null;
      }, 30000, 250);
      // A space view exists as its own `about:blank` document for a moment before the navigation it was
      // told to start commits, so the document itself is what has to be waited for — not the target.
      await until(`the ${page} document to commit`, async () => {
        const probe = await evaluate(target, '({ href: location.href, ready: document.readyState })').catch(() => null);
        return probe && probe.href.includes(page) && probe.ready === 'complete' ? true : null;
      }, 30000, 200);
      return target;
    };
    await step('space-loaded', async () => {
      const target = await spaceTarget('/chat.html');
      const probe = await evaluate(target, '({ url: location.href, bridge: typeof window.__bopNotify, permission: Notification.permission, title: document.title })');
      if (!probe.url.includes(String(HTTP_PORT))) throw new Error(`the space is not on its site: ${probe.url}`);
      if (probe.bridge !== 'function') throw new Error('the page has no notification bridge');
      if (probe.permission !== 'granted') throw new Error(`notifications are ${probe.permission} on an allowed origin`);
      return JSON.stringify(probe);
    });

    // 4. The whole point of the desktop build: a page's own notification becomes a card.
    await step('web-notification', async () => {
      const target = await spaceTarget('/chat.html');
      const raised = await evaluate(target, `(() => {
        const notice = new Notification('Live check', { body: 'hello from the page', tag: 'live-1' });
        return { body: notice.body, silent: notice.silent };
      })()`);
      const alerted = await until('the notification to reach the alert list', async () => {
        const snapshot = await evaluate(await dashboardTarget(), 'window.bop.snapshot()');
        return snapshot.alerts.find((alert) => alert.kind === 'web' && alert.spaceId === 'D') || null;
      }, 15000);
      const card = await until('Bop\'s reminder card', () => windowTarget('/renderer/alert.html'), 15000);
      // The window is created before its document commits, and the card's text arrives over IPC once it
      // has, so the text is what proves the card is really on screen.
      const readCard = '(() => { const el = document.getElementById("card"); return el ? el.innerText.replace(/\\s+/g, " ").trim() : ""; })()';
      const cardText = await until('the card to carry its text', async () => {
        const text = await evaluate(card, readCard).catch(() => '');
        return text && text.includes(SPACE_D_LABEL) ? text : null;
      }, 15000, 200);
      await screenshot(card, path.join(OUT, 'card.png'));
      if (!cardText.includes(SPACE_D_LABEL)) throw new Error(`the card does not name the space: ${cardText}`);
      if (!/hello from the page/.test(cardText)) throw new Error(`the card does not carry the message text: ${cardText}`);
      return JSON.stringify({ raised, title: alerted.title, body: alerted.body, card: cardText.slice(0, 120) });
    });

    // 5. Unread in the tab title, the second detection source.
    await step('title-unread', async () => {
      const target = await spaceTarget('/chat.html');
      await evaluate(target, 'document.title = "(3) Live chat"; true');
      const alerted = await until('the unread title to reach the alert list', async () => {
        const snapshot = await evaluate(await dashboardTarget(), 'window.bop.snapshot()');
        return snapshot.alerts.find((alert) => alert.tag === 'unread' && alert.spaceId === 'D') || null;
      }, 15000);
      return JSON.stringify({ title: alerted.title, body: alerted.body });
    });

    // 6. A watched page that changes in place, read by the watcher's own timer — no manual trigger.
    await step('watch-scheduled', async () => {
      const baseline = await until('the watcher to take its first reading', async () => {
        const snapshot = await evaluate(await dashboardTarget(), 'window.bop.snapshot()');
        const space = snapshot.spaces.find((value) => value.id === 'C');
        return space.watch.fingerprint || null;
      }, 30000);
      await evaluate(await spaceTarget('/board.html'), 'document.getElementById("list").textContent = "2 studies available"; true');
      const alerted = await until('the changed board to raise a card on its own timer', async () => {
        const snapshot = await evaluate(await dashboardTarget(), 'window.bop.snapshot()');
        return snapshot.alerts.find((alert) => alert.kind === 'watch' && alert.spaceId === 'C') || null;
      }, WATCH_WAIT_MS, 1000);
      if (alerted.body !== '2 studies available') throw new Error(`unexpected card body: ${alerted.body}`);
      return JSON.stringify({ baseline: baseline.slice(0, 9), body: alerted.body });
    });

    // 7. The user's actual surface: the Alerts page, rendered, with the bubble badge in step.
    await step('alerts-page', async () => {
      const target = await dashboardTarget();
      await evaluate(target, 'document.querySelector(\'button[data-page="alerts"]\').click(); true');
      await sleep(400);
      const read = await evaluate(target, `(() => {
        const rows = Array.from(document.querySelectorAll('.alert')).map((row) => row.querySelector('.row-title').textContent);
        return { rows, summary: document.querySelector('.section-title span').textContent };
      })()`);
      const wanted = ['Live chat · Live check', 'Live chat · unread increased', 'Live board changed'];
      const missing = wanted.filter((title) => !read.rows.includes(title));
      if (missing.length) throw new Error(`the Alerts page is missing ${JSON.stringify(missing)} of ${JSON.stringify(read.rows)}`);
      await screenshot(target, path.join(OUT, 'alerts.png'));
      return JSON.stringify(read);
    });

    await step('bubble-badge', async () => {
      const target = targetFor(await targets(), (url) => url.endsWith('/renderer/bubble.html'));
      const badge = await evaluate(target, '({ hidden: document.getElementById("badge").hidden, text: document.getElementById("badge").textContent })');
      if (badge.hidden || !Number(badge.text) >= 3) throw new Error(`the badge does not count the alerts: ${JSON.stringify(badge)}`);
      return JSON.stringify(badge);
    });

    // 8. A pane is a page, not a background tab. Measured on this build before the fix: every pane —
    //    including the dashboard — reported `document.visibilityState === 'hidden'` and a 100 ms timer
    //    fired about once a second, which is the state Chrome freezes after five minutes and the state in
    //    which a messaging site hands its messages to a service worker that Electron does not run.
    // What this asserts is the property that broke: a pane must not be a throttled background tab. The
    // visibility *state* a site is told is recorded rather than required, because it is what differs
    // between a packaged build and one run from source on this machine; the timer rate does not.
    const tickRate = async (target, ms) => {
      await evaluate(target, '(() => { window.__bopTicks = 0; window.__bopT = setInterval(() => { window.__bopTicks += 1; }, 100); return true; })()');
      await sleep(ms);
      return evaluate(target, '(() => { clearInterval(window.__bopT); return { ticks: window.__bopTicks, state: document.visibilityState, hidden: document.hidden, focus: document.hasFocus() }; })()');
    };

    await step('pane-unthrottled-when-open', async () => {
      const target = await dashboardTarget();
      await evaluate(target, 'window.bop.openSpace("C")');
      await sleep(1200);
      const open = await evaluate(target, 'window.bop.snapshot().then((s) => s.enabled.filter((space) => space.open).map((space) => space.id))');
      if (open.join(',') !== 'C') throw new Error(`the space did not open: ${JSON.stringify(open)}`);
      const pane = await tickRate(await spaceTarget('/board.html'), 2000);
      if (pane.ticks < 15) throw new Error(`the open pane is throttled: ${pane.ticks} ticks in 2000ms`);
      return JSON.stringify({ open, pane });
    });

    await step('background-pane-unthrottled', async () => {
      const target = await dashboardTarget();
      await evaluate(target, 'window.bop.closeSpace()');
      await sleep(800);
      const pane = await tickRate(await spaceTarget('/board.html'), 2000);
      if (pane.ticks < 15) throw new Error(`a pane left in the background is throttled: ${pane.ticks} ticks in 2000ms`);
      return JSON.stringify(pane);
    });

    // 8b. Switching a section while a space is open — the reported "I have to press ✕ first". On 0.1.7 the
    //     nav buttons changed the page *behind* the open space, so Settings and the Guide looked broken.
    //     The click is a real click in the dashboard renderer, and the space has to keep running behind it
    //     with its page still rendering.
    await step('nav-switch-while-open', async () => {
      const target = await dashboardTarget();
      await evaluate(target, 'window.bop.openSpace("C")');
      await sleep(1000);
      const open = await evaluate(target, 'window.bop.snapshot().then((s) => s.enabled.filter((space) => space.open).map((space) => space.id))');
      if (open.join(',') !== 'C') throw new Error(`the space did not open: ${JSON.stringify(open)}`);
      await evaluate(target, 'document.querySelector(\'button[data-page="settings"]\').click(); true');
      await sleep(700);
      const read = await evaluate(target, `({
        page: document.querySelector('.nav button[aria-current="true"]').dataset.page,
        spaceOpen: document.body.classList.contains('space-open'),
        text: String(document.querySelector('.main').innerText).slice(0, 40),
      })`);
      const still = await evaluate(target, 'window.bop.snapshot()');
      const paneText = await evaluate(await spaceTarget('/board.html'), 'document.getElementById("list").textContent');
      if (read.page !== 'settings' || read.spaceOpen || !read.text.includes('Settings')) {
        throw new Error(`the Settings section did not come forward: ${JSON.stringify(read)}`);
      }
      if (still.enabled.some((space) => space.open)) throw new Error('the space is still open over the section');
      if (!paneText) throw new Error('switching a section destroyed the space page it was showing');
      await screenshot(target, path.join(OUT, 'settings-while-space-open.png'));
      return JSON.stringify({ read, paneText });
    });

    // 9. The tray and the way back in. A window that hides itself with nothing in the tray is an app the
    //    user has to kill from Task Manager.
    await step('tray-and-dashboard', async () => {
      const target = await dashboardTarget();
      const snapshot = await evaluate(target, 'window.bop.snapshot()');
      if (snapshot.tray !== true) throw new Error('there is no tray icon: a hidden dashboard would be unreachable');
      if (snapshot.dashboardVisible !== true) throw new Error('the dashboard is not visible on a normal launch');
      return JSON.stringify({ tray: snapshot.tray, dashboardVisible: snapshot.dashboardVisible, packaged: snapshot.packaged });
    });

    // 10. "Start Bop when I sign in" driven the way the settings page drives it, then read back from the
    //     operating system rather than from the preference that was just written.
    await step('start-at-login', async () => {
      const target = await dashboardTarget();
      const before = await evaluate(target, 'window.bop.snapshot()');
      if (!before.packaged) {
        if (before.autoStart.registered) throw new Error('a source run registered the Electron binary to start with the machine');
        return 'skipped: a source run must never write a start-up entry';
      }
      if (before.autoStart.registered !== true) throw new Error('a packaged build did not register itself at sign-in');
      await evaluate(target, 'window.bop.setPreference("startAtLogin", false)');
      const off = await evaluate(target, 'window.bop.snapshot().then((s) => s.autoStart)');
      if (off.registered !== false) throw new Error('turning the switch off left the start-up entry behind');
      await evaluate(target, 'window.bop.setPreference("startAtLogin", true)');
      const on = await evaluate(target, 'window.bop.snapshot().then((s) => s.autoStart)');
      if (on.registered !== true) throw new Error('turning the switch back on did not write the start-up entry');
      return JSON.stringify({ before: before.autoStart, off, on });
    });

    ok = steps.every((value) => value.ok);
  } catch (failure) {
    record('run', String((failure && failure.stack) || failure), false);
  } finally {
    if (!KEEP) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    server.close();
    fs.writeFileSync(path.join(OUT, 'live-check.json'), JSON.stringify({ ok, steps }, null, 2));
    process.stdout.write(`${ok ? 'LIVE CHECK OK' : 'LIVE CHECK FAILED'} · ${steps.filter((step) => !step.ok).length} failed · report ${path.join(OUT, 'live-check.json')}\n`);
    process.exitCode = ok ? 0 : 1;
  }
}

main();
