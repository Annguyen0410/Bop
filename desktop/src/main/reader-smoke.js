'use strict';

/*
 * End-to-end run of the shipped in-page reader in a **real Chromium** engine, on the local fixture page,
 * through the same call shape the app uses: `webContents.executeJavaScript(...)`. This is the experiment
 * the DOM unit tests cannot be: jsdom proves the counting rules, this proves the file that actually ships
 * loads, runs and answers inside a browser engine.
 *
 * It is still not a real site: no login, no service markup. What it can and cannot prove is written down
 * in docs/scanning.md rather than implied by a green run.
 *
 * It lives beside the other smoke script (src/main/monitor-smoke.js) on purpose: Node's test runner
 * globs everything under test/, and this file needs Electron, not plain Node.
 *
 *   npm run smoke:unread -- --report=docs/evidence/scanning/reader-smoke.json
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// The exact asset the WebView injects. Read from the app, never copied: a copy that drifts is the bug
// this smoke exists to catch.
const READER = path.join(__dirname, '..', '..', '..', 'app', 'src', 'main', 'assets', 'unread-reader.js');
const FIXTURE = path.join(__dirname, '..', '..', 'test', 'fixtures', 'unread-fixture.html');

const fixtureSite = {
  mode: 'dom',
  evidence: 'desktop/test/fixtures/unread-fixture.html',
  row: '.thread',
  unread: '.badge',
  muted: '.muted-mark',
  count: 'text',
};

const steps = [];
let failures = 0;

function record(name, passed, detail) {
  steps.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${passed ? '' : `  → ${detail}`}`);
}

async function main() {
  const window = new BrowserWindow({ show: false, width: 480, height: 800 });
  await window.loadFile(FIXTURE);
  const source = fs.readFileSync(READER, 'utf8');

  /** Same call the app makes: inject the reader, then ask it one question about this page. */
  const ask = async (expression, descriptor = fixtureSite) => window.webContents.executeJavaScript(
    `(() => {\n${source}\nreturn ${expression};\n})()`, true);

  const payload = async (descriptor = fixtureSite) =>
    ask(`BopUnread.encode(BopUnread.readDescriptor(document, ${JSON.stringify(descriptor)}))`, descriptor);

  const baseline = await payload();
  record('the shipped reader loads in Chromium and reports the fixture',
    baseline === 'unread=5\nmuted=2', `got ${JSON.stringify(baseline)}`);

  const unmuted = await ask(`(() => { const r = BopUnread.readDescriptor(document, ${JSON.stringify(fixtureSite)}); return r.unread - r.muted; })()`);
  record('the number a card may use excludes muted threads',
    unmuted === 3, `got ${JSON.stringify(unmuted)}`);

  // A message arrives in the muted thread: total moves, the unmuted number must not.
  await window.webContents.executeJavaScript(`document.querySelector('#thread-promo .badge').textContent = '3'; true`, true);
  const afterMuted = await payload();
  const unmutedAfter = await ask(`(() => { const r = BopUnread.readDescriptor(document, ${JSON.stringify(fixtureSite)}); return r.unread - r.muted; })()`);
  record('a muted arrival changes the total but not the unmuted number',
    afterMuted === 'unread=6\nmuted=3' && unmutedAfter === 3,
    `payload ${JSON.stringify(afterMuted)}, unmuted ${JSON.stringify(unmutedAfter)}`);

  // A dot-shaped badge on a new row counts once, exactly like the native title path.
  await window.webContents.executeJavaScript(`(() => {
    const row = document.createElement('div');
    row.className = 'thread';
    row.innerHTML = '<span class="name">Dot</span><span class="badge"></span>';
    document.getElementById('threads').appendChild(row);
    return true;
  })()`, true);
  const withDot = await payload();
  record('a dot badge found in the engine counts as one unread',
    withDot === 'unread=7\nmuted=3', `got ${JSON.stringify(withDot)}`);

  const unverified = await payload({ ...fixtureSite, evidence: null });
  record('a descriptor without evidence is refused, not attempted',
    unverified === '', `got ${JSON.stringify(unverified)}`);

  const titleMode = await ask(`BopUnread.encode(BopUnread.read(document, 'instagram'))`);
  record('a title-mode catalog app is not a DOM reading',
    titleMode === '', `got ${JSON.stringify(titleMode)}`);

  const drifted = await payload({ ...fixtureSite, count: 'attr:data-count' });
  record('a badge whose promised number is missing refuses in a real engine',
    drifted === '', `got ${JSON.stringify(drifted)}`);

  window.destroy();
  return { steps, failures };
}

app.whenReady().then(async () => {
  let report;
  try {
    report = await main();
  } catch (failure) {
    console.error(`smoke aborted: ${failure && failure.stack ? failure.stack : failure}`);
    app.exit(1);
    return;
  }
  const target = (process.argv.find((argument) => argument.startsWith('--report=')) || '').slice('--report='.length);
  const document_ = { ok: report.failures === 0, steps: report.steps };
  if (target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(document_, null, 2)}\n`);
    console.log(`report → ${target}`);
  }
  console.log(`\n${report.steps.length - report.failures}/${report.steps.length} steps passed`);
  app.exit(report.failures === 0 ? 0 : 1);
});
