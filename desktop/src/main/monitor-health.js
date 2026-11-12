'use strict';

/**
 * When a space's monitoring has actually stopped working, and what the user should be told.
 *
 * Why this is its own tested module: the two ways a space goes quiet without saying so — the page lands on
 * a sign-in screen, or the bounded retry gave up — used to leave only a status string on the dashboard
 * card. A user who never opens the dashboard therefore believed every account was still watched, which is
 * the worst failure this product can have. The decisions are plain data so they can be asserted without
 * Electron, a page, or a clock.
 *
 * The rule is deliberately narrow:
 * - Only the two states that mean "this space cannot announce anything any more" raise a card.
 * - A transient load failure does not: retries cover it, and it is already on the Alerts list.
 * - Entering the same state again is not a second card. Recovery is silent, and removes the card, because
 *   the user does not need to be interrupted to be told that something started working again.
 */

/** The tag every health card carries, so one space has exactly one. */
const HEALTH_TAG = 'health';

/**
 * States in which this space cannot deliver a message alert at all. These are exactly the strings
 * [AccountMonitor] sets, so a rename there cannot silently stop the card from ever being raised.
 */
const UNHEALTHY = ['reauthentication-required', 'monitoring-stopped'];

/** True when [status] means the space is not announcing anything. */
function isUnhealthy(status) {
  return UNHEALTHY.includes(status);
}

/**
 * The card for a broken state. `label` is the user's own name for the space, and nothing here quotes page
 * content: the card explains the state, never what was on the page.
 */
function describe(status, label) {
  const name = String(label == null ? '' : label).trim() || 'This account';
  if (status === 'reauthentication-required') {
    return {
      code: 'reauthentication-required',
      title: `${name} needs you to sign in again`,
      body: 'The page went to a sign-in screen, so this account cannot announce new messages. Open the space and sign in; monitoring resumes on its own.',
    };
  }
  if (status === 'monitoring-stopped') {
    return {
      code: 'monitoring-stopped',
      title: `${name} stopped being monitored`,
      body: 'The page failed repeatedly and Bop stopped retrying, so nothing from this account can reach you. Open the space to start again; the saved session is kept.',
    };
  }
  return null;
}

/**
 * What this status change means for the user, or null when it means nothing to them.
 *
 * `clear` is returned once, on the transition back to a working state, and only if something was raised
 * before — so a space that never broke does not broadcast an empty recovery.
 */
function transition(previous, next) {
  if (isUnhealthy(next)) {
    if (previous === next) return null;
    return { action: 'raise', code: next };
  }
  // Only a page that actually loaded and is being watched undoes a card. A reload starting, or a retry
  // that has not finished, is not a fix — clearing on it would tell the user the problem was gone before
  // anything proved it.
  if (isUnhealthy(previous) && next === 'observing-auth-unknown') return { action: 'clear' };
  return null;
}

module.exports = { HEALTH_TAG, UNHEALTHY, isUnhealthy, describe, transition };
