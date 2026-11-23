'use strict';
// Dev probe, one stage at a time: node tools/probe-stage.js <1..4>
const stage = Number(process.argv[2] || '1');
const out = (value) => { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); };
const path = require('node:path');
const { app } = require('electron');
if (stage === 1) {
  out({ stage, versions: process.versions, userData: app.getPath('userData'), isPackaged: app.isPackaged });
  app.exit(0);
} else if (stage === 2) {
  const { clipboard } = require('electron');
  out({ stage, clipboard: { readImage: typeof clipboard.readImage, writeText: typeof clipboard.writeText, readText: typeof clipboard.readText, read: typeof clipboard.read, write: typeof clipboard.write } });
  app.exit(0);
} else if (stage === 3) {
  const { safeStorage } = require('electron');
  out({ stage, safeStorage: {
    isEncryptionAvailable: typeof safeStorage.isEncryptionAvailable, encryptString: typeof safeStorage.encryptString,
    decryptString: typeof safeStorage.decryptString, isAsyncEncryptionAvailable: typeof safeStorage.isAsyncEncryptionAvailable,
    encryptStringAsync: typeof safeStorage.encryptStringAsync, decryptStringAsync: typeof safeStorage.decryptStringAsync } });
  app.exit(0);
} else {
  const { WebContentsView, clipboard, safeStorage } = require('electron');
  const view = new WebContentsView({ webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false,
    preload: path.join(__dirname, 'probe-preload.js'), additionalArguments: ['--bop-space=PROBE'] } });
  const contents = view.webContents;
  out({ stage, versions: process.versions,
    clipboard: { readImage: typeof clipboard.readImage, writeText: typeof clipboard.writeText },
    safeStorage: { encryptString: typeof safeStorage.encryptString } });
  contents.loadURL('data:text/html,<title>(3) Probe</title><body>probe</body>')
    .then(async () => {
      out({ title: contents.getTitle(), sandboxedPreload: await contents.executeJavaScript('window.__probe || null') });
      app.exit(0);
    })
    .catch((error) => { out({ loadError: String(error) }); app.exit(1); });
}
