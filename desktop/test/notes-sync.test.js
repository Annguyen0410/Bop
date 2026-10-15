'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const notes = require('../src/main/notes-sync.js');

const token = '1234567890abcdef'.repeat(4);

function exchange(port, payload, suppliedToken = token) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let buffer = '';
    socket.setTimeout(3000, () => socket.destroy(new Error('sync timed out')));
    socket.on('connect', () => socket.write(`${notes.seal(suppliedToken, payload)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try { resolve(notes.open(suppliedToken, buffer.slice(0, newline))); }
      catch (failure) { reject(failure); }
      socket.destroy();
    });
    socket.on('error', reject);
  });
}

test('normalizes only bounded text/image notes and preserves allowed metadata', () => {
  assert.equal(notes.normalizeNote(null), null);
  assert.equal(notes.normalizeNote({ id: 'x', text: 'no' }), null);
  assert.equal(notes.normalizeNote({ id: 'abcdefgh', text: '  hello  ', sender: 'Android', timestamp: 12 }).text, 'hello');
  const image = notes.normalizeNote({ id: 'image-123', image: Buffer.from('image bytes').toString('base64'), mime: 'image/png', timestamp: 12 });
  assert.equal(image.sender, 'Desktop');
  assert.equal(image.mime, 'image/png');
  assert.equal(notes.normalizeNote({ id: 'image-460', image: Buffer.from('image bytes').toString('base64'), mime: 'image/svg+xml', timestamp: 12 }), null);
  assert.equal(notes.normalizeNote({ id: 'image-456', image: 'AQI' }), null, 'noncanonical base64 is rejected');
  assert.equal(notes.normalizeNote({ id: 'image-459', image: 'A==='.repeat(10) }), null, 'incorrect base64 padding is rejected');
  assert.equal(notes.normalizeHost('192.168.1.5'), '192.168.1.5');
  assert.equal(notes.normalizeHost('8.8.8.8'), null, 'pairing cannot target a public Internet host');
  assert.equal(notes.normalizeHost('256.1.2.3'), null, 'invalid IPv4 octets are rejected');
  assert.equal(notes.normalizeNote({ id: 'image-457', image: `${Buffer.from('x').toString('base64')}!` }), null);
  assert.equal(notes.normalizeNote({ id: 'image-458', image: Buffer.alloc(notes.MAX_IMAGE_BYTES + 1).toString('base64') }), null);
  const valid = notes.normalizeNote({ id: 'text-1234', text: 'x'.repeat(8000), timestamp: -2 });
  assert.equal(valid.text.length, notes.MAX_TEXT);
  assert.ok(valid.timestamp > 0);
});

test('merge is deterministic, idempotent, and bounded by count and total bytes', () => {
  const first = notes.normalizeNote({ id: 'note-0001', text: 'one', timestamp: 1 });
  const second = notes.normalizeNote({ id: 'note-0002', text: 'two', timestamp: 2 });
  assert.deepEqual(notes.mergeNotes([first], [first, second]), [first, second]);
  const tooMany = Array.from({ length: notes.MAX_MESSAGES + 10 }, (_, index) => ({ id: `item_${String(index).padStart(6, '0')}`, text: String(index), timestamp: index + 1 }));
  assert.equal(notes.mergeNotes([], tooMany).length, notes.MAX_MESSAGES);
  assert.equal(notes.mergeNotes([], [{ id: 'huge-001', image: Buffer.alloc(notes.MAX_IMAGE_BYTES).toString('base64'), timestamp: 1 }]).length, 1);
  const nearMaxImage = Buffer.alloc(notes.MAX_IMAGE_BYTES, 0x61).toString('base64');
  assert.equal(notes.normalizeNote({ id: 'huge-002', image: nearMaxImage }).image, nearMaxImage);
});

test('pairing code round-trips an RFC1918 IPv4 address and rejects malformed hosts', () => {
  const code = notes.makePairingCode(token, ['192.168.1.9']).code;
  assert.equal(code, `BOPNOTES1:192.168.1.9:${notes.PORT}:${token}`);
  assert.deepEqual(notes.parsePairingCode(code), { host: '192.168.1.9', port: notes.PORT, token });
  assert.equal(notes.parsePairingCode(code.replaceAll('.', 'x')), null);
  assert.equal(notes.parsePairingCode(code.replace('192.168.1.9', '8.8.8.8')), null);
});

test('private address and token ciphertext rules reject non-private peers and corrupted frames', () => {
  for (const ip of ['10.1.2.3', '172.16.0.2', '172.31.255.1', '192.168.1.5', '127.0.0.1', '::1', 'fc00::1', 'fe80::1']) assert.equal(notes.isPrivatePeer(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '192.167.0.1', '', null]) assert.equal(notes.isPrivatePeer(ip), false, String(ip));
  assert.throws(() => notes.keyFor('short'), /invalid notes pairing token/);
  const frame = notes.seal(token, { action: 'read' });
  assert.deepEqual(notes.open(token, frame), { action: 'read' });
  assert.throws(() => notes.open('f'.repeat(64), frame));
  assert.throws(() => notes.open(token, `${frame}broken`));
});

test('Android-compatible client can merge notes over bounded private IPv4 transport', async (context) => {
  let stored = [notes.normalizeNote({ id: 'desktop-01', text: 'from desktop', sender: 'Desktop', timestamp: 1 })];
  const server = notes.createServer({ token, port: 0, host: '127.0.0.1', getNotes: () => stored, onNotes: (value) => { stored = value; } });
  context.after(() => server.close());
  const address = await server.start();
  const result = await notes.syncWithDesktop('127.0.0.1', address.port, token,
    [notes.normalizeNote({ id: 'android-01', text: 'from Android', sender: 'Android', timestamp: 2 })]);
  assert.deepEqual(result.map((note) => note.id), ['desktop-01', 'android-01']);
  assert.equal(stored.length, 2);
  const deleted = notes.normalizeNote({ ...result[0], text: '', deletedAt: Date.now() });
  const afterDelete = await notes.syncWithDesktop('127.0.0.1', address.port, token, [deleted]);
  assert.deepEqual(afterDelete.filter((note) => note.deletedAt <= 0).map((note) => note.id), ['android-01']);
  assert.equal(stored.some((note) => note.id === 'desktop-01' && note.deletedAt > 0), true);
  await assert.rejects(notes.syncWithDesktop('8.8.8.8', address.port, token, []), /invalid notes pairing/);
});

test('private LAN server requires encrypted valid requests and merges notes', async (context) => {
  let stored = [notes.normalizeNote({ id: 'desktop-01', text: 'from desktop', sender: 'Desktop', timestamp: 1 })];
  const server = notes.createServer({ token, port: 0, host: '127.0.0.1', getNotes: () => stored, onNotes: (value) => { stored = value; } });
  context.after(() => server.close());
  const address = await server.start();
  const remote = await exchange(address.port, { action: 'merge', notes: [{ id: 'android-01', text: 'from Android', sender: 'Android', timestamp: 2 }] });
  assert.deepEqual(remote.notes.map((note) => note.id), ['desktop-01', 'android-01']);
  assert.equal(stored.length, 2);
  const deleted = notes.normalizeNote({ ...stored[0], text: '', deletedAt: Date.now() });
  const afterDelete = await exchange(address.port, { action: 'merge', notes: [deleted] });
  assert.equal(afterDelete.notes.some((note) => note.id === 'desktop-01' && note.deletedAt > 0), true,
    'the server returns the tombstone so the Android peer can remove its stale copy');
  assert.equal(stored.some((note) => note.id === 'desktop-01' && note.deletedAt > 0), true);
  const read = await exchange(address.port, { action: 'read' });
  assert.equal(read.notes.filter((note) => note.deletedAt <= 0).length, 1);
  assert.equal(read.notes.some((note) => note.id === 'desktop-01' && note.deletedAt > 0), true);
  const invalidShape = await exchange(address.port, { action: 'merge', notes: 'not an array' });
  assert.equal(invalidShape.error, 'invalid pairing or request');
});

test('oversized encrypted frames are rejected before attempting to buffer the whole request', async (context) => {
  const server = notes.createServer({ token, port: 0, host: '127.0.0.1', getNotes: () => [], onNotes: () => {} });
  context.after(() => server.close());
  const address = await server.start();
  await new Promise((resolve, reject) => {
    const socket = net.connect(address.port, '127.0.0.1');
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('oversize socket not closed')); });
    socket.on('connect', () => socket.write('x'.repeat(notes.MAX_FRAME_BYTES + 1)));
    socket.on('close', resolve);
    socket.on('error', (failure) => failure.code === 'ECONNRESET' ? resolve() : reject(failure));
  });
});
