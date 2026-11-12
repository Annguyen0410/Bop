'use strict';

/**
 * The conversation a space was last looking at.
 *
 * Bop cannot ask a chat site which thread a new message belongs to: Messenger's notification says nothing
 * about it, and reading message contents is out of scope. What Bop *can* do is remember the conversation the
 * user last had open in each space and go back there, which turns "click the alert, land on the inbox, hunt
 * for the chat" into one step. This module is the pair of rules that makes that safe:
 *
 * - [isThreadUrl] decides whether an address is a conversation rather than an inbox or a login page, so a
 *   redirect through a sign-in screen never becomes the place a notification opens.
 * - [sameThread] compares two addresses by path, because the chat sites rewrite tracking parameters onto a
 *   thread they have already opened; comparing the whole address made clicking an alert inside that very
 *   conversation reload it for nothing.
 *
 * Pure on purpose: both rules are unit-tested instead of described.
 */

/** Conversation shapes seen in the wild: messenger.com/t/<id>, facebook.com/messages/t/<id>, fb /messages/e2ee/t/<id>. */
const THREAD_PATH = /\/(?:messages\/)?(?:e2ee\/)?t\/[^/?#]+/;

/**
 * The path of an address, or null when it does not parse. A trailing slash is dropped, because the chat sites
 * use it and don't: `/t/<id>/` and `/t/<id>` are one conversation, and treating them as two reloaded the page
 * the user was already reading.
 */
function pathOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
  } catch {
    return null;
  }
}

/** True when this address is a conversation, so it is worth remembering as one. */
function isThreadUrl(url) {
  const path = pathOf(url);
  return path != null && THREAD_PATH.test(path);
}

/** True when two addresses point at the same conversation, whatever tracking parameters they carry. */
function sameThread(left, right) {
  const a = pathOf(left);
  const b = pathOf(right);
  if (a == null || b == null) return left === right;
  return a === b;
}

module.exports = { THREAD_PATH, isThreadUrl, sameThread };
