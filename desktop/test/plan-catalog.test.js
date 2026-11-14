'use strict';

/**
 * Desktop plan — the catalog and its host allow-lists, per entry.
 *
 * Every catalog entry is a promise: one https entry point, hosts that are bare lowercase names, and a
 * main frame that may only stay on those hosts. Each promise is its own case here, and then every host of
 * every entry gets the three navigation cases that matter — its own page, a subdomain of it, and a
 * look-alike that only shares the suffix.
 */

const test = require('node:test');
const assert = require('node:assert');

const spaces = require('../src/main/spaces.js');

// `custom` is the "any other site" entry on purpose: no home, no hosts, an address the user types. It is
// covered by its own cases below instead of the per-entry ones.
const APPS = spaces.APPS.filter((app) => app.id !== 'custom');

test('catalog: the group list covers every kind an entry uses', () => {
  const kinds = [...new Set(spaces.APPS.map((app) => app.kind))];
  assert.deepStrictEqual(kinds.sort(), [...spaces.KINDS].sort());
});

test('catalog: the custom entry is deliberately empty and says so', () => {
  const custom = spaces.appById('custom');
  assert.ok(custom);
  assert.strictEqual(custom.home, '');
  assert.deepStrictEqual(custom.hosts, []);
  assert.ok(custom.login.length > 20);
  assert.strictEqual(spaces.openTarget({ id: 'C', appId: 'custom', url: '', extraHosts: [] }).error !== null, true);
});

for (const app of APPS) {
  test(`catalog/${app.id}: one https entry point that its own space may open`, () => {
    assert.ok(app.home.startsWith('https://'), `${app.id} home is https`);
    assert.strictEqual(app.kind, app.kind.toLowerCase());
    assert.ok(spaces.KINDS.includes(app.kind), `${app.id} kind ${app.kind}`);
    const space = { id: 'C', appId: app.id, extraHosts: [] };
    assert.strictEqual(spaces.pageAllowed(space, app.home), true);
  });

  test(`catalog/${app.id}: hosts are bare lowercase names`, () => {
    assert.ok(app.hosts.length > 0, `${app.id} has hosts`);
    for (const host of app.hosts) {
      assert.strictEqual(host, host.toLowerCase(), `${app.id} ${host}`);
      assert.strictEqual(host.startsWith('.'), false, `${app.id} ${host}`);
      assert.strictEqual(host.includes('/'), false, `${app.id} ${host}`);
      assert.strictEqual(host.includes(':'), false, `${app.id} ${host}`);
    }
    assert.strictEqual(new Set(app.hosts).size, app.hosts.length, `${app.id} has no duplicate hosts`);
  });

  test(`catalog/${app.id}: a foreign site is never opened inside it`, () => {
    const space = { id: 'C', appId: app.id, extraHosts: [] };
    assert.strictEqual(spaces.pageAllowed(space, 'https://example.com/'), false);
    assert.strictEqual(spaces.pageAllowed(space, 'https://example.com/app'), false);
    assert.strictEqual(spaces.pageAllowed(space, 'http://' + app.hosts[0] + '/'), false, 'plain http is refused');
  });

  test(`catalog/${app.id}: the label, note and id are presentable`, () => {
    assert.ok(app.label.trim().length > 0);
    assert.ok(app.login.trim().length > 10, `${app.id} explains its sign-in`);
    assert.strictEqual(app.id, app.id.toLowerCase());
    assert.strictEqual(app.id.includes(' '), false);
    assert.ok(/^[a-z0-9]+$/.test(app.id), `${app.id} id shape`);
  });

  test(`catalog/${app.id}: an unknown stored id cannot masquerade as it`, () => {
    assert.strictEqual(spaces.appById(app.id).id, app.id);
    assert.strictEqual(spaces.appById(`${app.id} `), null);
    assert.strictEqual(spaces.appById(app.id.toUpperCase() === app.id ? `${app.id}!` : app.id.toUpperCase()), null);
  });

  test(`catalog/${app.id}: the accent is a 24-bit colour`, () => {
    const accent = spaces.hexColor(app.id);
    assert.ok(/^#[0-9a-f]{6}$/.test(accent), `${app.id} accent ${accent}`);
    assert.strictEqual(spaces.hexColor(app.id), spaces.hexColor(app.id), 'stable');
  });
}

// ---------------------------------------------------------------------------------------------
// Host allow-list: three navigation cases per (entry, host)
// ---------------------------------------------------------------------------------------------
for (const app of APPS) {
  for (const host of app.hosts) {
    test(`hosts/${app.id}/${host}: own page and subdomains only`, () => {
      const space = { id: 'C', appId: app.id, extraHosts: [] };
      assert.strictEqual(spaces.pageAllowed(space, `https://${host}/`), true);
      assert.strictEqual(spaces.pageAllowed(space, `https://sub.${host}/deep/path?x=1#top`), true);
      assert.strictEqual(spaces.pageAllowed(space, `https://${host}.evil.com/`), false);
      assert.strictEqual(spaces.pageAllowed(space, `https://${host}.evil.com/login`), false);
    });
  }
}

test('hosts: a granted host is one host, and it is revocable', () => {
  const state = spaces.enableSlot(spaces.defaultState(), 'C');
  const granted = spaces.grantHost(state, 'C', 'SignIn.Example.COM');
  assert.deepStrictEqual(spaces.hostsFor(spaces.accountFor(granted, 'C')).includes('signin.example.com'), true);
  const revoked = spaces.revokeHost(granted, 'C', 'signin.example.com');
  assert.strictEqual(spaces.hostsFor(spaces.accountFor(revoked, 'C')).includes('signin.example.com'), false);
  // A grant never becomes a wildcard or a path.
  for (const bad of ['*.example.com', 'example.com/evil', 'http://example.com', 'example.com:8443', '']) {
    assert.strictEqual(spaces.normalizeHost(bad), null, bad);
  }
});

test('hosts: a custom space allows exactly the host it was given', () => {
  let state = spaces.enableSlot(spaces.defaultState(), 'C');
  state = spaces.selectApp(state, 'C', 'custom');
  state = spaces.setUrl(state, 'C', 'https://panel.example.org/jobs');
  const space = spaces.accountFor(state, 'C');
  assert.strictEqual(spaces.pageAllowed(space, 'https://panel.example.org/jobs'), true);
  assert.strictEqual(spaces.pageAllowed(space, 'https://panel.example.org/'), true);
  assert.strictEqual(spaces.pageAllowed(space, 'https://other.example.org/'), false);
  assert.strictEqual(spaces.pageAllowed(space, 'https://panel.example.org.evil.com/'), false);
  assert.strictEqual(spaces.homeFor(space), 'https://panel.example.org/jobs');
});
