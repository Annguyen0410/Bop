'use strict';

/**
 * The loopback exception for plain http, including IPv6.
 *
 * `spaces.pageAllowed` documents that a plain-http page is allowed on a loopback address — "an address
 * that cannot leave the machine" — and main.js's navigation holds say the same. But WHATWG URL keeps the
 * brackets of an IPv6 literal (`new URL('http://[::1]:8080/').hostname === '[::1]'`) while the checks
 * compare against `'::1'`, so the documented allowance never fired for `http://[::1]:port`. The host is
 * normalised in hostnameOf, which is the one place every check reads it from.
 */

const test = require('node:test');
const assert = require('node:assert');

const spaces = require('../src/main/spaces.js');

const customSpace = (url) => {
  let state = spaces.defaultState();
  state = spaces.enableSlot(state, 'C', { appId: 'custom', kind: 'tasks', url });
  return spaces.accountFor(state, 'C');
};

test('hostnameOf hands out the host without the URL brackets', () => {
  assert.strictEqual(spaces.hostnameOf('http://[::1]:8080/panel'), '::1');
  assert.strictEqual(spaces.hostnameOf('https://[2001:db8::1]/x'), '2001:db8::1');
  assert.strictEqual(spaces.hostnameOf('http://127.0.0.1:8080/'), '127.0.0.1');
  assert.strictEqual(spaces.hostnameOf('https://Example.COM/x'), 'example.com');
});

test('a loopback panel is allowed over plain http on every loopback spelling', () => {
  for (const url of ['http://[::1]:8080/', 'http://127.0.0.1:8080/', 'http://localhost:8080/']) {
    const space = customSpace(url);
    assert.strictEqual(spaces.pageAllowed(space, url), true, url);
    assert.strictEqual(spaces.openTarget(space).error, null, url);
  }
});

test('the loopback allowance is local: 127.0.0.1 and [::1] are not each other', () => {
  const v6 = customSpace('http://[::1]:8080/');
  assert.strictEqual(spaces.pageAllowed(v6, 'http://127.0.0.1:8080/'), false, 'the IPv6 panel does not swallow 127.0.0.1');
  const v4 = customSpace('http://127.0.0.1:8080/');
  assert.strictEqual(spaces.pageAllowed(v4, 'http://[::1]:8080/'), false, 'and the IPv4 panel does not swallow [::1]');
});

test('public http is still refused and https is unaffected', () => {
  const space = customSpace('https://example.com/');
  assert.strictEqual(spaces.pageAllowed(space, 'http://example.com/'), false);
  assert.strictEqual(spaces.pageAllowed(space, 'http://10.0.0.4:8080/'), false);
  assert.strictEqual(spaces.pageAllowed(space, 'https://example.com/x'), true);
  assert.strictEqual(spaces.pageAllowed(space, 'https://[2001:db8::1]/x'), false, 'a public IPv6 host is not this space');
});
