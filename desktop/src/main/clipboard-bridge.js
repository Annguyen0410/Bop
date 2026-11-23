'use strict';

/**
 * The clipboard, as Bop's note windows use it: pasting an image from the system clipboard and copying
 * the LAN-pairing code back out.
 *
 * It exists because the clipboard is the one Electron API this app uses that changed underneath it.
 * Electron 44 rearchitected the module to the W3C Clipboard API (`clipboard.read()` returning
 * ClipboardItems) and Electron 45 removed `clipboard.readImage()` entirely — measured on this build,
 * `typeof clipboard.readImage === 'undefined'` under Electron 45.4.1. Before this module, "Paste image"
 * called that method directly, so the button threw instead of pasting.
 *
 * Both shapes are supported here on purpose: the synchronous `readImage` of Electron <= 43 and the
 * ClipboardItem shape of 44+, so the app runs on either and the next removal is caught by a test.
 */

/** The formats a clipboard image arrives in, most preferred first. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/bmp', 'image/gif', 'image/webp'];

/**
 * The image currently on the clipboard, or null when there is none. Never throws: "the clipboard has
 * no picture" is a sentence for the user, not a crash.
 */
async function readClipboardImage(clipboard, nativeImage) {
  // Electron <= 43: one synchronous call hands over the decoded image.
  if (typeof clipboard.readImage === 'function') {
    const image = clipboard.readImage();
    return image && !image.isEmpty() ? image : null;
  }
  // Electron 44+: the rearchitected clipboard is the W3C model — the system clipboard as items, each
  // with its MIME types, and an image is a blob to hand to nativeImage. `clipboard.readImage` is gone.
  if (typeof clipboard.read !== 'function') return null;
  try {
    const items = await clipboard.read();
    for (const item of items || []) {
      for (const type of IMAGE_TYPES) {
        if (!Array.isArray(item.types) || !item.types.includes(type)) continue;
        const blob = await item.getType(type);
        const bytes = Buffer.from(await blob.arrayBuffer());
        const image = bytes.length ? nativeImage.createFromBuffer(bytes) : null;
        if (image && !image.isEmpty()) return image;
      }
    }
  } catch (_) {
    return null; // A clipboard that will not be read is an empty clipboard for this app.
  }
  return null;
}

/** Writes text to the clipboard and waits for it, because Electron 45's `writeText` returns a promise. */
async function writeClipboardText(clipboard, text) {
  const result = clipboard.writeText(text);
  if (result && typeof result.then === 'function') await result;
}

module.exports = { readClipboardImage, writeClipboardText, IMAGE_TYPES };
