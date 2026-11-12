'use strict';

// The two rules behind "open the conversation the alert is about" — see src/main/threads.js.

const test = require('node:test');
const assert = require('node:assert');
const threads = require('../src/main/threads.js');

test('a conversation is recognised on both Messenger addresses and on the Facebook messages path', () => {
  assert.equal(threads.isThreadUrl('https://www.messenger.com/t/1234567890'), true);
  assert.equal(threads.isThreadUrl('https://www.facebook.com/messages/t/1234567890'), true);
  assert.equal(threads.isThreadUrl('https://www.facebook.com/messages/e2ee/t/1234567890'), true);
});

test('an inbox, a login screen or a query string is never remembered as the place an alert opens', () => {
  assert.equal(threads.isThreadUrl('https://www.facebook.com/messages/'), false);
  assert.equal(threads.isThreadUrl('https://www.messenger.com/'), false);
  assert.equal(threads.isThreadUrl('https://www.facebook.com/login/?next=x'), false);
  assert.equal(threads.isThreadUrl('not a url'), false);
  assert.equal(threads.isThreadUrl('file:///C:/t/secret'), false);
});

test('the same conversation with fresh tracking parameters counts as the same conversation', () => {
  const clean = 'https://www.messenger.com/t/1234567890';
  assert.equal(threads.sameThread(clean, `${clean}?ref=notification`), true);
  assert.equal(threads.sameThread(`${clean}/`, clean), true);
  assert.equal(threads.sameThread(clean, 'https://www.messenger.com/t/999'), false);
});

test('addresses that do not parse fall back to an exact comparison instead of throwing', () => {
  assert.equal(threads.sameThread('about:blank', 'about:blank'), true);
  assert.equal(threads.sameThread('about:blank', 'about:blank#x'), false);
});
