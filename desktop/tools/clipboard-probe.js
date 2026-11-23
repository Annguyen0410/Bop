'use strict';
// Dev probe: paste an image from the REAL system clipboard under Electron 45. Never packaged.
const { app, clipboard, ClipboardItem, nativeImage } = require('electron');
const clipboardBridge = require('../src/main/clipboard-bridge.js');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  const out = {};
  try {
    const source = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'screenshots', 'bop-013-portable-bubble.png')));
    const png = source.toPNG();
    out.sourceSize = source.getSize();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png]) })]);
    out.writeShape = { readImage: typeof clipboard.readImage, read: typeof clipboard.read };
    const pasted = await clipboardBridge.readClipboardImage(clipboard, nativeImage);
    out.pasted = pasted ? { size: pasted.getSize(), isEmpty: pasted.isEmpty() } : null;
    out.roundTripped = !!pasted && pasted.getSize().width === out.sourceSize.width && pasted.getSize().height === out.sourceSize.height;
  } catch (error) {
    out.error = String(error && error.stack || error);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  app.exit(out.roundTripped ? 0 : 1);
});
