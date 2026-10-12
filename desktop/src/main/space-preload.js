'use strict';

/** Remote pages can report their own notifications, never control Bop or pick an account id. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__bopNotify', (payload) => {
  if (!payload || typeof payload !== 'object') return;
  ipcRenderer.send('bop:web-notification', {
    title: String(payload.title == null ? '' : payload.title).slice(0, 300),
    body: String(payload.body == null ? '' : payload.body).slice(0, 1000),
    tag: String(payload.tag == null ? '' : payload.tag).slice(0, 200),
    eventId: String(payload.eventId == null ? '' : payload.eventId).slice(0, 180),
  });
});

// Execute synchronously in preload, not dom-ready: sites can cache Notification or notify in an
// inline script before dom-ready. Context isolation and the notification-only bridge stay intact.
// This covers window.Notification, NOT service-worker showNotification or provider web push.
if (process.isMainFrame) {
  const argument = process.argv.find((value) => value.startsWith('--bop-space='));
  contextBridge.executeInMainWorld({
    func: require('./notification-bridge.js'),
    args: [argument ? argument.slice('--bop-space='.length) : 'unknown'],
  });
}
