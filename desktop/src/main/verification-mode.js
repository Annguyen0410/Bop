'use strict';

/**
 * Which verification run this process is, and whether a release build may be one at all.
 *
 * Bop's smoke and acceptance harnesses drive the real app (`--bop-smoke`, `--bop-monitor-smoke`,
 * `--bop-retry-smoke`, `--bop-live-check`, `--bop-out`). They live in `desktop/verify/` and are not
 * packaged, and a packaged build must be inert to every one of these flags: the same command line that
 * makes a development run honest would make a release build dishonest — `--bop-live-check` in particular
 * used to make the settings store write **plaintext** JSON so an outside harness could read it.
 *
 * So the flags are read here, once, and a packaged build gets a mode in which none of them is true. The
 * flags that were present anyway are returned in `ignored` so the refusal can be logged instead of
 * guessed at.
 */

const FLAGS = {
  smoke: '--bop-smoke',
  monitorSmoke: '--bop-monitor-smoke',
  retrySmoke: '--bop-retry-smoke',
  liveCheck: '--bop-live-check',
  active: '--bop-active',
  out: '--bop-out',
};

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
}

/**
 * The mode for one process. `isPackaged` is `app.isPackaged`, passed in so this stays testable without
 * Electron. Every field is false (or null) when the build is packaged, whatever the command line said.
 */
function resolveVerificationMode(argv, { isPackaged } = {}) {
  const list = Array.isArray(argv) ? argv : [];
  const present = Object.values(FLAGS).filter((flag) => list.includes(flag));
  const mode = {
    isPackaged: !!isPackaged,
    smoke: false,
    monitorSmoke: false,
    retrySmoke: false,
    liveCheck: false,
    active: false,
    out: null,
    ignored: [],
  };
  if (isPackaged) {
    // A release build runs the product. Nothing about a verification run may leak into it: no harness,
    // no isolated profile, no plaintext settings, no watcher switched off.
    mode.ignored = present;
    return mode;
  }
  mode.monitorSmoke = list.includes(FLAGS.monitorSmoke);
  mode.retrySmoke = list.includes(FLAGS.retrySmoke);
  mode.smoke = list.includes(FLAGS.smoke) || mode.monitorSmoke || mode.retrySmoke;
  mode.liveCheck = list.includes(FLAGS.liveCheck);
  mode.active = list.includes(FLAGS.active);
  mode.out = list.includes(FLAGS.out) ? valueAfter(list, FLAGS.out) : null;
  return mode;
}

module.exports = { resolveVerificationMode, FLAGS };
