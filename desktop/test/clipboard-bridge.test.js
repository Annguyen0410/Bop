'use strict';

/**
 * The clipboard, as Bop's note windows use it.
 *
 * These cases exist because Electron 44 rearchitected the clipboard module and Electron 45 removed
 * `clipboard.readImage()` outright (measured on this build: `typeof clipboard.readImage === 'undefined'`
 * under Electron 45.4.1). "Paste image" in the notes window called exactly that method, so an upgrade
 * that left it alone turned a working button into a thrown TypeError. Both clipboard shapes are kept
 * here on purpose: the synchronous `readImage` shape of Electron <= 43 and the ClipboardItem shape of
 * Electron 44+, so the app works on either and a future removal is caught by a test rather than by a user.
 */

const test = require('node:test');
const assert = require('node:assert');

const clipboardBridge = require('../src/main/clipboard-bridge.js');

/** A nativeImage stand-in: the bridge only reads `isEmpty` and hands the object straight back. */
const fakeImage = (bytes = [1, 2, 3]) => ({ isEmpty: () => bytes.length === 0, bytes });
const fakeNativeImage = {
  created: [],
  createFromBuffer(buffer) {
    const image = fakeImage(Array.from(buffer));
    this.created.push(image);
    return image;
  },
};

const blobOf = (...bytes) => ({ arrayBuffer: async () => Uint8Array.from(bytes).buffer });

test('a pasted note image is read through the old synchronous clipboard', async () => {
  const image = fakeImage();
  const clipboard = { readImage: () => image };
  assert.strictEqual(await clipboardBridge.readClipboardImage(clipboard, fakeNativeImage), image);
});

test('a pasted note image is read through the ClipboardItem clipboard of Electron 45', async () => {
  const clipboard = {
    read: async () => [
      { types: ['text/plain'], getType: async () => blobOf(72, 73) },
      { types: ['image/png'], getType: async () => blobOf(137, 80, 78, 71) },
    ],
  };
  const image = await clipboardBridge.readClipboardImage(clipboard, fakeNativeImage);
  assert.ok(image, 'the image on the clipboard is found without clipboard.readImage');
  assert.deepEqual(image.bytes, [137, 80, 78, 71], 'the bytes handed to nativeImage are the blob\'s bytes');
});

test('the second image type is used when the first one is not on the clipboard', async () => {
  const clipboard = {
    read: async () => [{ types: ['text/html', 'image/bmp'], getType: async () => blobOf(66, 77) }],
  };
  const image = await clipboardBridge.readClipboardImage(clipboard, fakeNativeImage);
  assert.deepEqual(image.bytes, [66, 77]);
});

test('an empty clipboard, or one with only text, is "no image" and not an error', async () => {
  for (const clipboard of [
    { read: async () => [] },
    { read: async () => [{ types: ['text/plain'], getType: async () => blobOf(65) }] },
    { readImage: () => fakeImage([]) },
    {},
  ]) {
    assert.strictEqual(await clipboardBridge.readClipboardImage(clipboard, fakeNativeImage), null, JSON.stringify(clipboard));
  }
});

test('a blob that cannot be decoded is no image either', async () => {
  const clipboard = {
    read: async () => [{ types: ['image/png'], getType: async () => { throw new Error('gone'); } }],
  };
  assert.strictEqual(await clipboardBridge.readClipboardImage(clipboard, fakeNativeImage), null);
});

test('writing the pairing code waits for the asynchronous clipboard', async () => {
  let written = null;
  let released = false;
  const clipboard = {
    writeText: (text) => { written = text; return new Promise((resolve) => setTimeout(() => { released = true; resolve(); }, 5)); },
  };
  await clipboardBridge.writeClipboardText(clipboard, 'PAIR-1');
  assert.strictEqual(written, 'PAIR-1');
  assert.ok(released, 'the caller waits for the promise Electron 45 returns');
});

test('a synchronous clipboard still writes the pairing code', async () => {
  const written = [];
  await clipboardBridge.writeClipboardText({ writeText: (text) => written.push(text) }, 'PAIR-2');
  assert.deepEqual(written, ['PAIR-2']);
});