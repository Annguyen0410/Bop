'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const janitor = require('../src/main/portable-janitor.js');

/** A folder that looks like the wrapper's unpacked copy: the executable beside a `resources` folder. */
function makeCopy(base, layout, exeName = 'Bop.exe') {
  const dir = layout ? path.join(base, layout) : base;
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(dir, exeName), 'exe');
  fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), 'asar');
  return path.join(dir, exeName);
}

function scratchTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bop-janitor-'));
}

/** Well past the settle window, so every fixture counts as abandoned. */
const LATER = () => Date.now() + 60 * 60 * 1000;

test('an abandoned copy from an earlier launch is removed, in both wrapper layouts', async () => {
  const temp = scratchTemp();
  try {
    makeCopy(path.join(temp, '3KRYuLXYZ'), '');              // unpack folder, executable at its top
    makeCopy(path.join(temp, 'nsA1B2.tmp'), '7z-out');       // NSIS plugin folder, executable one level down
    makeCopy(path.join(temp, 'nsC3D4.tmp'), 'app');
    const removed = await janitor.sweepStaleCopies({
      tempDir: temp,
      exePath: path.join(temp, 'current', 'Bop.exe'),
      now: LATER(),
    });
    assert.strictEqual(removed.length, 3);
    assert.deepStrictEqual(fs.readdirSync(temp), []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('a copy that is busy is never touched, and the others are still swept', async () => {
  const temp = scratchTemp();
  try {
    const running = makeCopy(path.join(temp, 'RunningCopy'), '');
    makeCopy(path.join(temp, 'StaleCopy'), '');
    const removed = await janitor.sweepStaleCopies({
      tempDir: temp,
      exePath: path.join(temp, 'current', 'Bop.exe'),
      now: LATER(),
      busy: (found) => found.root === path.dirname(running),
    });
    assert.deepStrictEqual(removed, [path.join(temp, 'StaleCopy')]);
    assert.ok(fs.existsSync(running), 'the busy copy keeps every file');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('a copy Windows refuses to move is kept whole, not half-deleted', async () => {
  const temp = scratchTemp();
  try {
    const refused = makeCopy(path.join(temp, 'Refused'), '');
    makeCopy(path.join(temp, 'Free'), '');
    const removed = await janitor.sweepStaleCopies({
      tempDir: temp,
      exePath: path.join(temp, 'current', 'Bop.exe'),
      now: LATER(),
      claim: (folder) => {
        if (folder === path.dirname(refused)) return Promise.reject(Object.assign(new Error('busy'), { code: 'EPERM' }));
        return janitor.moveAside(folder);
      },
    });
    assert.deepStrictEqual(removed, [path.join(temp, 'Free')]);
    assert.ok(fs.existsSync(refused) && fs.existsSync(path.join(path.dirname(refused), 'resources', 'app.asar')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('the copy running right now and a copy still being extracted are kept', async () => {
  const temp = scratchTemp();
  try {
    const own = makeCopy(path.join(temp, 'OwnCopy'), '');
    makeCopy(path.join(temp, 'JustStarted'), '');
    const removed = await janitor.sweepStaleCopies({ tempDir: temp, exePath: own });
    assert.deepStrictEqual(removed, [], 'nothing is old enough yet and the own copy is excluded');
    assert.ok(fs.existsSync(own));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('folders that are not a copy of this app are left alone', async () => {
  const temp = scratchTemp();
  try {
    makeCopy(path.join(temp, 'OtherApp'), '', 'Loopback.exe');     // another app's copy
    fs.mkdirSync(path.join(temp, 'Plain'));                        // unrelated folder
    fs.writeFileSync(path.join(temp, 'Bop.exe'), 'loose file');    // a file, not a folder
    fs.mkdirSync(path.join(temp, 'HasExeNoResources'));            // matching file name, no resources folder
    fs.writeFileSync(path.join(temp, 'HasExeNoResources', 'Bop.exe'), 'x');
    const removed = await janitor.sweepStaleCopies({
      tempDir: temp,
      exePath: path.join(temp, 'current', 'Bop.exe'),
      now: LATER(),
    });
    assert.deepStrictEqual(removed, []);
    assert.deepStrictEqual(fs.readdirSync(temp).sort(), ['Bop.exe', 'HasExeNoResources', 'OtherApp', 'Plain']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('the husk of an interrupted deletion is finished off, empty or not', async () => {
  const temp = scratchTemp();
  try {
    // What an earlier sweep left when the wrapper that owned the copy still held one of its files: the
    // payload is gone, the folder it was moved to is not, and nothing else would ever match that name.
    const emptyHusk = path.join(temp, 'nsa1b2.tmp.gone-99-1792000000000');
    fs.mkdirSync(path.join(emptyHusk, '7z-out'), { recursive: true });
    const heavyHusk = path.join(temp, 'nsc3d4.tmp.gone-99-1792000000001');
    makeCopy(heavyHusk, '7z-out');
    const removed = await janitor.sweepStaleCopies({
      tempDir: temp,
      exePath: path.join(temp, 'current', 'Bop.exe'),
      now: LATER(),
    });
    assert.deepStrictEqual(removed.sort(), [emptyHusk, heavyHusk].sort());
    assert.deepStrictEqual(fs.readdirSync(temp), []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('a husk younger than the settle window is left for a later sweep', async () => {
  const temp = scratchTemp();
  try {
    const fresh = path.join(temp, 'nsf7g8.tmp.gone-99-1792000000002');
    fs.mkdirSync(fresh, { recursive: true });
    const removed = await janitor.sweepStaleCopies({ tempDir: temp, exePath: 'C:/x/Bop.exe' });
    assert.deepStrictEqual(removed, []);
    assert.ok(fs.existsSync(fresh));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('a missing temporary folder is a no-op, not an error', async () => {
  const removed = await janitor.sweepStaleCopies({
    tempDir: path.join(os.tmpdir(), 'does-not-exist-bop-janitor'),
    exePath: 'C:/x/Bop.exe',
  });
  assert.deepStrictEqual(removed, []);
});

test('on Windows, a copy with a running executable cannot be claimed and survives a real sweep', { skip: process.platform !== 'win32' }, async () => {
  const temp = scratchTemp();
  const folder = path.join(temp, 'Live');
  const exe = path.join(folder, 'node.exe');
  fs.mkdirSync(path.join(folder, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'resources', 'app.asar'), 'asar');
  fs.copyFileSync(process.execPath, exe);
  const child = spawn(exe, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const removed = await janitor.sweepStaleCopies({
      tempDir: temp,
      exePath: path.join(temp, 'current', 'node.exe'),
      now: LATER(),
    });
    assert.deepStrictEqual(removed, []);
    assert.ok(fs.existsSync(exe), 'the running executable is still where it was');
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve).once('error', resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
