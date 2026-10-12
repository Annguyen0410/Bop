'use strict';

/*
 * Does the bubble really follow the mouse?
 *
 * Dev-only, and deliberately not part of the test suite: it takes over the machine's pointer for about
 * a second. The bubble is moved by the operating system, so a synthetic DOM event proves nothing —
 * measured on 0.1.7, the model-level check ("move the window, notice where it settled") passed while the
 * real gesture did nothing at all. This presses, drags and releases the actual pointer over the real
 * window and reports where the window ended up.
 *
 *   node tools/drag-check.js [port] [dx] [dy]
 *
 * `[dx] [dy]` are the drag in screen points (DIP). The press lands on the bubble's rim, which is the
 * drag surface; the centre is the button.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { evaluate } = require('./cdp.js');

const SCRIPT = path.join(__dirname, 'os-drag.ps1');
const RECT = '(() => ({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight, dpr: window.devicePixelRatio, focused: document.hasFocus() }))()';

function pointer(args) {
  return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], { encoding: 'utf8' }).trim();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const port = Number(process.argv[2] || 9470);
  const dx = Number(process.argv[3] || 260);
  const dy = Number(process.argv[4] || 150);

  const before = await evaluate(port, 'bubble.html', RECT);
  // The rim runs from the window edge to the round button in the middle: a press a few points in from
  // the left edge and level with the centre is rim on every size the app offers.
  const press = { x: Math.round(before.x + 5), y: Math.round(before.y + before.h / 2) };
  const drop = { x: press.x + dx, y: press.y + dy };

  await pointer(['-Query']); // touches nothing; proves the tool can talk to the pointer at all
  pointer(['-Return', '-X1', String(press.x), '-Y1', String(press.y), '-X2', String(drop.x), '-Y2', String(drop.y)]);
  await wait(600);

  const after = await evaluate(port, 'bubble.html', RECT);
  const moved = { dx: after.x - before.x, dy: after.y - before.y };
  const wanted = { dx: drop.x - press.x, dy: drop.y - press.y };
  const same = Math.abs(moved.dx - wanted.dx) <= 2 && Math.abs(moved.dy - wanted.dy) <= 2;
  const sizeKept = after.w === before.w && after.h === before.h;
  const report = {
    window: { before: { x: before.x, y: before.y, w: before.w, h: before.h }, after: { x: after.x, y: after.y, w: after.w, h: after.h } },
    press, drop, wanted, moved,
    scaleFactor: before.dpr,
    stayed: moved.dx === 0 && moved.dy === 0,
    followed: same,
    sizeKept,
    focusedAfterPress: after.focused,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = same && sizeKept ? 0 : 1;
})().catch((error) => {
  process.stdout.write(`drag-check failed: ${error.message}\n`);
  process.exitCode = 2;
});
