'use strict';

/**
 * A release build is inert to every verification flag.
 *
 * Before this gate, the flags were read straight off `process.argv` in main.js and worked in packaged
 * builds: `--bop-live-check` switched the settings store to plaintext JSON so an outside harness could
 * read it, and the smoke runner shipped inside the product. These cases pin the rule that a packaged
 * build runs the product whatever the command line says, and says which flags it ignored.
 */

const test = require('node:test');
const assert = require('node:assert');

const { resolveVerificationMode } = require('../src/main/verification-mode.js');

test('a development run answers its verification flags', () => {
  const mode = resolveVerificationMode(['electron', '.', '--bop-smoke', '--bop-out', 'C:/tmp/out'], { isPackaged: false });
  assert.strictEqual(mode.smoke, true);
  assert.strictEqual(mode.liveCheck, false);
  assert.strictEqual(mode.out, 'C:/tmp/out');
  assert.deepStrictEqual(mode.ignored, []);
});

test('each harness flag names itself and a smoke run is any smoke run', () => {
  assert.strictEqual(resolveVerificationMode(['x', '--bop-monitor-smoke'], { isPackaged: false }).monitorSmoke, true);
  assert.strictEqual(resolveVerificationMode(['x', '--bop-monitor-smoke'], { isPackaged: false }).smoke, true);
  assert.strictEqual(resolveVerificationMode(['x', '--bop-retry-smoke'], { isPackaged: false }).retrySmoke, true);
  assert.strictEqual(resolveVerificationMode(['x', '--bop-live-check'], { isPackaged: false }).liveCheck, true);
  assert.strictEqual(resolveVerificationMode(['x', '--bop-active'], { isPackaged: false }).active, true);
  const plain = resolveVerificationMode(['x', '--bop-smoke'], { isPackaged: false });
  assert.deepStrictEqual([plain.monitorSmoke, plain.retrySmoke], [false, false]);
});

test('a packaged build ignores every flag and says which ones it saw', () => {
  const argv = ['Bop.exe', '--bop-smoke', '--bop-monitor-smoke', '--bop-retry-smoke', '--bop-live-check',
    '--bop-active', '--bop-out', 'C:/temp/evidence'];
  const mode = resolveVerificationMode(argv, { isPackaged: true });
  assert.deepStrictEqual(
    [mode.smoke, mode.monitorSmoke, mode.retrySmoke, mode.liveCheck, mode.active, mode.out],
    [false, false, false, false, false, null],
    'nothing about a verification run may leak into a release build');
  assert.strictEqual(mode.ignored.includes('--bop-live-check'), true);
  assert.strictEqual(mode.ignored.includes('--bop-smoke'), true);
  assert.strictEqual(mode.ignored.includes('--bop-out'), true);
  assert.strictEqual(mode.isPackaged, true);
});

test('a run with no flags is an ordinary run in either build', () => {
  for (const isPackaged of [false, true]) {
    const mode = resolveVerificationMode(['electron', '.'], { isPackaged });
    assert.deepStrictEqual([mode.smoke, mode.liveCheck, mode.active, mode.out], [false, false, false, null]);
    assert.deepStrictEqual(mode.ignored, []);
  }
});

test('a missing flag value and a bare argv are handled without guessing', () => {
  assert.strictEqual(resolveVerificationMode(['x', '--bop-out'], { isPackaged: false }).out, null);
  assert.deepStrictEqual(resolveVerificationMode(undefined, { isPackaged: false }).ignored, []);
  assert.strictEqual(resolveVerificationMode(undefined, { isPackaged: true }).smoke, false);
});
