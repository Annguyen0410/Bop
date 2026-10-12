'use strict';

/*
 * Dev-only helper: click a dashboard control the way a person does — read the element's client rect
 * through DevTools, then send a real OS mouse click through PowerShell. A JS `element.click()` proves
 * the handler works; this proves the pixel is actually reachable, which is a different question.
 *
 *   node tools/click-ui.js <port> <urlSuffix> <selector> [--dbl]
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const [, , portArg, suffix, selector, ...rest] = process.argv;
const port = Number(portArg || 9222);
const dbl = rest.includes('--dbl');

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
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
        const id = ++nextId;
        return new Promise((done, fail) => {
          pending.set(id, { resolve: done, reject: fail });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { socket.close(); },
    }));
  });
}

(async () => {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = list.find((entry) => entry.type === 'page' && entry.url.includes(suffix));
  if (!target) throw new Error(`no target for ${suffix}`);
  const client = await connect(target.webSocketDebuggerUrl);
  let rect;
  try {
    const expression = `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), text: (n.textContent || '').trim().slice(0, 40), disabled: n.disabled === true }; })()`;
    const result = await client.send('Runtime.evaluate', { expression, returnByValue: true });
    rect = result.result.value;
  } finally {
    client.close();
  }
  if (!rect) { process.stdout.write(`MISSING ${selector}\n`); process.exitCode = 2; return; }
  if (rect.disabled) { process.stdout.write(`DISABLED ${selector}\n`); process.exitCode = 3; return; }

  const script = path.join(__dirname, 'click-window.ps1');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Title', 'Bop', '-ClientX', String(rect.cx), '-ClientY', String(rect.cy), '-Action', 'click'];
  if (dbl) {
    // Two quick clicks at the same spot: dblclick is a real double-click, not two clicks.
    spawnSync('powershell', args, { stdio: 'ignore' });
  }
  const out = spawnSync('powershell', args, { encoding: 'utf8' });
  process.stdout.write(`${selector} at client ${rect.cx},${rect.cy} (${rect.w}x${rect.h}) "${rect.text}" -> ${String(out.stdout).trim()}\n`);
})().catch((failure) => { process.stdout.write(`ERR ${failure.message}\n`); process.exitCode = 1; });
