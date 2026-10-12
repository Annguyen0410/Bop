'use strict';

const test = require('node:test');
const assert = require('node:assert');
const autostart = require('../src/main/autostart.js');

test('an installed build registers its own executable, with the flag that marks a sign-in launch', () => {
  const item = autostart.loginItem({ execPath: 'C:/Program Files/Bop/Bop.exe', portableExe: null, packaged: true });
  assert.deepStrictEqual(item, { path: 'C:/Program Files/Bop/Bop.exe', args: [autostart.FLAG] });
});

test('a portable build registers the file the user launched, never its own unpacked copy', () => {
  const portable = autostart.loginItem({
    execPath: 'C:/Users/me/AppData/Local/Temp/3KRYuL/resources/app.asar/../Bop.exe',
    portableExe: 'C:/Users/me/OneDrive/Desktop/Bop-0.1.4-portable.exe',
    packaged: true,
  });
  assert.deepStrictEqual(portable, { path: 'C:/Users/me/OneDrive/Desktop/Bop-0.1.4-portable.exe', args: [autostart.FLAG] });
  // An empty or missing variable must fall back to the running executable rather than register nothing.
  assert.strictEqual(autostart.loginItem({ execPath: 'C:/app/Bop.exe', portableExe: '  ', packaged: true }).path, 'C:/app/Bop.exe');
});

test('a development run never registers the Electron binary', () => {
  assert.strictEqual(autostart.loginItem({ execPath: 'C:/dev/node_modules/electron/dist/electron.exe', portableExe: null, packaged: false }), null);
  assert.strictEqual(autostart.loginItem({ packaged: true }), null, 'nothing to register without a path');
  assert.strictEqual(autostart.loginItem(), null);
});

test('only the launch the operating system started carries the flag', () => {
  assert.strictEqual(autostart.launchedAtLogin(['Bop.exe', autostart.FLAG]), true);
  assert.strictEqual(autostart.launchedAtLogin(['Bop.exe']), false);
  assert.strictEqual(autostart.launchedAtLogin([`x${autostart.FLAG}`]), false, 'a look-alike argument is not the flag');
  assert.strictEqual(autostart.launchedAtLogin(null), false);
});
