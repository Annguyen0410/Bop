'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const install = require('../src/main/notification-bridge.js');

function page(id, permission = 'granted') {
  const reports = [];
  class Native {
    static permission = permission;
    static requestPermission() { return Promise.resolve(this.permission); }
    constructor(title, options) {
      if (Native.permission !== 'granted') throw new Error('denied');
      this.title = title; this.tag = options.tag; this.body = String(options.body || '');
      this.silent = options.silent;
    }
    addEventListener() {}
  }
  const window = { Notification: Native, crypto: { randomUUID: () => 'document-id' }, __bopNotify: (data) => reports.push(data), focus() {} };
  const context = vm.createContext({ window });
  vm.runInContext(`(${install.toString()})(${JSON.stringify(id)})`, context);
  return { window, Native, reports };
}

test('same notification tag on two accounts is distinct in the OS and routed locally', () => {
  const a = page('A'), b = page('B');
  const options = { tag: 'thread-1', body: 'Hi' };
  const first = new a.window.Notification('Chat', options);
  const second = new b.window.Notification('Chat', options);
  assert.equal(first.tag, 'bop:A:thread-1');
  assert.equal(second.tag, 'bop:B:thread-1');
  assert.equal(first.title, 'Account A · Chat');
  assert.equal(second.title, 'Account B · Chat');
  assert.equal(a.reports[0].tag, 'thread-1');
  assert.equal(b.reports[0].tag, 'thread-1');
  assert.equal(options.tag, 'thread-1', 'do not mutate the site options');
  assert.equal(options.silent, undefined, 'do not mutate the site sound preference object');
  assert.equal(first.silent, true, 'Bop owns the single OS sound request');
  assert.equal(a.reports[0].eventId, 'document-id:1');
  assert.ok(first instanceof a.Native);
  assert.ok(first instanceof a.window.Notification);
});

test('untagged notifications do not replace each other even when titles match', () => {
  const { window, reports } = page('B');
  new window.Notification('Chat');
  new window.Notification('Chat');
  assert.equal(reports.length, 2);
  assert.notEqual(reports[0].tag, reports[1].tag);
  assert.notEqual(reports[0].eventId, reports[1].eventId);
});

test('permission remains native and changes are visible without reinjection', async () => {
  const { window, Native, reports } = page('A', 'denied');
  assert.equal(window.Notification.permission, 'denied');
  assert.equal(await window.Notification.requestPermission(), 'denied');
  assert.throws(() => new window.Notification('Chat'), /denied/);
  assert.equal(reports.length, 0, 'failed notifications are not claimed as delivered');
  Native.permission = 'granted';
  assert.equal(window.Notification.permission, 'granted');
  new window.Notification('Chat');
  assert.equal(reports.length, 1);
});
