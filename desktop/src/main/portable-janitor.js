'use strict';

/**
 * Copies that earlier portable launches left in the temporary folder.
 *
 * The portable build is a self-extracting wrapper. On every launch it unpacks the whole app (a few hundred MB)
 * into `%TEMP%` and deletes that copy only after the app has exited *and* the wrapper gets to run its cleanup.
 * Sign-out, a reboot or a killed process ends the wrapper before that point, so every sign-in that started
 * the portable exe left one copy behind: about 29 GB in two days on one machine.
 *
 * Each portable launch sweeps those copies. A copy is busy while any file directly inside it is open or
 * loaded: Windows refuses to open such a file for writing (a running exe, a loaded DLL), so a busy copy is
 * skipped whole. A free copy is first renamed to a new name and then deleted, so no half-deleted folder is
 * ever left looking like a live one. A copy younger than SETTLE_MS may still be extracting, so it is left
 * alone too. The copy running right now is never touched.
 *
 * Every side effect is passed in, so the rules are unit-tested rather than described.
 */

const path = require('node:path');
const fs = require('node:fs');

/** A copy created this recently may still be extracting, so it is not treated as abandoned. */
const SETTLE_MS = 10 * 60 * 1000;

/** Where the wrapper may place the app's executable inside its temporary folder: the folder itself or one level down. */
const LAYOUTS = ['', 'app', '7z-out'];

/**
 * The name a copy gets when a sweep moves it aside before deleting it (see [moveAside]). A folder left under
 * this name is the husk of an interrupted deletion: the sweep that renamed it could not finish removing it,
 * because the wrapper of the run that owned it still held a handle on one of its files. Nothing else would
 * ever match it again — the copy inside is already gone, so it no longer looks like an app copy at all.
 */
const HUSK = /\.gone-\d+-\d+$/;

function sameFile(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/**
 * The unpacked copy inside one entry of the temporary folder, or null. An Electron app always has a
 * `resources` folder beside its executable, so a folder that merely has a matching file name is not a copy.
 */
function copyInside(tempDir, entryName, exeName) {
  const top = path.join(tempDir, entryName);
  for (const layout of LAYOUTS) {
    const dir = path.join(top, layout);
    const exe = path.join(dir, exeName);
    if (fs.existsSync(path.join(dir, 'resources')) && fs.existsSync(exe)) return { root: top, exe };
  }
  return null;
}

/** True when a file is open or loaded by a process: Windows will not open such a file for writing. */
function fileBusy(file) {
  try {
    fs.closeSync(fs.openSync(file, 'r+'));
    return false;
  } catch (error) {
    return error.code !== 'ENOENT';
  }
}

/**
 * True when any file directly inside the copy, or beside its executable, is busy. A file that cannot even be
 * listed counts as busy, so an unreadable copy is left alone rather than guessed at.
 */
function copyBusy(found) {
  for (const dir of new Set([found.root, path.dirname(found.exe)])) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return true;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).isFile() && fileBusy(file)) return true;
      } catch {
        return true;
      }
    }
  }
  return false;
}

/** Moves a folder to a fresh name beside it, so the copy being deleted is never mistaken for a live one. */
function moveAside(folder) {
  const aside = `${folder}.gone-${process.pid}-${Date.now()}`;
  return fs.promises.rename(folder, aside).then(() => aside);
}

/**
 * Deletes the abandoned copies in `tempDir` that run an executable named like `exePath`, and returns the
 * folders it removed. `now`, `busy` and `moveAside` are injectable so the rules can be tested without
 * waiting or a second process.
 */
async function sweepStaleCopies(options) {
  const {
    tempDir,
    exePath,
    now = Date.now(),
    busy = copyBusy,
    claim = moveAside,
  } = options;
  const exeName = path.basename(exePath);
  const removed = [];
  let entries;
  try {
    entries = await fs.promises.readdir(tempDir, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // A husk is finished here rather than left for a sweep that would never match it: the copy inside has
    // already been deleted, so it no longer looks like a copy of this app and nothing else would ever pick
    // it up. Without this, every interrupted sweep left one behind, each with a longer name than the last.
    if (HUSK.test(entry.name)) {
      const husk = path.join(tempDir, entry.name);
      const huskStat = await fs.promises.stat(husk).catch(() => null);
      if (huskStat) {
        const born = huskStat.birthtimeMs > 0 ? huskStat.birthtimeMs : huskStat.mtimeMs;
        if (now - born >= SETTLE_MS) {
          try {
            await fs.promises.rm(husk, { recursive: true, force: true, maxRetries: 2 });
            removed.push(husk);
          } catch {
            // Still held by the wrapper whose run owned the copy; the next sweep tries again.
          }
        }
      }
      continue;
    }
    const found = copyInside(tempDir, entry.name, exeName);
    if (!found) continue;
    if (sameFile(found.exe, exePath)) continue; // this copy, running right now
    if (busy(found)) continue;
    const stat = await fs.promises.stat(found.root).catch(() => null);
    if (!stat) continue;
    const born = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
    if (now - born < SETTLE_MS) continue;
    let aside;
    try {
      aside = await claim(found.root);
    } catch {
      continue; // in use (Windows refused the move): leave the whole copy for a later launch
    }
    try {
      await fs.promises.rm(aside, { recursive: true, force: true, maxRetries: 2 });
      removed.push(found.root);
    } catch {
      // The copy is already out of the way under its new name; a later sweep will finish it.
    }
  }
  return removed;
}

module.exports = { sweepStaleCopies, copyBusy, moveAside, SETTLE_MS, LAYOUTS, HUSK };
