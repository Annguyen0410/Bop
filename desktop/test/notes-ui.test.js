'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const renderer = path.join(__dirname, '..', 'src', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'notes.html'), 'utf8');
const script = fs.readFileSync(path.join(renderer, 'notes.js'), 'utf8');

async function loadNotes(snapshot) {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(html, { url: 'file:///notes.html', runScripts: 'outside-only', virtualConsole });
  const calls = { add: [], remove: [], pair: 0, paste: 0, sync: [] };
  const handlers = {};
  dom.window.confirm = () => true;
  dom.window.alert = () => {};
  dom.window.bop = { notes: {
    snapshot: async () => snapshot,
    add: async (value) => { calls.add.push(value); return { ok: true }; },
    remove: async (id) => { calls.remove.push(id); return { ok: true }; },
    copyPairing: async () => { calls.pair += 1; return { ok: true }; },
    pasteImage: async () => { calls.paste += 1; return { ok: true, image: 'AQID', mime: 'image/jpeg' }; },
    setSync: async (enabled) => { calls.sync.push(enabled); return { status: { enabled, running: enabled } }; },
    onChanged: (handler) => { handlers.changed = handler; },
    onSettings: (handler) => { handlers.settings = handler; },
  } };
  dom.window.eval(script);
  await new Promise((resolve) => setImmediate(resolve));
  return { dom, calls, handlers, errors };
}

test('notes view shows LAN pair code and operates copy, QR and sync controls', async () => {
  const { dom, calls, errors } = await loadNotes({
    theme: 'dark', notes: [],
    notesSync: { enabled: true, running: true, pairingCode: 'BOPNOTES1:192.168.1.4:38671:abc123', addresses: ['192.168.1.4'], port: 38671 },
  });
  const text = dom.window.document.getElementById('pairing').textContent;
  assert.match(text, /BOPNOTES1:192\.168\.1\.4:38671:abc123/);
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
  dom.window.document.getElementById('copy-pairing').click();
  dom.window.document.getElementById('notes-toggle-sync').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([calls.pair, calls.paste, calls.sync], [1, 0, [false]]);
  assert.deepEqual(errors, []);
  dom.window.close();
});

test('notes view adds text and image attachments and deletes by stable id', async () => {
  const note = { id: 'desktop-note-123', text: '<script>not markup</script>', image: 'AQID', mime: 'image/jpeg', sender: 'Android', timestamp: Date.now() };
  const state = { theme: 'light', notes: [note], notesSync: { enabled: false, running: false, pairingCode: '', addresses: [], port: 38671 } };
  const { dom, calls, errors } = await loadNotes(state);
  const document = dom.window.document;
  assert.equal(document.querySelector('#notes-list script'), null, 'note text never becomes executable markup');
  assert.equal(document.querySelector('#notes-list img').getAttribute('src'), 'data:image/jpeg;base64,AQID');
  document.getElementById('note-text').value = 'new note';
  document.getElementById('note-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.add.length, 1);
  assert.equal(calls.add[0].text, 'new note');
  assert.deepEqual(Object.keys(calls.add[0]), ['text']);
  document.querySelector('[data-delete-note]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.remove, [note.id]);
  assert.deepEqual(errors, []);
  dom.window.close();
});
