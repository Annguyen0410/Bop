'use strict';

/**
 * Repeated profiling procedure for the cost Bop pays per background event.
 *
 * Run it with Electron, because half of the cost is `safeStorage`:
 *
 *     cd desktop && npx electron tools/perf-notes.js
 *
 * It does not read or write the real Bop profile: the payload is generated in memory and any file it
 * writes goes to a fresh directory under the operating system's temp folder, which it removes again.
 *
 * What it measures, and why those are the right numbers:
 *
 * Before 0.2.8 one `saveSettings()` sealed the *whole* state — settings plus every note attachment — and
 * `saveSettings()` runs whenever a background event changes anything (an unread count rising, a watched
 * page being read, a space resting or waking). That is JSON serialisation, AES over the result and a
 * synchronous write, all on the Electron main thread — the thread that also lays out every window. The
 * note bodies are now a separate store, so the same event seals only the small settings store.
 *
 * The benchmark seals both shapes with the same code path and reports milliseconds and bytes, so the
 * difference is a measurement of one machine rather than a claim about another one.
 */

const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** A realistic attachment: a 500 KB JPEG is the documented ceiling, base64 makes it ~667 KB on disk. */
const IMAGE_BYTES = 500_000;
const NOTES = 8;
const ROUNDS = 7;

function notePayload() {
  const image = Buffer.alloc(IMAGE_BYTES, 7).toString('base64');
  return Array.from({ length: NOTES }, (_value, index) => ({
    id: `perf-note-${index}`, text: `Seeded note ${index}`, image, mime: 'image/jpeg',
    sender: 'Desktop', timestamp: Date.now() + index, deletedAt: 0,
  }));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Times one full seal-and-write of [value], the exact work a save does. */
function sealAndWrite(target, value) {
  const started = process.hrtime.bigint();
  const json = JSON.stringify(value);
  const bytes = Buffer.byteLength(json, 'utf8');
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.concat([Buffer.from('BOP0', 'utf8'), Buffer.from(json, 'utf8')]);
  fs.writeFileSync(target, payload);
  const finished = process.hrtime.bigint();
  return { ms: Number(finished - started) / 1e6, bytes, written: payload.length };
}

app.whenReady().then(() => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bop-perf-'));
  const notes = notePayload();
  const withoutNotes = {
    version: 5, spaces: [], slots: ['A', 'B', 'C'], loadedSlots: ['A', 'B', 'C'], theme: 'system',
    bubble: true, monitorState: { A: { unread: 3 }, B: { unread: 0 }, C: { unread: 12 } },
    watchWhileRunning: true, messageSound: true, cacheBudgetMb: 512, liveLimit: 3,
  };
  // Exactly the two shapes a save produces: the old single store, and the small one plus the note store.
  const before = { ...withoutNotes, notes };
  const afterSettings = { ...withoutNotes };
  const afterNotes = { version: 1, notes, noteTombstones: [] };

  const beforeRuns = [];
  const afterRuns = [];
  const noteStoreWrites = [];
  try {
    for (let round = 0; round < ROUNDS; round += 1) {
      beforeRuns.push(sealAndWrite(path.join(directory, 'before.bin'), before));
      afterRuns.push(sealAndWrite(path.join(directory, 'after-settings.bin'), afterSettings));
    }
    // The note store is written once, when notes actually change — not on this event.
    noteStoreWrites.push(sealAndWrite(path.join(directory, 'after-notes.bin'), afterNotes));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const report = {
    measuredOn: `${process.platform} ${process.arch}`,
    electron: process.versions.electron,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    notes: NOTES,
    imageBytes: IMAGE_BYTES,
    rounds: ROUNDS,
    before: {
      description: 'one settings blob holding settings + every note body (0.2.7 behaviour)',
      medianMsPerSave: +median(beforeRuns.map((run) => run.ms)).toFixed(2),
      settingsBytes: beforeRuns[0].bytes,
      writtenBytes: beforeRuns[0].written,
    },
    after: {
      description: 'small settings store per event; note bodies written only when notes change',
      medianMsPerSave: +median(afterRuns.map((run) => run.ms)).toFixed(2),
      settingsBytes: afterRuns[0].bytes,
      writtenBytes: afterRuns[0].written,
    },
    noteStore: {
      description: 'one write when a note is added or deleted, not per event',
      msPerWrite: +noteStoreWrites[0].ms.toFixed(2),
      bytes: noteStoreWrites[0].bytes,
    },
  };
  report.perEvent = {
    removedMs: +(report.before.medianMsPerSave - report.after.medianMsPerSave).toFixed(2),
    removedBytes: report.before.writtenBytes - report.after.writtenBytes,
    ratio: +(report.before.medianMsPerSave / Math.max(report.after.medianMsPerSave, 0.01)).toFixed(1),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  app.exit(0);
});
