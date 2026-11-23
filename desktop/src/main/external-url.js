'use strict';

/**
 * Every way a URL can leave Bop for the operating system.
 *
 * The rule this module exists to enforce: a remote page must never reach an OS protocol handler. Before
 * it existed, the window-open path called `shell.openExternal(url)` on anything that was not https, so a
 * page could hand `file:`, `smb:`, `javascript:`, `data:` or any custom scheme to Windows. The IPC
 * handler validated https; that one call site did not. Now there is one rule, one hand-off and one
 * place that can call `shell.openExternal`, and it is handed the shell so the rule can be tested.
 *
 * The rule: `https:` anywhere, `http:` only on a loopback host — the same exception `spaces.pageAllowed`
 * keeps, because that is the only plain-http address that cannot leave the machine. Everything else is
 * refused. Refusing is always safe; opening is not.
 */

const spaces = require('./spaces.js');

/**
 * The only hosts a plain-http page is ever allowed on: an address that cannot leave the machine.
 *
 * The IPv6 loopback arrives in two legal spellings: the URL form `new URL` keeps (`[::1]`) and the plain
 * form host lists use (`::1`). Both are this machine, so both are accepted here.
 */
function isLoopbackHost(hostname) {
  const host = String(hostname || '').replace(/^\[/, '').replace(/\]$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * What Bop may hand to the operating system, or the reason it may not.
 *
 * Parsing follows the WHATWG URL rules, which already fold the scheme and host to lower case: a pasted
 * `HTTPS://…` is an https page. Anything that does not parse is refused rather than guessed at.
 */
function validateExternalUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return { ok: false, url, reason: 'not-a-string' };
  const trimmed = url.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    return { ok: false, url: trimmed, reason: 'unparseable' };
  }
  const protocol = parsed.protocol.toLowerCase();
  const hostname = spaces.hostnameOf(trimmed);
  if (protocol === 'https:') return { ok: true, url: trimmed, protocol, hostname };
  if (protocol === 'http:' && isLoopbackHost(hostname)) return { ok: true, url: trimmed, protocol, hostname };
  return { ok: false, url: trimmed, protocol, hostname, reason: protocol === 'http:' ? 'http-outside-loopback' : `scheme:${protocol}` };
}

/** True only for a page this app may consider hosting inside a space, or opening as https. */
function isHttpsUrl(url) {
  const checked = validateExternalUrl(url);
  return checked.ok && checked.protocol === 'https:';
}

/**
 * What the window-open handler does with a URL a page asked to open.
 *
 * - `child`: the page is already allowed here, so the sign-in window opens inside this space;
 * - `prompt`: an https page this space has not been granted — the user is asked, and the window is
 *   replayed if they allow it;
 * - `external`: not something Bop will ever host. It goes to [openExternal], which re-checks it and
 *   refuses every scheme that is not https or loopback http.
 */
function windowOpenAction(url, { allowed }) {
  if (allowed) return 'child';
  if (isHttpsUrl(url)) return 'prompt';
  return 'external';
}

/**
 * The one hand-off to the operating system. `shell` is passed in so this can be tested without Electron.
 *
 * A refused URL is never given to the shell — not opened, not rewritten, not retried — and the caller is
 * told which rule refused it so the refusal can be logged. `log` is optional and must never be able to
 * break the refusal.
 */
async function openExternal(shell, url, log = null) {
  const checked = validateExternalUrl(url);
  if (!checked.ok) {
    if (log) { try { log(checked.reason, checked.url); } catch (_) { /* logging is never a reason to open */ } }
    return { ok: false, reason: checked.reason };
  }
  try {
    await shell.openExternal(checked.url);
    return { ok: true, url: checked.url };
  } catch (error) {
    return { ok: false, reason: String(error && error.message || error).slice(0, 160) };
  }
}

module.exports = { validateExternalUrl, isHttpsUrl, isLoopbackHost, windowOpenAction, openExternal };
