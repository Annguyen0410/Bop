'use strict';

/**
 * The settings stores on disk: sealed when the OS offers a key, labelled when it does not, and never
 * plaintext in a release build.
 *
 * The invariant this file exists for: `--bop-live-check` used to make the app write raw JSON so an
 * outside harness could read the file, and that flag worked in packaged builds. Whatever a caller asks
 * for, a packaged build gets a non-plaintext payload — the request is refused, not merely discouraged.
 */

const test = require('node:test');
const assert = require('node:assert');

const settingsCodec = require('../src/main/settings-codec.js');

const jsonOf = (payload) => JSON.parse(payload.toString('utf8'));
const seal = (json) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(json, 'utf8')]);
const open = (payload) => payload.slice('SEALED:'.length).toString('utf8');

test('a store the OS can seal is sealed, never raw JSON', () => {
  const encoded = settingsCodec.encodeSettings({ spaces: ['A'] }, { limit: 1000, encrypt: seal });
  assert.strictEqual(encoded.sealed, true);
  assert.strictEqual(encoded.payload.toString('utf8').startsWith('{'), false);
  assert.strictEqual(settingsCodec.decodeSettings(encoded.payload, { decrypt: open }), '{"spaces":["A"]}');
});

test('without an OS key the store is labelled, not silently plain', () => {
  const encoded = settingsCodec.encodeSettings({ spaces: ['A'] }, { limit: 1000 });
  assert.strictEqual(encoded.payload.slice(0, 4).toString('utf8'), settingsCodec.PLAINTEXT_MAGIC);
  assert.strictEqual(settingsCodec.decodeSettings(encoded.payload), '{"spaces":["A"]}');
});

test('the verification harness may ask for plaintext, and only outside a release build', () => {
  const dev = settingsCodec.encodeSettings({ spaces: ['A'] }, { limit: 1000, plaintext: true });
  assert.strictEqual(dev.payload.toString('utf8'), '{"spaces":["A"]}');
  assert.strictEqual(settingsCodec.decodeSettings(dev.payload, { plaintext: true }), '{"spaces":["A"]}');

  const released = settingsCodec.encodeSettings({ spaces: ['A'] }, { limit: 1000, plaintext: true, packaged: true });
  assert.strictEqual(released.payload.toString('utf8').startsWith('{'), false,
    'a packaged build must never write plaintext settings');
  assert.strictEqual(released.payload.slice(0, 4).toString('utf8'), settingsCodec.PLAINTEXT_MAGIC);
  // ... and it does not read plaintext back either.
  assert.strictEqual(settingsCodec.decodeSettings(dev.payload, { plaintext: true, packaged: true }), null);
});

test('even with an OS key, a packaged build is sealed when plaintext is requested', () => {
  const encoded = settingsCodec.encodeSettings({ spaces: ['A'] }, { limit: 1000, encrypt: seal, plaintext: true, packaged: true });
  assert.strictEqual(encoded.sealed, true);
  assert.strictEqual(encoded.payload.toString('utf8').startsWith('{'), false);
  assert.strictEqual(settingsCodec.decodeSettings(encoded.payload, { decrypt: open, plaintext: true, packaged: true }), '{"spaces":["A"]}');
});

test('a store past its limit is refused instead of written', () => {
  assert.strictEqual(settingsCodec.encodeSettings({ big: 'x'.repeat(100) }, { limit: 32, encrypt: seal }), null);
  assert.strictEqual(settingsCodec.encodeSettings({ big: 'x'.repeat(100) }, { limit: 32, plaintext: true, packaged: true }), null);
});

test('a store that cannot be read is null, not a guess', () => {
  const encoded = settingsCodec.encodeSettings({ spaces: ['A'] }, { limit: 1000, encrypt: seal });
  assert.strictEqual(settingsCodec.decodeSettings(encoded.payload), null, 'no key, no plaintext: nothing to read');
  assert.throws(() => settingsCodec.decodeSettings(encoded.payload, { decrypt: () => { throw new Error('bad key'); } }),
    /bad key/, 'a key that fails is an error for loadSettings to catch, never a silent guess');
});
