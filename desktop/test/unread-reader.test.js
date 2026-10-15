'use strict';

/*
 * Tests for the in-page unread reader that ships as an Android asset
 * (app/src/main/assets/unread-reader.js). It lives under desktop/test because desktop is the only place
 * this repository runs `node --test`; the file under test is pure JavaScript with no platform API, so
 * the same tests exercise exactly the code the WebView injects.
 *
 * jsdom is a dev dependency for this file alone: the reader's whole job is DOM queries, and a fake DOM
 * written by hand would only prove the fake. The fixture page under test/fixtures is real HTML parsed by
 * a real DOM.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const reader = require('../../app/src/main/assets/unread-reader');
const fixturePath = path.join(__dirname, 'fixtures', 'unread-fixture.html');
const hubAppsPath = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'java', 'com', 'example', 'twoaccmess', 'HubApps.kt');

/** The descriptor the fixture page implements. Real sites get their own, with real evidence. */
const fixtureSite = {
  mode: 'dom',
  evidence: 'desktop/test/fixtures/unread-fixture.html',
  row: '.thread',
  unread: '.badge',
  muted: '.muted-mark',
  count: 'text',
};

function page(html) {
  return new JSDOM(html).window.document;
}

const fixtureDocument = () => page(fs.readFileSync(fixturePath, 'utf8'));

test('the fixture page reports unread and muted unread as separate numbers', () => {
  const reading = reader.readDescriptor(fixtureDocument(), fixtureSite);
  assert.deepStrictEqual(reading, { unread: 5, muted: 2 });
  // What the user actually gets alerted about: 5 total, 2 of them in a muted thread.
  assert.strictEqual(reading.unread - reading.muted, 3);
});

test('a muted arrival changes neither number for an unmuted one', () => {
  const document = fixtureDocument();
  // The muted thread gains a message: total moves, unmuted does not. This is the whole point.
  document.querySelector('#thread-promo .badge').textContent = '3';
  const reading = reader.readDescriptor(document, fixtureSite);
  assert.strictEqual(reading.unread, 6);
  assert.strictEqual(reading.muted, 3);
  assert.strictEqual(reading.unread - reading.muted, 3);
});

test('a muted thread with no unread adds nothing to either number', () => {
  const document = page(`<div class="thread is-muted"><span class="muted-mark">muted</span></div>`);
  assert.deepStrictEqual(reader.readDescriptor(document, fixtureSite), { unread: 0, muted: 0 });
});

test('a descriptor without evidence refuses instead of guessing', () => {
  const guessed = { mode: 'dom', evidence: null, row: '.thread', unread: '.badge', muted: '.muted-mark' };
  assert.strictEqual(reader.readDescriptor(fixtureDocument(), guessed), null,
    'a guessed selector matches nothing and would look like "0 unread", which is worse than silence');
  // A title-mode service is not a DOM reading either, so it refuses here and keeps the native path.
  assert.strictEqual(reader.read(fixtureDocument(), 'instagram'), null);
});

test('a page that has not rendered refuses unless an empty state proves the inbox is empty', () => {
  assert.strictEqual(reader.readDescriptor(page('<div class="thread-list"></div>'), { ...fixtureSite, empty: '.empty' }), null);
  assert.deepStrictEqual(reader.readDescriptor(page('<div class="thread-list"><p class="empty">No messages</p></div>'),
    { ...fixtureSite, empty: '.empty' }), { unread: 0, muted: 0 });
  // Without a declared empty state, "no rows" is indistinguishable from "not rendered yet".
  assert.strictEqual(reader.readDescriptor(page('<div class="thread-list"><p class="empty">No messages</p></div>'), fixtureSite), null);
});

test('a badge that draws a dot counts once, exactly like the native title path', () => {
  const document = page('<div class="thread"><span class="badge"></span></div>');
  assert.deepStrictEqual(reader.readDescriptor(document, fixtureSite), { unread: 1, muted: 0 });
});

test('a badge carrying its number in an attribute is read from there', () => {
  const document = page('<div class="thread"><span class="badge" data-count="7"></span></div>');
  assert.deepStrictEqual(
    reader.readDescriptor(document, { ...fixtureSite, count: 'attr:data-count' }), { unread: 7, muted: 0 });
});

test('an absurd badge is capped at the same ceiling as the title path', () => {
  const document = page('<div class="thread"><span class="badge">1200</span></div>');
  assert.strictEqual(reader.readDescriptor(document, fixtureSite).unread, reader.MAX);
  assert.strictEqual(reader.MAX, 99, 'must stay equal to WebUnread.MAX');
});

test('a badge whose promised number is missing refuses instead of inventing one', () => {
  // The fixture's badges carry their text, not a data-count attribute, so an attr: descriptor no longer
  // describes this page. Reporting "1 unread" here (the dot fallback) would be inventing a message.
  const attributeMode = { ...fixtureSite, count: 'attr:data-count' };
  assert.strictEqual(reader.readDescriptor(fixtureDocument(), attributeMode), null);
  const blank = page('<div class="thread"><span class="badge" data-count=""></span></div>');
  assert.strictEqual(reader.readDescriptor(blank, attributeMode), null);
  const present = page('<div class="thread"><span class="badge" data-count="4"></span></div>');
  assert.deepStrictEqual(reader.readDescriptor(present, attributeMode), { unread: 4, muted: 0 });
});

const hubUnreadPath = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'java', 'com', 'example', 'twoaccmess', 'WebUnread.kt');

test('the cap agrees with WebUnread.MAX, which is the same ceiling the title path uses', () => {
  const source = fs.readFileSync(hubUnreadPath, 'utf8');
  const declared = Number((source.match(/const val MAX = (\d+)/) || [])[1]);
  assert.strictEqual(reader.MAX, declared, 'a different cap in JS than in Kotlin is a silent disagreement');
});

test('an unparseable selector is a refusal, not a crash and not a zero', () => {
  assert.strictEqual(reader.readDescriptor(fixtureDocument(), { ...fixtureSite, row: '<<<' }), null);
  assert.strictEqual(reader.readDescriptor(fixtureDocument(), { ...fixtureSite, empty: '<<<' , row: '.nothing' }), null);
});

test('the payload format is exactly the one Kotlin decodes', () => {
  // SpaceScan.decode in Kotlin is tested against this same literal, in the same key=value shape the
  // rest of the app writes. Changing one side without the other fails a test on that side.
  assert.strictEqual(reader.encode({ unread: 7, muted: 2 }), 'unread=7\nmuted=2');
  assert.strictEqual(reader.encode(null), '');
  // Half a reading is a refusal, not a line with 'undefined' in it for someone to parse later.
  assert.strictEqual(reader.encode({ unread: 7 }), '');
  assert.strictEqual(reader.encode({ unread: 7, muted: undefined }), '');
  assert.strictEqual(reader.encode({ unread: '7', muted: 2 }), '');
});

test('every catalog app has a descriptor, and no site claims DOM readiness without evidence', () => {
  const source = fs.readFileSync(hubAppsPath, 'utf8');
  const catalog = [...source.matchAll(/HubApp\(\s*"([a-z0-9]+)"/g)].map((match) => match[1]);
  assert.ok(catalog.length >= 19, `expected the full catalog, parsed ${catalog.length} ids`);
  assert.deepStrictEqual(Object.keys(reader.SITES).sort(), catalog.sort(),
    'a new catalog app must get a descriptor, and a removed app must lose its own');
  Object.entries(reader.SITES).forEach(([id, site]) => {
    if (site.mode === 'dom') assert.ok(site.evidence, `${id} claims DOM read without evidence`);
    else assert.strictEqual(site.mode, 'title', `${id} has an unknown mode`);
  });
});
