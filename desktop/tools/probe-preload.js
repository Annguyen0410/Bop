'use strict';
// Dev probe: what a SANDBOXED preload can still see (Electron 45). Never packaged.
const { contextBridge, ipcRenderer } = require('electron');
const seen = {
  processArgv: typeof process.argv,
  isMainFrame: process.isMainFrame,
  argvHasSpace: process.argv.some((value) => String(value).startsWith('--bop-space=')),
  ipcRendererSend: typeof ipcRenderer.send,
  siblingRequire: null,
  bufferGlobal: typeof Buffer,
};
try { seen.siblingRequire = String(require('./probe-sibling.js')()); } catch (error) { seen.siblingRequire = `error: ${error.message}`; }
contextBridge.exposeInMainWorld('__probe', seen);
