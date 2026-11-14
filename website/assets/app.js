/* Bop's site: appearance, the badge simulation, and the screenshot dialog.
   No framework, no third-party requests, and nothing here is required for the page to read. */

import { label, tone } from './badge-model.js';

const doc = document;

/* ---------- appearance: system, light or dark ---------- */
function setupAppearance() {
  const meta = doc.querySelector('meta[name="color-scheme"]');
  const radios = [...doc.querySelectorAll('input[name="appearance"]')];
  if (!meta || radios.length === 0) return;

  let stored = null;
  try {
    stored = localStorage.getItem('bop-appearance');
  } catch (error) {
    stored = null;
  }

  const sync = () => {
    const wanted = stored === 'light' || stored === 'dark' ? stored : 'system';
    radios.forEach((radio) => {
      radio.checked = radio.value === wanted;
    });
    meta.content = wanted === 'system' ? 'light dark' : wanted;
  };

  radios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      if (radio.value === 'system') {
        stored = null;
        try { localStorage.removeItem('bop-appearance'); } catch (error) { /* ignore */ }
      } else {
        stored = radio.value;
        try { localStorage.setItem('bop-appearance', stored); } catch (error) { /* ignore */ }
      }
      sync();
    });
  });

  // Another tab may have changed the choice.
  window.addEventListener('storage', (event) => {
    if (event.key !== 'bop-appearance') return;
    stored = event.newValue;
    sync();
  });

  sync();
}

/* ---------- the badge model ----------
   `badge-model.js` holds the rules; this only keeps the DOM in step with them. */

function setupBadgeLab() {
  const lab = doc.querySelector('[data-badge-lab]');
  if (!lab) return;

  const bubble = lab.querySelector('[data-bubble]');
  const badge = lab.querySelector('[data-badge]');
  const readout = lab.querySelector('[data-readout]');
  const reset = lab.querySelector('[data-reset]');
  const spaces = new Map(
    ['A', 'B', 'C', 'D'].map((id) => [id, { waiting: 0, vip: false }]),
  );

  const total = () => [...spaces.values()].reduce((sum, space) => sum + space.waiting, 0);
  const vipWaiting = () =>
    [...spaces.values()].reduce((sum, space) => sum + (space.vip ? space.waiting : 0), 0);

  function render(announce = true) {
    const all = total();
    const vip = vipWaiting();
    const text = label(all);
    const isVip = tone(all, vip) === 'vip';

    badge.hidden = text === null;
    if (text !== null) badge.textContent = text;
    badge.classList.toggle('is-vip', isVip && text !== null);
    bubble.dataset.tone = isVip ? 'vip' : 'normal';

    for (const [id, space] of spaces) {
      const count = lab.querySelector(`[data-count="${id}"]`);
      if (!count) continue;
      count.firstChild.textContent = String(space.waiting);
      const read = lab.querySelector(`[data-read="${id}"]`);
      if (read) read.disabled = space.waiting === 0;
    }

    if (!announce) return;
    if (text === null) {
      readout.textContent = 'No chats waiting. The badge is hidden.';
    } else {
      const plural = all === 1 ? 'chat' : 'chats';
      const vipLine = isVip
        ? `${vip} of them in a VIP space, so the badge is red.`
        : 'None in a VIP space, so the badge is blue.';
      readout.textContent = `${text} ${plural} waiting. ${vipLine}`;
    }
  }

  lab.addEventListener('click', (event) => {
    const arrive = event.target.closest('[data-arrive]');
    if (arrive) {
      const space = spaces.get(arrive.dataset.arrive);
      if (space) {
        space.waiting = Math.min(space.waiting + 1, 100);
        render();
      }
      return;
    }

    const read = event.target.closest('[data-read]');
    if (read) {
      const space = spaces.get(read.dataset.read);
      if (space && space.waiting > 0) {
        space.waiting -= 1;
        render();
      }
      return;
    }

    if (event.target.closest('[data-reset]')) {
      for (const space of spaces.values()) {
        space.waiting = 0;
        space.vip = false;
      }
      lab.querySelectorAll('[data-vip]').forEach((input) => { input.checked = false; });
      render();
    }
  });

  lab.addEventListener('change', (event) => {
    const input = event.target.closest('[data-vip]');
    if (!input) return;
    const space = spaces.get(input.dataset.vip);
    if (!space) return;
    space.vip = input.checked;
    render();
  });

  render(false);
  readout.textContent = 'No chats waiting. The badge is hidden.';
}

/* ---------- screenshot dialog ---------- */
function setupGallery() {
  const dialog = doc.querySelector('#shot-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  const image = dialog.querySelector('[data-dialog-img]');
  const title = dialog.querySelector('#shot-title');
  const caption = dialog.querySelector('[data-dialog-caption]');
  if (!image || !title || !caption) return;

  const write = (button) => {
    image.src = button.dataset.src;
    image.width = Number(button.dataset.width);
    image.height = Number(button.dataset.height);
    image.alt = button.querySelector('img')?.alt ?? '';
    title.textContent = button.dataset.title ?? '';
    caption.textContent = button.dataset.caption ?? '';
  };

  doc.querySelectorAll('[data-shot]').forEach((button) => {
    button.addEventListener('click', () => {
      write(button);
      dialog.showModal();
    });
  });

  // `closedby="any"` does the light dismiss where supported. Where it is missing, do the
  // pointer-position check the dialog guide recommends (press and release both outside).
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    let pressedOutside = false;
    const outside = (event) => {
      const box = dialog.getBoundingClientRect();
      return event.clientX < box.left || event.clientX > box.right ||
             event.clientY < box.top || event.clientY > box.bottom;
    };
    dialog.addEventListener('pointerdown', (event) => { pressedOutside = outside(event); });
    dialog.addEventListener('pointerup', (event) => {
      if (pressedOutside && outside(event)) dialog.close();
    });
  }
}

setupAppearance();
setupBadgeLab();
setupGallery();
