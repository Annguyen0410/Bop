'use strict';

const byId = (id) => document.getElementById(id);
const esc = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let snapshot;
let attached = null;
let savedNotes = [];
let notesSync;
let saving = false;

function paint() {
  if (!snapshot) return;
  document.documentElement.dataset.theme = snapshot.theme === 'dark' ? 'dark' : 'light';
  const status = notesSync || snapshot.notesSync;
  const pairing = byId('pairing');
  if (!status.enabled) pairing.innerHTML = '<b>Android sync is off.</b> Start LAN sync in Desktop Settings, then pair using the displayed token and address.';
  else pairing.innerHTML = `<b>LAN sync ${status.running ? 'running' : 'stopped'}.</b> Same private Wi‑Fi only. Android pairing code:<br/><code>${esc(status.pairingCode || 'No private Wi‑Fi address found. Connect to Wi‑Fi and refresh.')}</code><br/>Type this code in Android Notes → Pair, or use the clipboard buttons below. No Internet relay. Keep the code private; it allows access to this note collection.`;
  byId('pairing-actions').hidden = !status.enabled;
  byId('notes-toggle-sync').textContent = status.enabled ? 'Stop LAN sync' : 'Start LAN sync';
  byId('notes-empty').hidden = savedNotes.length > 0;
  byId('notes-list').innerHTML = savedNotes.filter(note => !note.deletedAt).map(note => `
    <article class="note-item ${note.sender === 'Desktop' ? 'mine' : ''}">
      ${note.text ? `<div>${esc(note.text).replace(/\n/g, '<br/>')}</div>` : ''}
      ${note.image ? `<img src="data:${esc(note.mime || 'image/jpeg')};base64,${esc(note.image)}" alt="Attached image" />` : ''}
      <div class="note-meta">${esc(note.sender)} · ${esc(new Date(note.timestamp).toLocaleString())}</div>
      <div class="note-toolbar"><button class="ghost" data-delete-note="${esc(note.id)}" type="button">Delete</button></div>
    </article>`).join('');
  byId('notes-list').querySelectorAll('[data-delete-note]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Delete this note from the paired devices?')) return;
    const result = await window.bop.notes.remove(button.dataset.deleteNote);
    if (!result.ok) alert(result.error || 'Could not delete note.');
    await refresh();
  }));
  byId('notes-list').scrollTop = byId('notes-list').scrollHeight;
}

async function refresh() {
  snapshot = await window.bop.notes.snapshot();
  savedNotes = snapshot.notes || [];
  notesSync = snapshot.notesSync;
  paint();
}

byId('attach-image').addEventListener('click', () => byId('note-image').click());
document.addEventListener('paste', async (event) => {
  const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith('image/'));
  if (!item) return;
  const file = item.getAsFile();
  if (!file || file.size > 5_000_000) { alert('Clipboard image is too large.'); return; }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
  });
  attached = { mime: file.type === 'image/png' ? 'image/png' : 'image/jpeg', image: dataUrl.split(',')[1] || '' };
  byId('attach-image').textContent = '✓ Clipboard image';
});
byId('note-image').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/') || file.size > 500_000) {
    alert('Choose an image smaller than 500 KB.');
    event.target.value = '';
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  attached = { mime: file.type === 'image/png' ? 'image/png' : 'image/jpeg', image: dataUrl.split(',')[1] || '' };
  byId('attach-image').textContent = `✓ ${file.name.slice(0, 18)}`;
});

byId('note-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  const text = byId('note-text').value.trim();
  if (!text && !attached) return;
  saving = true;
  try {
    const result = await window.bop.notes.add({ text, ...(attached || {}) });
    if (!result.ok) { alert(result.error || 'Could not save note.'); return; }
    byId('note-text').value = '';
    byId('note-image').value = '';
    byId('attach-image').textContent = '＋ Image';
    attached = null;
    await refresh();
  } finally { saving = false; }
});
document.addEventListener('keydown', async (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v') return;
  const result = await window.bop.notes.pasteImage();
  if (result.ok) {
    attached = { image: result.image, mime: result.mime };
    byId('attach-image').textContent = '✓ Clipboard image';
  }
});
byId('notes-toggle-sync').addEventListener('click', async () => {
  const result = await window.bop.notes.setSync(!((notesSync || snapshot.notesSync).enabled));
  if (!result.ok) alert(result.error || 'Could not change LAN sync.');
  if (result.status) notesSync = result.status;
  await refresh();
});
byId('copy-pairing').addEventListener('click', async () => {
  const result = await window.bop.notes.copyPairing();
  if (!result.ok) { alert(result.error || 'Could not copy pairing code.'); return; }
  alert('Pairing code copied. Open Notes on Android and use Pair / sync.');
});
byId('notes-refresh').addEventListener('click', refresh);
window.bop.notes.onChanged(refresh);
window.bop.notes.onSettings((value) => { notesSync = value; paint(); });
refresh();
