'use strict';

/**
 * Every renderer Bop creates, and the preload each one runs.
 *
 * Two rules are enforced here because both were true by accident before and can be lost by a one-line
 * edit: (1) no renderer runs unsandboxed — a remote page must never get a preload with Node in it; and
 * (2) the notification bridge that space-preload.js carries inline stays byte-identical to
 * notification-bridge.js, the copy the tests exercise. Sandboxed preloads cannot `require` a sibling
 * module (measured on Electron 45.4.1), so the bridge is written out twice and this test is what keeps
 * those two copies from drifting.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const mainDir = path.join(__dirname, '..', 'src', 'main');
const mainFiles = fs.readdirSync(mainDir).filter((name) => name.endsWith('.js'));
const read = (name) => fs.readFileSync(path.join(mainDir, name), 'utf8');
const withoutComments = (source) => source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .filter((line) => !/^\s*(\*|\/\*)/.test(line))
  .join('\n');

test('no surface is left unsandboxed and no renderer gets nodeIntegration', () => {
  for (const name of mainFiles) {
    const source = withoutComments(read(name));
    assert.ok(!/sandbox:\s*false/.test(source), `${name} must not disable the renderer sandbox`);
    assert.ok(!/nodeIntegration:\s*true/.test(source), `${name} must not enable nodeIntegration`);
    // Split at every `webPreferences:` and look at the region that follows it, which is brace-proof:
    // the options themselves contain `${...}` templates whose braces a naive match would stop at.
    const regions = source.split('webPreferences:').slice(1);
    regions.forEach((region, index) => {
      assert.ok(/sandbox:\s*true/.test(region),
        `${name} creates a surface without sandbox: true (webPreferences #${index + 1})`);
    });
    if (name === 'main.js') assert.ok(regions.length > 0, 'main.js creates the app\'s surfaces');
  }
});

test('a preload needs electron and nothing else', () => {
  for (const name of ['preload.js', 'notes-preload.js', 'space-preload.js']) {
    const source = withoutComments(read(name));
    for (const match of source.matchAll(/require\(([^)]*)\)/g)) {
      assert.strictEqual(match[1].replace(/['"]/g, ''), 'electron', `${name} may only require electron, found require(${match[1]})`);
    }
    // Electron 45 removed the Node shims from sandboxed preloads: no Buffer, no setImmediate.
    assert.ok(!/\bBuffer\b/.test(source), `${name} must not use Buffer`);
    assert.ok(!/\bsetImmediate\b/.test(source), `${name} must not use setImmediate`);
  }
});

test('the inlined notification bridge is the tested one, byte for byte', () => {
  const canonical = String(require('../src/main/notification-bridge.js')).trim();
  const source = read('space-preload.js');
  const start = source.indexOf('// --- keep-in-sync: notification-bridge.js ---');
  const end = source.indexOf('// --- /keep-in-sync ---');
  assert.ok(start >= 0 && end > start, 'space-preload.js keeps its keep-in-sync markers');
  const inlined = source.slice(start + '// --- keep-in-sync: notification-bridge.js ---'.length, end).trim();
  assert.strictEqual(inlined, canonical,
    'space-preload.js must carry exactly the function notification-bridge.js exports');
});
