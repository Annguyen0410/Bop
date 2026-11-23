'use strict';

/**
 * The notes server as a network citizen: where it listens, how much it accepts, and that the wire the
 * Android client speaks is unchanged.
 *
 * Two changes are pinned here. The listener binds loopback plus this machine's private interfaces and
 * refuses a public bind outright, so the port is not reachable from outside the local network whatever
 * the peer check does. And connections are bounded per peer and in total, so a process that opens
 * sockets in a loop is dropped rather than served. Neither touches a frame, a nonce, the key derivation
 * or the pairing code — the last test in this file seals a request the way the Android client does and
 * opens it here, which is what keeps that promise honest.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const notes = require('../src/main/notes-sync.js');

const token = 'a'.repeat(64);
const quiet = { getNotes: () => [], onNotes: () => {} };

test('the listener binds loopback and private interfaces, never everything', async (context) => {
  const server = notes.createServer({ token, port: 0, ...quiet });
  context.after(() => server.close());
  const address = await server.start();
  assert.ok(address.hosts.includes('127.0.0.1'), 'the desktop syncs with itself over loopback');
  for (const host of address.hosts) {
    assert.ok(notes.isPrivatePeer(host), `${host} is a private address`);
    assert.notStrictEqual(host, '0.0.0.0', 'the port must not be reachable outside the local network');
  }
  assert.deepStrictEqual(address.hosts, notes.listenHosts());
});

test('a public bind is refused instead of served', () => {
  for (const hosts of [['8.8.8.8'], ['127.0.0.1', '93.184.216.34'], ['0.0.0.0']]) {
    assert.throws(() => notes.createServer({ token, port: 0, hosts, ...quiet }),
      /private addresses only/, hosts.join(','));
  }
  assert.throws(() => notes.createServer({ token, port: 0, host: '0.0.0.0', ...quiet }), /private addresses only/);
});

test('admission is bounded per peer, in total, and gives the slot back', () => {
  const admission = notes.connectionAdmission({ windowMs: 60_000, perPeer: 2, maxConcurrent: 3 });
  assert.strictEqual(admission.admit('192.168.1.5'), true);
  assert.strictEqual(admission.admit('192.168.1.5'), true);
  assert.strictEqual(admission.admit('192.168.1.5'), false, 'the third connection from one peer is refused');
  assert.strictEqual(admission.admit('192.168.1.7'), true, 'another peer is still welcome');
  assert.strictEqual(admission.admit('192.168.1.8'), false, 'and the concurrent ceiling holds');
  admission.release();
  admission.release();
  assert.strictEqual(admission.admit('192.168.1.8'), true, 'a released slot is usable again');
  assert.strictEqual(admission.open, 2, 'two released, one admitted: the count tracks what is open');
});

test('the rolling window forgets old connections', () => {
  const admission = notes.connectionAdmission({ windowMs: 30, perPeer: 1, maxConcurrent: 8 });
  assert.strictEqual(admission.admit('192.168.1.5'), true);
  assert.strictEqual(admission.admit('192.168.1.5'), false);
  return new Promise((resolve) => setTimeout(() => {
    assert.strictEqual(admission.admit('192.168.1.5'), true, 'after the window a peer is a new visitor');
    resolve();
  }, 45));
});

test('a peer that opens sockets in a loop is dropped, and a normal sync still works', async (context) => {
  let stored = [];
  const server = notes.createServer({
    token, port: 0, host: '127.0.0.1', ...quiet,
    getNotes: () => stored,
    onNotes: (value) => { stored = value; },
    limits: { windowMs: 60_000, perPeer: 2, maxConcurrent: 8 },
  });
  context.after(() => server.close());
  const address = await server.start();

  const first = await notes.syncWithDesktop('127.0.0.1', address.port, token, []);
  assert.ok(Array.isArray(first), 'the first sync is answered');

  let refused = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await notes.syncWithDesktop('127.0.0.1', address.port, token, []);
    } catch (_) {
      refused += 1;
    }
  }
  assert.ok(refused >= 1, 'connections beyond the window are not served');
});

test('the frame and the pairing code are exactly what Android speaks', () => {
  const frame = notes.seal(token, { action: 'read' });
  const parsed = JSON.parse(frame);
  assert.deepStrictEqual(Object.keys(parsed).sort(), ['data', 'nonce', 'tag'], 'one sealed frame: nonce, data, tag');
  assert.strictEqual(Buffer.from(parsed.nonce, 'base64').length, 12, 'a 12-byte nonce');

  // Sealed the way the documented Android client does it: key = sha256(token bytes), AAD "Bop LAN
  // notes v1", AES-256-GCM. If any of those change, this open() fails and the phone stops syncing.
  const sealLikeAndroid = (value) => {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm',
      crypto.createHash('sha256').update(Buffer.from(token, 'hex')).digest(), nonce);
    cipher.setAAD(Buffer.from('Bop LAN notes v1'));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return JSON.stringify({
      nonce: nonce.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    });
  };
  assert.deepStrictEqual(notes.open(token, sealLikeAndroid({ action: 'read' })), { action: 'read' });

  const code = notes.makePairingCode(token, ['192.168.1.5']);
  assert.strictEqual(code.code, `BOPNOTES1:192.168.1.5:${notes.PORT}:${token}`);
  assert.deepStrictEqual(notes.parsePairingCode(code.code), { host: '192.168.1.5', port: notes.PORT, token });
});