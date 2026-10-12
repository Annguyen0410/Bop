'use strict';

/**
 * Keeps a notification from saying the same thing twice.
 *
 * Reported: *"once it has notified me, if it is still exactly the same it must not notify again — only
 * notify when there is something new."* Two real cases behind that: a watched page that sits on the
 * same line re-reads to the same words every interval, and a site that re-raises the same
 * notification (a badge that re-renders, a poller that repeats its last result). Both used to ding the
 * desktop again, which is the "app spams me" complaint.
 *
 * The rule is deliberately narrow, so a real arrival is never swallowed: only the **most recent**
 * notification of a space is remembered, and only for that space. A change to anything the user would
 * read — the space, the kind, the title or the body — notifies again, and the same words *after* a
 * different notification are new again, because that is a second event and not a repeat.
 *
 * Nothing here is persisted: a restart re-arms every space, which is the safe direction (a missed
 * reminder is worse than one repeated reminder after a relaunch).
 */

/** What the user would read, plus which space said it. */
function keyOf(alert) {
  if (!alert) return null;
  return JSON.stringify([alert.spaceId == null ? '' : String(alert.spaceId), alert.kind || '', alert.title || '', alert.body || '']);
}

function empty() {
  return new Map();
}

/**
 * One alert arrives. Returns the next log and whether the desktop should be told about it at all:
 * `notify` is false only when this space's previous notification said exactly the same thing.
 */
function arrive(log, alert) {
  const previous = log instanceof Map ? log : empty();
  const key = keyOf(alert);
  if (!key) return { notify: false, log: previous };
  const spaceId = alert.spaceId == null ? '' : String(alert.spaceId);
  const notify = previous.get(spaceId) !== key;
  const next = new Map(previous);
  next.set(spaceId, key);
  return { notify, log: next };
}

/** Forgets one space, so the next alert from it is treated as new. Used when a space is stopped. */
function forget(log, spaceId) {
  const previous = log instanceof Map ? log : empty();
  const next = new Map(previous);
  next.delete(spaceId == null ? '' : String(spaceId));
  return next;
}

module.exports = { keyOf, empty, arrive, forget };
