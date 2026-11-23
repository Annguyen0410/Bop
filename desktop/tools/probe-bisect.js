'use strict';
// Dev probe: bisect the sandboxed-view path. node tools/probe-bisect.js <a|b|c|d>
const sub = String(process.argv[2] || 'a');
const path = require('node:path');
const { app, WebContentsView } = require('electron');
const say = (value) => { try { fs.writeSync(1, JSON.stringify(value) + '\n'); } catch (_) { console.log(JSON.stringify(value)); } };
const fs = require('node:fs');
say({ sub, phase: 'start', versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node } });
const webPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false };
if (sub === 'c' || sub === 'd') {
  webPreferences.preload = path.join(__dirname, 'probe-preload.js');
  webPreferences.additionalArguments = ['--bop-space=PROBE'];
}
app.whenReady().then(() => run());
function run() {
const view = new WebContentsView({ webPreferences });
say({ sub, phase: 'view-created' });
if (sub === 'a') { app.exit(0); return; }
const contents = view.webContents;
contents.loadURL('data:text/html,<title>(3) Probe</title><body>probe</body>')
  .then(async () => {
    say({ sub, phase: 'loaded', title: contents.getTitle() });
    if (sub === 'd') say({ sub, phase: 'probe', sandboxedPreload: await contents.executeJavaScript('window.__probe || null') });
    app.exit(0);
  })
  .catch((error) => { say({ sub, phase: 'load-error', error: String(error) }); app.exit(1); });
}
