'use strict';

// Self-contained: Electron serializes this function into the main world at document start.
module.exports = function installNotificationBridge(spaceId) {
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
};
