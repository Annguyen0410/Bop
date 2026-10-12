'use strict';

/**
 * Starting with the computer.
 *
 * Bop is only useful if it is already listening before the first message arrives, so the app asks the
 * operating system to launch it at sign-in. Windows implements that as a value under
 * `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, which Electron writes through
 * `app.setLoginItemSettings`.
 *
 * The one thing that is easy to get wrong is *which file* to register:
 *
 * - A **portable** build unpacks itself into a fresh temporary directory on every launch and deletes it
 *   on exit, so `process.execPath` names a path that will not exist at the next sign-in. electron-builder
 *   publishes the original file in `PORTABLE_EXECUTABLE_FILE`, and that is what has to be registered.
 * - An **installed** build is started from its own `Bop.exe`, so `process.execPath` is already right.
 * - A **development** run (`electron .`) would register `electron.exe` from `node_modules` and launch a
 *   bare Electron with no app at sign-in. That must never be written, so `loginItem` refuses it and the
 *   app says so instead of pretending.
 *
 * Pure on purpose: every branch is unit-tested instead of being described.
 */

/** Marks a launch that the operating system started, so the dashboard can stay out of the way. */
const FLAG = '--bop-autostart';

/** What to register with the OS, or null when this run must not register anything. */
function loginItem(options) {
  const settings = options || {};
  if (settings.packaged !== true) return null;
  const portable = typeof settings.portableExe === 'string' && settings.portableExe.trim() ? settings.portableExe : null;
  const exec = typeof settings.execPath === 'string' && settings.execPath.trim() ? settings.execPath : null;
  const target = portable || exec;
  if (!target) return null;
  return { path: target, args: [FLAG] };
}

/** True when the OS started this copy, so Bop shows the tray and the bubble and no dashboard. */
function launchedAtLogin(argv) {
  return Array.isArray(argv) && argv.includes(FLAG);
}

module.exports = { FLAG, loginItem, launchedAtLogin };
