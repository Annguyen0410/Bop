'use strict';

/**
 * The bridge for Bop's own windows only (dashboard, bubble, space menu, reminder card). Loaded from
 * local files, so it exposes the hub's whole control surface. Space pages get `space-preload.js`.
 */

const { contextBridge, ipcRenderer } = require('electron');

// A window that is told its theme up front paints the right colour on its first frame. Without it the
// small windows opened in dark mode while the snapshot was in flight, which is a white flash.
const themeArgument = process.argv.find((value) => value.startsWith('--bop-theme='));

contextBridge.exposeInMainWorld('bop', {
  initialTheme: themeArgument ? themeArgument.slice('--bop-theme='.length) : null,
  snapshot: () => ipcRenderer.invoke('bop:snapshot'),
  openNotes: () => ipcRenderer.invoke('bop:notes-open'),
  setNotesSync: (enabled) => ipcRenderer.invoke('bop:notes-enable', enabled === true),
  copyNotesPairing: () => ipcRenderer.invoke('bop:notes-copy-pairing'),
  saveNotesPairingQr: () => ipcRenderer.invoke('bop:notes-save-pairing-qr'),

  addSpace: (request) => ipcRenderer.invoke('bop:add-space', request || {}),
  removeSpace: (id) => ipcRenderer.invoke('bop:remove-space', id),
  rename: (id, label) => ipcRenderer.invoke('bop:rename', id, label),
  selectApp: (id, appId, kind) => ipcRenderer.invoke('bop:select-app', id, appId, kind),
  setUrl: (id, url) => ipcRenderer.invoke('bop:set-url', id, url),
  setWatch: (id, patch) => ipcRenderer.invoke('bop:set-watch', id, patch),
  setPhoneLayout: (id, on) => ipcRenderer.invoke('bop:set-phone-layout', id, on === true),
  setPreference: (key, value) => ipcRenderer.invoke('bop:set-preference', key, value),
  setBubble: (patch) => ipcRenderer.invoke('bop:set-bubble', patch || {}),
  // Opens the operating system's picture picker; the result is already decoded, cropped and small.
  chooseBubbleAvatar: () => ipcRenderer.invoke('bop:choose-bubble-avatar'),
  clearBubbleAvatar: () => ipcRenderer.invoke('bop:clear-bubble-avatar'),

  openSpace: (id) => ipcRenderer.invoke('bop:open-space', id),
  // The dashboard's dialogs are drawn by this renderer, which sits *below* the space panes in the
  // window; the main process raises it while a dialog is open so the dialog is clickable, not just
  // visible. See applyViewOrder in main.js.
  setModal: (open) => ipcRenderer.send('bop:modal', open === true),
  closeSpace: () => ipcRenderer.invoke('bop:close-space'),
  loadSpace: (id) => ipcRenderer.invoke('bop:load-space', id),
  reloadSpace: (id) => ipcRenderer.invoke('bop:reload-space', id),
  clearSpace: (id) => ipcRenderer.invoke('bop:clear-space', id),
  stopSpace: (id) => ipcRenderer.invoke('bop:stop-space', id),

  checkNow: () => ipcRenderer.invoke('bop:check-now'),

  acknowledge: (alertKey) => ipcRenderer.invoke('bop:ack', alertKey),
  acknowledgeAll: (id) => ipcRenderer.invoke('bop:ack-all', id || null),
  clearAlerts: () => ipcRenderer.invoke('bop:clear-alerts'),
  openExternal: (url) => ipcRenderer.invoke('bop:open-external', url),

  onChanged: (handler) => ipcRenderer.on('bop:changed', (_event, state) => handler(state)),
  onFocusSpace: (handler) => ipcRenderer.on('bop:focus-space', (_event, id) => handler(id)),

  // The reminder card. It is a surface, not a controller: it can open the account it names and hide
  // itself, and nothing else. Opening it means the user has seen that alert.
  reminder: {
    open: (spaceId, key) => ipcRenderer.send('bop:reminder-open', { spaceId, key }),
    hide: () => ipcRenderer.send('bop:reminder-hide'),
  },
  onReminder: (handler) => ipcRenderer.on('bop:reminder', (_event, card) => handler(card)),

  bubble: {
    // The bubble reports the pointer and main places the window, because the operating system's own
    // drag (`-webkit-app-region`) was measured missing the hand that dragged it, and only the thin ring
    // around the button was draggable at all. See [bubbleDragStart] in main.js.
    dragStart: (point) => ipcRenderer.send('bop:bubble-drag-start', point),
    dragMove: (point) => ipcRenderer.send('bop:bubble-drag-move', point),
    dragEnd: (point) => ipcRenderer.send('bop:bubble-drag-end', point),
    click: () => ipcRenderer.send('bop:bubble-click'),
    double: () => ipcRenderer.send('bop:bubble-double'),
    menu: () => ipcRenderer.send('bop:bubble-menu'),
    // A translucent bubble returns to full strength while the cursor is on it.
    hover: (on) => ipcRenderer.send('bop:bubble-hover', on === true),
    stop: () => ipcRenderer.send('bop:bubble-stop'),
  },
  menu: {
    openSpace: (id) => ipcRenderer.send('bop:menu-open-space', id),
    close: () => ipcRenderer.send('bop:menu-close'),
  },
});
