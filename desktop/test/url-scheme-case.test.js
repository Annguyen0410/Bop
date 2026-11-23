'use strict';

/**
 * A pasted URL is decided by what it parses to, not by how it is spelled.
 *
 * `spaces.pageAllowed` used `url.startsWith('https://')`, which is case-sensitive, so a perfectly good
 * `HTTPS://mail.example.com/` typed or pasted by a user was refused with "Only an https page on … can
 * open in this space" — fail-closed, but wrong and confusing. The WHATWG parser folds scheme and host to
 * lower case, so the decision now comes from the parsed URL, and anything that does not parse is still
 * refused.
 */

const test = require('node:test');
const assert = require('node:assert');

const spaces = require('../src/main/spaces.js');

const customSpace = (url) => {
  let state = spaces.defaultState();
  state = spaces.enableSlot(state, 'C', { appId: 'custom', kind: 'tasks', url });
  return spaces.accountFor(state, 'C');
};

test('an uppercase scheme and host are the same page as the lower-case one', () => {
  const space = customSpace('https://example.com/panel');
  for (const url of [
    'https://example.com/panel',
    'HTTPS://example.com/panel',
    'HtTpS://example.com/panel',
    'https://EXAMPLE.com/panel',
    'HTTPS://EXAMPLE.COM/panel',
    'https://example.com:443/x',
  ]) {
    assert.strictEqual(spaces.pageAllowed(space, url), true, url);
    assert.strictEqual(spaces.openTarget(customSpace(url)).error, null, `as a space address: ${url}`);
  }
});

test('the uppercase loopback exception works too', () => {
  const space = customSpace('HTTP://LOCALHOST:8080/');
  assert.strictEqual(spaces.pageAllowed(space, 'HTTP://LOCALHOST:8080/panel'), true);
  assert.strictEqual(spaces.pageAllowed(space, 'http://[::1]:8080/'), false, 'still only its own host');
});

test('the scheme still decides what plain http may do', () => {
  const space = customSpace('https://example.com/');
  assert.strictEqual(spaces.pageAllowed(space, 'HTTP://example.com/x'), false, 'uppercase does not smuggle http in');
  assert.strictEqual(spaces.pageAllowed(space, 'ftp://example.com/x'), false);
  assert.strictEqual(spaces.pageAllowed(space, 'file:///C:/x'), false);
});

test('a URL that does not parse is refused rather than guessed at', () => {
  const space = customSpace('https://example.com/');
  for (const url of ['', '   ', 'example.com/x', 'https://', 'https://exa mple.com/', '//example.com/x', null, undefined, 42]) {
    assert.strictEqual(spaces.pageAllowed(space, url), false, String(url));
    assert.strictEqual(spaces.hostnameOf(url), null, String(url));
  }
});

test('an uppercase space address opens just like a typed one', () => {
  const space = customSpace('HTTPS://Example.COM/Panel');
  const target = spaces.openTarget(space);
  assert.strictEqual(target.error, null);
  assert.strictEqual(spaces.pageAllowed(space, target.url), true);
});
