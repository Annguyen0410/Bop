'use strict';

/**
 * The bubble's face, from a picture the user picked.
 *
 * The picture is stored as a data URL *inside* the settings file rather than as a path to it: a path
 * breaks the moment the picture is moved, renamed or deleted, and this is the one piece of the bubble
 * the user chose by hand. That choice sets the size rules below — the settings file is rewritten on
 * every change, so a 4000px phone photo must not end up in it.
 *
 * `nativeImage` and the file reader are handed in, so the rules (square, bounded, small enough) are
 * unit-tested with a stub while the app passes Electron's real decoder. The smoke run drives the same
 * function with a real PNG on disk.
 */

/** The longest edge kept, in pixels. 256 of PNG is roughly 150 KB of base64 for a photo. */
const MAX_EDGE = 256;
/** If the first attempt is still too big for the settings file, the avatar is retried at this edge. */
const FALLBACK_EDGE = 128;
/** Characters of data URL allowed in the settings file — about 300 KB of image. */
const MAX_LENGTH = 400_000;
/** A vector face is kept as it is: scaling it up is the point of a vector. */
const MAX_SVG_BYTES = 60_000;
/** Refused before any decoding: a settings file is not a place for a 40 MB picture. */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * The largest centred square inside a picture. A face is a circle, so a portrait crop would be
 * squashed if it were resized straight to a square.
 */
function squareCrop(width, height) {
  const edge = Math.max(Math.min(width, height), 1);
  // A degenerate size — a decoder that reports 0 — still has to name a box inside the picture: without
  // the lower bound the crop of a 0×0 image starts at -1, which is off the picture it crops.
  return {
    x: Math.max(Math.floor((width - edge) / 2), 0),
    y: Math.max(Math.floor((height - edge) / 2), 0),
    width: edge,
    height: edge,
  };
}

/** True for the only shape a stored avatar may have. */
function isAvatar(value) {
  return typeof value === 'string' && value.length <= MAX_LENGTH && /^data:image\//.test(value);
}

function looksLikeSvg(text) {
  const head = text.replace(/^\uFEFF/, '').trim().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

/**
 * Turns a picture file into the stored avatar. Returns `{ dataUrl, pixels }` or `{ error }` — never
 * throws, because the caller is a dialog that has to answer with words.
 */
function avatarFromFile(file, nativeImage, readFile) {
  const read = readFile || ((target) => require('node:fs').readFileSync(target));
  let raw = null;
  try {
    raw = read(file);
  } catch (_) {
    return { error: 'That file could not be read.' };
  }
  if (!raw || !raw.length) return { error: 'That file is empty.' };
  if (raw.length > MAX_FILE_BYTES) return { error: 'That picture is over 12 MB. Pick a smaller one.' };

  if (looksLikeSvg(raw.toString('utf8', 0, Math.min(raw.length, 2048)))) {
    if (raw.length > MAX_SVG_BYTES) return { error: 'That drawing is over 60 KB of SVG. Simplify it and try again.' };
    return {
      dataUrl: `data:image/svg+xml;base64,${raw.toString('base64')}`,
      pixels: { source: { kind: 'svg' }, kept: null },
    };
  }

  const image = nativeImage.createFromBuffer(raw);
  if (!image || image.isEmpty()) return { error: 'Bop cannot read that file as a picture. PNG, JPEG, WebP, BMP and SVG work.' };
  const size = image.getSize();
  if (!size || !size.width || !size.height) return { error: 'That picture has no pixels Bop can use.' };

  const square = image.crop(squareCrop(size.width, size.height));
  const shrink = (edge) => square.resize({ width: edge, height: edge, quality: 'best' }).toDataURL();
  let kept = Math.min(MAX_EDGE, size.width, size.height);
  let dataUrl = shrink(kept);
  if (dataUrl.length > MAX_LENGTH && kept > FALLBACK_EDGE) {
    kept = FALLBACK_EDGE;
    dataUrl = shrink(kept);
  }
  if (dataUrl.length > MAX_LENGTH) return { error: 'That picture does not compress small enough to keep in Bop\'s settings file.' };
  return { dataUrl, pixels: { source: { width: size.width, height: size.height }, kept } };
}

module.exports = { MAX_EDGE, FALLBACK_EDGE, MAX_LENGTH, MAX_SVG_BYTES, MAX_FILE_BYTES, squareCrop, isAvatar, looksLikeSvg, avatarFromFile };
