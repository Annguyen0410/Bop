'use strict';

const test = require('node:test');
const assert = require('node:assert');
const log = require('../src/main/notify-log.js');

const web = (spaceId, title, body, tag = 'list') => ({ spaceId, kind: 'web', title, body, tag });

test('the first notification of a space is always shown', () => {
  const first = log.arrive(log.empty(), web('C', 'New study', 'Prolific · 2 places left'));
  assert.strictEqual(first.notify, true);
  assert.strictEqual(first.log.size, 1);
});

test('the same words again are not a second notification', () => {
  // Reported: "once it has notified me, if it is still exactly the same it must not notify again — only
  // notify when there is something new." A page that re-raises the same alert, or a watched line that
  // re-reads to the same text, is the case this exists for.
  let state = log.empty();
  for (let round = 0; round < 5; round += 1) {
    const decision = log.arrive(state, web('C', 'New study', 'Prolific · 2 places left'));
    assert.strictEqual(decision.notify, round === 0, `round ${round}`);
    state = decision.log;
  }
});

test('anything the user would read differently notifies again', () => {
  const base = log.arrive(log.empty(), web('C', 'New study', 'Prolific · 2 places left'));
  assert.strictEqual(log.arrive(base.log, web('C', 'New study', 'Prolific · 5 places left')).notify, true);
  assert.strictEqual(log.arrive(base.log, web('C', 'New study', 'Prolific · 2 places left')).notify, false);
  assert.strictEqual(log.arrive(base.log, web('C', 'Study removed', 'Prolific · 2 places left')).notify, true);
  assert.strictEqual(log.arrive(base.log, { spaceId: 'C', kind: 'watch', title: 'New study', body: 'Prolific · 2 places left' }).notify, true);
  // A different space is a different notification even with identical words.
  assert.strictEqual(log.arrive(base.log, web('D', 'New study', 'Prolific · 2 places left')).notify, true);
  // The tag is not part of the wording: the same sentence in a new tag is still the same sentence.
  assert.strictEqual(log.arrive(base.log, web('C', 'New study', 'Prolific · 2 places left', 'other-tag')).notify, false);
});

test('the same words after a different one are new again', () => {
  let state = log.arrive(log.empty(), web('C', 'One', 'first')).log;
  state = log.arrive(state, web('C', 'Two', 'second')).log;
  const back = log.arrive(state, web('C', 'One', 'first'));
  assert.strictEqual(back.notify, true, 'a second event with the same words is a second event');
});

test('one space repeating cannot silence another, and stopping a space re-arms it', () => {
  let state = log.empty();
  state = log.arrive(state, web('A', 'Same', 'body')).log;
  state = log.arrive(state, web('B', 'Same', 'body')).log;
  assert.strictEqual(log.arrive(state, web('A', 'Same', 'body')).notify, false);
  assert.strictEqual(log.arrive(state, web('B', 'Same', 'body')).notify, false);
  const rearmed = log.forget(state, 'A');
  assert.strictEqual(log.arrive(rearmed, web('A', 'Same', 'body')).notify, true);
  assert.strictEqual(log.arrive(rearmed, web('B', 'Same', 'body')).notify, false);
  assert.strictEqual(rearmed.size, 1);
});

test('a malformed alert never claims to be new', () => {
  const decision = log.arrive(log.empty(), null);
  assert.strictEqual(decision.notify, false);
  assert.strictEqual(decision.log.size, 0);
  // A missing log is not an error either: a fresh one is used instead.
  assert.strictEqual(log.arrive(undefined, web('C', 'One', 'body')).notify, true);
});
