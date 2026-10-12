'use strict';

/*
 * Dev-only helper: type into the focused control of a running Bop DevTools target. Meant to be used
 * after tools/click-ui.js has put a real OS click on the field, so the focus itself is real.
 *
 *   node tools/type-ui.js <port> <urlSuffix> "<text>"
 */

const [, , portArg, suffix, text] = process.argv;
const port = Number(portArg || 9222);

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    });
    socket.addEventListener('error', () => reject(new Error('devtools socket error')));
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = ++nextId;
        return new Promise((done, fail) => {
          pending.set(id, { resolve: done, reject: fail });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { socket.close(); },
    }));
  });
}

(async () => {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = list.find((entry) => entry.type === 'page' && entry.url.includes(suffix));
  if (!target) throw new Error(`no target for ${suffix}`);
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    await client.send('Runtime.evaluate', { expression: 'document.activeElement && document.activeElement.id', returnByValue: true })
      .then((result) => process.stdout.write(`focused: ${JSON.stringify(result.result.value)}\n`));
    await client.send('Input.insertText', { text: String(text) });
    const value = await client.send('Runtime.evaluate', {
      expression: 'document.activeElement ? String(document.activeElement.value) : null',
      returnByValue: true,
    });
    process.stdout.write(`value: ${JSON.stringify(value.result.value)}\n`);
  } finally {
    client.close();
  }
})().catch((failure) => { process.stdout.write(`ERR ${failure.message}\n`); process.exitCode = 1; });
