'use strict';

const net = require('node:net');
const os = require('node:os');
const crypto = require('node:crypto');

const MAX_MESSAGES = 100;
const MAX_TEXT = 4000;
const MAX_IMAGE_BYTES = 500_000;
const MAX_TOTAL_BYTES = 5_000_000;
const MAX_FRAME_BYTES = 9_000_000;
const PORT = 38671;
const AAD = Buffer.from('Bop LAN notes v1');
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const B64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function privateAddress(value) {
  const ip = String(value || '').replace(/^::ffff:/i, '');
  if (ip === '::1' || /^f[cd][0-9a-f]*:/i.test(ip) || /^fe[89ab][0-9a-f]*:/i.test(ip)) return true;
  const octets = ip.split('.').map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    (octets[0] === 10 || octets[0] === 127 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
     (octets[0] === 192 && octets[1] === 168));
}

function normalizeHost(value) {
  const host = String(value || '').trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || !privateAddress(host)) return null;
  return host.split('.').map(Number).join('.');
}

function localAddresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flatMap((entries) =>
    (entries || []).filter((entry) => !entry.internal && entry.family === 'IPv4')
      .map((entry) => normalizeHost(entry.address)).filter(Boolean)))].sort();
}

function keyFor(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new TypeError('invalid notes pairing token');
  return crypto.createHash('sha256').update(Buffer.from(token, 'hex')).digest();
}

function normalizeNote(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !ID_PATTERN.test(value.id) ||
      (value.text != null && typeof value.text !== 'string') ||
      (value.image != null && typeof value.image !== 'string') ||
      (value.mime != null && typeof value.mime !== 'string')) return null;
  const text = (value.text || '').slice(0, MAX_TEXT).trim();
  const image = value.image || '';
  if (image && value.mime != null && !['image/jpeg', 'image/png'].includes(value.mime)) return null;
  const timestamp = Number(value.timestamp);
  const deletedAt = Number(value.deletedAt);
  if (image.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4 || image.length % 4 !== 0 ||
      (image && !B64_PATTERN.test(image))) return null;
  const bytes = Buffer.from(image, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== image || (!text && !image && !(Number.isFinite(deletedAt) && deletedAt > 0))) return null;
  return {
    id: value.id, text, image, mime: image && value.mime === 'image/png' ? 'image/png' : (image ? 'image/jpeg' : ''),
    sender: value.sender === 'Android' ? 'Android' : 'Desktop',
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? Math.round(timestamp) : Date.now(),
    deletedAt: Number.isFinite(deletedAt) && deletedAt > 0 ? Math.round(deletedAt) : 0,
  };
}

function mergeNotes(first, second) {
  return mergeNotesIncludingDeleted(first, second).filter((note) => note.deletedAt <= 0);
}

function mergeNotesIncludingDeleted(first, second) {
  const byId = new Map();
  for (const raw of [...(Array.isArray(first) ? first : []), ...(Array.isArray(second) ? second : [])]) {
    const note = normalizeNote(raw);
    if (!note) continue;
    const previous = byId.get(note.id);
    if (!previous || note.deletedAt > previous.deletedAt ||
        (note.deletedAt === previous.deletedAt && note.timestamp > previous.timestamp)) byId.set(note.id, note);
  }
  const sorted = [...byId.values()].sort((a, b) => Math.max(a.timestamp, a.deletedAt) - Math.max(b.timestamp, b.deletedAt) || a.id.localeCompare(b.id));
  const result = [];
  let bytes = 0;
  for (let i = sorted.length - 1; i >= 0 && result.length < MAX_MESSAGES; i -= 1) {
    const note = sorted[i];
    const size = Buffer.byteLength(note.text, 'utf8') + Buffer.from(note.image, 'base64').length;
    if (bytes + size <= MAX_TOTAL_BYTES || note.deletedAt > 0) { result.push(note); bytes += size; }
  }
  return result.reverse();
}

function seal(token, value) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(token), nonce);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return JSON.stringify({ nonce: nonce.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
}

function decodeBase64(value, expectedBytes, maxBytes = MAX_FRAME_BYTES) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 4 / 3) + 4 || value.length % 4 !== 0 || !B64_PATTERN.test(value)) {
    throw new Error('invalid encrypted frame');
  }
  const result = Buffer.from(value, 'base64');
  if (result.toString('base64') !== value || result.length > maxBytes || (expectedBytes != null && result.length !== expectedBytes)) {
    throw new Error('invalid encrypted frame');
  }
  return result;
}

function open(token, frame) {
  if (typeof frame !== 'string' || Buffer.byteLength(frame, 'utf8') > MAX_FRAME_BYTES) throw new Error('invalid encrypted frame');
  const value = JSON.parse(frame);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid encrypted frame');
  const nonce = decodeBase64(value.nonce, 12, 12);
  const data = decodeBase64(value.data, null);
  const tag = decodeBase64(value.tag, 16, 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(token), nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

function readLine(socket, maxBytes, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => { socket.destroy(); finish(new Error('connection timed out')); }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('end', onEnd);
      socket.removeListener('error', onError);
      socket.removeListener('timeout', onTimeout);
    }
    function finish(error, result) {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(error) : resolve(result);
    }
    function onData(chunk) {
      const newline = chunk.indexOf(10);
      buffer += (newline < 0 ? chunk : chunk.subarray(0, newline)).toString('utf8');
      if (Buffer.byteLength(buffer, 'utf8') > maxBytes) { socket.destroy(); finish(new Error('frame too large')); }
      else if (newline >= 0) finish(null, buffer);
    }
    const onEnd = () => finish(new Error('connection ended before a complete frame'));
    const onError = (error) => finish(error);
    const onTimeout = () => { socket.destroy(); finish(new Error('connection timed out')); };
    socket.on('data', onData);
    socket.once('end', onEnd);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
  });
}

async function syncWithDesktop(host, port, token, notes) {
  const address = normalizeHost(host);
  if (!address || !Number.isInteger(port) || port < 1 || port > 65535 || typeof token !== 'string' || !TOKEN_PATTERN.test(token) ||
      !Array.isArray(notes) || notes.length > MAX_MESSAGES) throw new TypeError('invalid notes pairing details');
  const socket = net.connect({ host: address, port });
  socket.setTimeout(5000);
  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => { socket.removeListener('connect', onConnect); reject(error); };
      const onConnect = () => { socket.removeListener('error', onError); resolve(); };
      socket.once('error', onError);
      socket.once('connect', onConnect);
    });
    socket.write(`${seal(token, { action: 'merge', notes: mergeNotesIncludingDeleted([], notes) })}\n`);
    const response = open(token, await readLine(socket, MAX_FRAME_BYTES));
    if (response.error) throw new Error(response.error);
    if (!Array.isArray(response.notes)) throw new Error('invalid notes response');
    return mergeNotesIncludingDeleted(notes, response.notes);
  } finally { socket.destroy(); }
}

function makePairingCode(token, addresses = localAddresses()) {
  keyFor(token);
  const hosts = addresses.map(normalizeHost).filter(Boolean);
  return { code: hosts.length ? `BOPNOTES1:${hosts[0]}:${PORT}:${token}` : '', addresses: hosts, port: PORT };
}

function parsePairingCode(code) {
  const match = typeof code === 'string' && /^BOPNOTES1:((?:\d{1,3}\.){3}\d{1,3}):\d{1,5}:([a-f0-9]{64})$/i.exec(code.trim());
  if (!match) return null;
  const host = normalizeHost(match[1]);
  return host ? { host, port: PORT, token: match[2] } : null;
}

function createServer({ token, getNotes, onNotes, port = PORT, host = '0.0.0.0' }) {
  keyFor(token);
  if (typeof getNotes !== 'function' || typeof onNotes !== 'function' || !Number.isInteger(port) || port < 0 || port > 65535 || typeof host !== 'string') {
    throw new TypeError('invalid notes server configuration');
  }
  const server = net.createServer((socket) => {
    if (!privateAddress(socket.remoteAddress)) { socket.destroy(); return; }
    socket.setTimeout(10_000, () => socket.destroy());
    let frame = '';
    socket.on('data', (chunk) => {
      const newline = chunk.indexOf(10);
      frame += (newline < 0 ? chunk : chunk.subarray(0, newline)).toString('utf8');
      if (Buffer.byteLength(frame, 'utf8') > MAX_FRAME_BYTES) { socket.destroy(); return; }
      if (newline < 0) return;
      if (socket.notesHandled) { socket.destroy(); return; }
      socket.notesHandled = true;
      socket.removeAllListeners('data');
      try {
        const request = open(token, frame);
        if (!request || !['merge', 'read'].includes(request.action) ||
            (request.action === 'merge' && (!Array.isArray(request.notes) || request.notes.length > MAX_MESSAGES))) throw new Error('invalid request');
        const current = getNotes();
        if (!Array.isArray(current)) throw new Error('invalid stored notes');
        const incomingNotes = request.action === 'merge' ? request.notes : [];
        const all = mergeNotesIncludingDeleted(current, incomingNotes);
        if (request.action === 'merge') onNotes(all);
        // Include tombstones so paired clients can remove their stale copy instead of reintroducing it.
        // Both peers need the full merged collection, including tombstones, to converge after deletions.
        const response = seal(token, { notes: all });
        if (Buffer.byteLength(response, 'utf8') > MAX_FRAME_BYTES) { socket.destroy(); return; }
        socket.end(`${response}\n`);
      } catch (_) {
        socket.end(`${seal(token, { error: 'invalid pairing or request' })}\n`);
      }
    });
  });
  return {
    start() {
      return new Promise((resolve, reject) => {
        const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
        const onListening = () => { server.removeListener('error', onError); resolve(server.address()); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
      });
    },
    addresses: localAddresses,
  };
}

module.exports = {
  MAX_MESSAGES, MAX_TEXT, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES, MAX_FRAME_BYTES, PORT,
  normalizeNote, mergeNotes, mergeNotesIncludingDeleted, isPrivatePeer: privateAddress, normalizeHost, localAddresses,
  keyFor, seal, open, syncWithDesktop, makePairingCode, parsePairingCode, createServer,
};
