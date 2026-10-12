'use strict';

/*
 * A minimal Chrome DevTools Protocol client, shared by the dev tools. Bop's windows are separate
 * Chromium targets, so the only way to look inside a running instance — including at the bubble's own
 * window, which has no other API — is this port.
 *
 * Dev-only: the test suite and the shipped app never use it.
 */

/** Open a CDP session against a target's websocket URL. Returns a `send(method, params)` helper. */
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

/** Every page target in a running instance. */
async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

/**
 * Evaluate an expression in the target whose URL contains [suffix] and return the value. Everything
 * crosses as JSON, so the expression has to produce a serialisable result.
 */
async function evaluate(port, suffix, expression) {
  const list = await targets(port);
  const target = list.find((entry) => entry.type === 'page' && entry.url.includes(suffix));
  if (!target) {
    const seen = list.map((entry) => `${entry.type} ${entry.url}`).join('\n');
    throw new Error(`no devtools target for ${suffix}\nhave:\n${seen}`);
  }
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(`EXCEPTION ${(details.exception && details.exception.description) || details.text}`);
    }
    return result.result.value;
  } finally {
    client.close();
  }
}

module.exports = { connect, targets, evaluate };
