'use strict';

/**
 * Remote pages can report their own notifications, never control Bop or pick an account id.
 *
 * This preload runs sandboxed (`sandbox: true` on the view), which is why the notification bridge is
 * written out below instead of `require`d: measured on Electron 45.4.1, a sandboxed preload can
 * `require('electron')` and read `process.argv` / `process.isMainFrame`, but a relative `require` of a
 * sibling module fails outright ("module not found"). The copy below is kept byte-identical to
 * `notification-bridge.js` by test/sandbox-surface.test.js, so the two cannot drift apart.
 */
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
// --- keep-in-sync: notification-bridge.js ---
function installNotificationBridge(spaceId) {
  const Native = window.Notification;
  if (typeof Native !== 'function') return false;
  let sequence = 0;
  const documentId = window.crypto.randomUUID();
  window.Notification = new Proxy(Native, {
    construct(target, args) {
      const title = String(args[0] == null ? '' : args[0]);
      const options = args[1] == null ? {} : args[1];
      const originalTag = options.tag == null ? '' : String(options.tag);
      // Bop owns the sound when its pipeline detects this signal. Avoid two native dings.
      const nativeOptions = { ...options, silent: true, tag: originalTag ? `bop:${spaceId}:${originalTag}` : '' };
      const notice = Reflect.construct(target, [`Account ${spaceId} · ${title}`, nativeOptions]);
      // Only a successfully created native notification is mirrored. Native denial/errors propagate.
      const eventId = `${documentId}:${++sequence}`;
      const tag = originalTag || `untagged:${eventId}`;
      window.__bopNotify({ title, body: notice.body || '', tag, eventId });
      notice.addEventListener('click', () => window.focus());
      return notice;
    },
  });
  return true;
}
// --- /keep-in-sync ---

if (process.isMainFrame) {
  const argument = process.argv.find((value) => value.startsWith('--bop-space='));
  contextBridge.executeInMainWorld({
    func: installNotificationBridge,
    args: [argument ? argument.slice('--bop-space='.length) : 'unknown'],
  });
}
