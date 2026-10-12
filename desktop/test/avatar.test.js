'use strict';

/**
 * The bubble's picture is the one setting the user chose by hand, so the rules around it are tested with
 * a stub decoder: square, never upscaled, bounded, and storable in a settings file that is rewritten on
 * every change. The smoke run drives the same function with Electron's real decoder and a real PNG.
 */

const test = require('node:test');
const assert = require('node:assert');
const avatar = require('../src/main/avatar.js');
const spaces = require('../src/main/spaces.js');

/** A stand-in for Electron's nativeImage that records what was asked of it. */
function decoder(size, { url = null, empty = false } = {}) {
  const calls = [];
  const image = {
    isEmpty: () => empty,
    getSize: () => size,
    crop(box) { calls.push(['crop', box]); return image; },
    resize(options) { calls.push(['resize', options]); return { toDataURL: () => (url === null ? `data:image/png;base64,${'A'.repeat(options.width * 4)}` : url) }; },
  };
  return { nativeImage: { createFromBuffer: () => image }, calls };
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const readOf = (buffer) => () => buffer;

test('a picture is cropped to its largest centred square, never stretched', () => {
  assert.deepEqual(avatar.squareCrop(400, 200), { x: 100, y: 0, width: 200, height: 200 });
  assert.deepEqual(avatar.squareCrop(200, 400), { x: 0, y: 100, width: 200, height: 200 });
  assert.deepEqual(avatar.squareCrop(300, 300), { x: 0, y: 0, width: 300, height: 300 });
  assert.deepEqual(avatar.squareCrop(0, 0), { x: 0, y: 0, width: 1, height: 1 });

  const { nativeImage, calls } = decoder({ width: 900, height: 400 });
  const kept = avatar.avatarFromFile('face.png', nativeImage, readOf(png));
  assert.deepEqual(calls[0], ['crop', { x: 250, y: 0, width: 400, height: 400 }]);
  assert.equal(kept.pixels.kept, avatar.MAX_EDGE, 'a big picture comes down to the stored edge');
  assert.equal(kept.pixels.source.width, 900);
});

test('a small picture is never blown up', () => {
  const { nativeImage, calls } = decoder({ width: 40, height: 40 });
  const kept = avatar.avatarFromFile('icon.png', nativeImage, readOf(png));
  assert.equal(kept.pixels.kept, 40);
  assert.equal(calls[1][1].width, 40);
});

test('a picture that will not fit the settings file is retried smaller, then refused', () => {
  const fat = decoder({ width: 800, height: 800 }, { url: `data:image/png;base64,${'B'.repeat(avatar.MAX_LENGTH + 1)}` });
  const refused = avatar.avatarFromFile('huge.png', fat.nativeImage, readOf(png));
  assert.match(refused.error, /settings file/);
  assert.equal(refused.dataUrl, undefined);

  // One retry at the fallback edge, and that one is kept: the retry is the difference between "your
  // picture is too big" and a bubble that simply wears a smaller version of it.
  const attempts = [];
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 800, height: 800 }),
    resize: (options) => {
      attempts.push(options.width);
      return { toDataURL: () => (attempts.length === 1 ? `data:image/png;base64,${'C'.repeat(avatar.MAX_LENGTH + 1)}` : 'data:image/png;base64,small') };
    },
  };
  image.crop = () => image;
  const kept = avatar.avatarFromFile('big.png', { createFromBuffer: () => image }, readOf(png));
  assert.deepEqual(attempts, [avatar.MAX_EDGE, avatar.FALLBACK_EDGE]);
  assert.equal(kept.dataUrl, 'data:image/png;base64,small');
  assert.equal(kept.pixels.kept, avatar.FALLBACK_EDGE);
});

test('a vector drawing is kept as a vector, and a broken file is named as one', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12"/></svg>');
  const kept = avatar.avatarFromFile('face.svg', decoder({}).nativeImage, readOf(svg));
  assert.ok(kept.dataUrl.startsWith('data:image/svg+xml;base64,'));
  assert.equal(Buffer.from(kept.dataUrl.split(',')[1], 'base64').toString('utf8'), svg.toString('utf8'));

  const big = Buffer.concat([Buffer.from('<svg '), Buffer.alloc(avatar.MAX_SVG_BYTES, 0x20), Buffer.from('</svg>')]);
  assert.match(avatar.avatarFromFile('big.svg', decoder({}).nativeImage, readOf(big)).error, /SVG/);

  const empty = avatar.avatarFromFile('nothing.png', decoder({ width: 10, height: 10 }, { empty: true }).nativeImage, readOf(png));
  assert.match(empty.error, /PNG, JPEG, WebP, BMP and SVG/);
  assert.match(avatar.avatarFromFile('gone.png', decoder({}).nativeImage, () => { throw new Error('ENOENT'); }).error, /could not be read/);
  assert.match(avatar.avatarFromFile('empty.png', decoder({}).nativeImage, readOf(Buffer.alloc(0))).error, /empty/);
  assert.match(avatar.avatarFromFile('huge.png', decoder({}).nativeImage, readOf(Buffer.alloc(avatar.MAX_FILE_BYTES + 1))).error, /12 MB/);
});

test('only a bounded image data URL is treated as an avatar', () => {
  assert.equal(avatar.isAvatar('data:image/png;base64,AAAA'), true);
  assert.equal(avatar.isAvatar('data:image/svg+xml;base64,AAAA'), true);
  assert.equal(avatar.isAvatar('C:\\pictures\\me.png'), false);
  assert.equal(avatar.isAvatar('https://example.com/me.png'), false);
  assert.equal(avatar.isAvatar(''), false);
  assert.equal(avatar.isAvatar(null), false);
  assert.equal(avatar.isAvatar(`data:image/png;base64,${'A'.repeat(avatar.MAX_LENGTH)}`), false);
});

test('what the settings file accepts is exactly what the bubble module produces', () => {
  // The two bounds are the same rule in two files: a picture big enough to be stored must survive being
  // read back, or the bubble would fall back to the drawn face after a restart with no explanation.
  assert.equal(spaces.AVATAR_MAX_LENGTH, avatar.MAX_LENGTH);

  const stored = spaces.normalizeBubblePrefs({ avatar: 'data:image/png;base64,AAAA' });
  assert.equal(stored.avatar, 'data:image/png;base64,AAAA');
  assert.equal(spaces.normalizeBubblePrefs({ avatar: 'C:\\me.png' }).avatar, '', 'a path is not an avatar');
  assert.equal(spaces.normalizeBubblePrefs({ avatar: `data:image/png;base64,${'A'.repeat(avatar.MAX_LENGTH)}` }).avatar, '');
  assert.equal(spaces.normalizeBubblePrefs({}).avatar, '', 'nothing chosen is the drawn face');
  assert.equal(spaces.bubbleDefaults().avatar, '');

  // A patch that does not mention the picture keeps the one that is there.
  const state = { bubblePrefs: spaces.bubbleDefaults() };
  const chosen = spaces.setBubblePref(state, { avatar: 'data:image/png;base64,AAAA' });
  const resized = spaces.setBubblePref(chosen, { size: 80 });
  assert.equal(resized.bubblePrefs.avatar, 'data:image/png;base64,AAAA');
  assert.equal(resized.bubblePrefs.size, 80);
  assert.equal(spaces.setBubblePref(chosen, { avatar: '' }).bubblePrefs.avatar, '');
});
