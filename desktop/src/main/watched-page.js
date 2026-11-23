'use strict';

/**
 * What one read of a watched page takes from it: the page title and a slice of its text.
 *
 * This rule is written out here because it is easy to assume something narrower than it is. What the
 * change detector and the `require` / `ignore` phrases actually see is:
 *
 * - **with a CSS selector that matches**, the text is the joined inner text of its matches;
 * - **with no selector, or one that matches nothing**, the text is the whole page body. A selector that
 *   has stopped matching therefore silently widens the read back to the entire page;
 * - **at most 20 000 characters** of that text, in both cases. A change further down the page is
 *   invisible: it does not count as a change, and a `require` / `ignore` phrase past the cut never
 *   matches;
 * - the `require` and `ignore` phrases compare case-insensitively against **the title and this text
 *   together**, so a word in the page title can satisfy or silence a watch on its own.
 *
 * That is the behaviour on purpose, kept as it is rather than narrowed: a watch that has gone quiet
 * because of an `ignore` phrase must not start ringing again under an upgrade without the owner asking
 * for it. What the words mean is spelled out where the user types them (the Edit dialog and the Guide)
 * so nobody has to discover it from a card that never arrives.
 */

/** The maximum characters of page text one reading carries. Both the read and the normaliser use it. */
const MAX_TEXT = 20000;

/**
 * The text half of one reading, exactly as the page script builds it.
 *
 * Deliberately self-contained: [readScript] ships this function's own source into the page, so it may
 * close over nothing. `innerText` first (what a user sees, whitespace collapsed), `textContent` when a
 * node does not answer with innerText — the same order for selector matches and for the body.
 */
function collectWatchedText(document, selector) {
  const MAX_TEXT = 20000;
  let text = '';
  try {
    if (selector) text = Array.from(document.querySelectorAll(selector)).map((node) => node.innerText || node.textContent || '').join(' ').slice(0, MAX_TEXT);
    if (!text) text = (document.body && document.body.innerText ? document.body.innerText : '').slice(0, MAX_TEXT);
  } catch (_) {
    text = '';
  }
  return text;
}

/** The script Bop runs in the page for one reading; returns `{ title, text }`. */
function readScript(selector) {
  return `(() => {
    const text = (${collectWatchedText.toString()})(document, ${JSON.stringify(String(selector || ''))});
    return { title: document.title || '', text };
  })();`;
}

module.exports = { MAX_TEXT, collectWatchedText, readScript };
