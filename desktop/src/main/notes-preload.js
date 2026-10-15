'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bop', {
  notes: {
    snapshot: () => ipcRenderer.invoke('bop:notes-snapshot'),
    add: (note) => ipcRenderer.invoke('bop:notes-add', note),
    remove: (id) => ipcRenderer.invoke('bop:notes-delete', id),
    copyPairing: () => ipcRenderer.invoke('bop:notes-copy-pairing'),
    pasteImage: () => ipcRenderer.invoke('bop:notes-paste-image'),
    setSync: (enabled) => ipcRenderer.invoke('bop:notes-settings-enable', enabled === true),
    onChanged: (handler) => ipcRenderer.on('bop:notes-changed', () => handler()),
    onSettings: (handler) => ipcRenderer.on('bop:notes-settings', (_event, status) => handler(status)),
  },
});
