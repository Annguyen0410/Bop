'use strict';

/**
 * What a release build is made of.
 *
 * `build.files` decides what lands in the shipped app, and it used to be the whole `src` tree plus
 * `package.json`, while the smoke harnesses still lived under `src/main/` — so monitor-smoke.js,
 * retry-smoke.js, reader-smoke.js and the in-app smoke runner all shipped inside the product. These cases pin the file
 * set twice over: the patterns must not be able to pick the harness up, and no harness may sit where
 * the patterns reach.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const desktop = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(desktop, relative), 'utf8');

const packagedPatterns = () => {
  const build = JSON.parse(read('package.json')).build.files;
  const portable = JSON.parse(read('tools/prepackaged-portable.json')).files;
  return { build, portable };
};

test('both package configurations ship the app and nothing else', () => {
  const { build, portable } = packagedPatterns();
  for (const [name, files] of [['package.json build.files', build], ['tools/prepackaged-portable.json files', portable]]) {
    assert.ok(Array.isArray(files) && files.length > 0, `${name} lists files`);
    for (const pattern of files) {
      assert.ok(!pattern.includes('verify'), `${name} must not package desktop/verify: ${pattern}`);
      assert.ok(!pattern.includes('tools'), `${name} must not package desktop/tools: ${pattern}`);
      assert.ok(!pattern.includes('test'), `${name} must not package desktop/test: ${pattern}`);
      assert.ok(!/smoke/.test(pattern), `${name} must not package a smoke harness: ${pattern}`);
    }
    assert.ok(files.includes('src/**/*'), `${name} ships the app itself`);
    assert.ok(files.includes('package.json'), `${name} ships the manifest`);
  }
});

test('no harness is left where the packaged patterns reach', () => {
  const shipped = fs.readdirSync(path.join(desktop, 'src', 'main'));
  for (const name of shipped) {
    assert.ok(!/smoke/.test(name), `src/main/${name} would be packaged; harnesses live in desktop/verify`);
    assert.ok(!/live-check/.test(name), `src/main/${name} would be packaged; the live check lives in desktop/tools`);
  }
});

test('the harnesses themselves are where the commands say they are', () => {
  for (const name of ['monitor-smoke.js', 'retry-smoke.js', 'reader-smoke.js']) {
    assert.ok(fs.existsSync(path.join(desktop, 'verify', name)), `desktop/verify/${name} exists`);
    assert.ok(!fs.existsSync(path.join(desktop, 'src', 'main', name)), `src/main/${name} is gone`);
  }
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.ok(scripts['smoke:unread'].includes('verify/reader-smoke.js'),
    `smoke:unread runs the moved harness: ${scripts['smoke:unread']}`);
  assert.ok(!JSON.stringify(scripts).includes('src/main/reader-smoke.js'), 'no script points at the old path');
});

test('the app never requires a harness from a path a release build would have', () => {
  const main = read('src/main/main.js');
  const mainDir = path.join(desktop, 'src', 'main');
  for (const match of main.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
    assert.ok(!/smoke/.test(match[2]) || match[2].includes('/verify/'),
      `main.js requires ${match[2]} from the packaged tree`);
    // And every relative require resolves: a path that is merely plausible is the bug this catches.
    if (match[2].startsWith('.')) {
      assert.ok(fs.existsSync(path.resolve(mainDir, match[2])), `main.js requires ${match[2]} and it exists`);
    }
  }
  assert.ok(main.includes("require('../../verify/monitor-smoke.js')"), 'the monitor harness is required from desktop/verify');
  assert.ok(main.includes("require('../../verify/retry-smoke.js')"), 'the retry harness is required from desktop/verify');
});
