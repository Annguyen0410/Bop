import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { buildSite } from '../scripts/build.mjs';
import { validateHtml } from '../scripts/site-check.mjs';
import { CAP, badge, label, tone } from '../assets/badge-model.js';

async function buildInto(options) {
  const out = await mkdtemp(path.join(os.tmpdir(), 'bop-site-'));
  const result = await buildSite({ outDir: out, ...options });
  return { out, result };
}

test('the badge model matches VipBadge.kt', () => {
  assert.equal(CAP, 99);
  const cases = [
    [-5, null], [0, null], [1, '1'], [2, '2'], [9, '9'], [10, '10'], [42, '42'],
    [98, '98'], [99, '99'], [100, '99+'], [101, '99+'], [9999, '99+'],
  ];
  for (const [total, expected] of cases) {
    assert.equal(label(total), expected, `label(${total})`);
  }
  assert.equal(label(Number.NaN), null);
});

test('one VIP waiting chat turns the badge red, and nothing else does', () => {
  assert.equal(tone(0, 0), 'normal');
  assert.equal(tone(1, 0), 'normal');
  assert.equal(tone(1, 1), 'vip');
  assert.equal(tone(5, 1), 'vip');
  assert.equal(tone(1, -1), 'normal', 'an impossible count cannot make it red');
  assert.equal(tone(0, 3), 'normal', 'VIP chats that are not waiting do not count');
  assert.deepEqual(badge(100, 1), { text: '99+', tone: 'vip' });
  assert.deepEqual(badge(0, 0), { text: null, tone: 'normal' });
});

test('a build without a domain is complete and honest', async () => {
  const { out, result } = await buildInto({ siteUrl: undefined });
  try {
    assert.deepEqual(result.errors, []);
    assert.equal(result.siteUrl, null);
    assert.equal(result.sitemap, false);

    const html = await readFile(path.join(out, 'index.html'), 'utf8');
    assert.ok(!html.includes('__SITE_URL__'), 'no placeholder survives');
    assert.ok(!html.includes('rel="canonical"'), 'no invented canonical URL');
    assert.ok(html.includes('content="/assets/img/og.png"'), 'og:image is still declared');

    for (const file of result.files) {
      assert.ok((await stat(path.join(out, file))).size > 0, `${file} is not empty`);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('a deployed build carries a canonical URL, absolute social image and sitemap', async () => {
  const siteUrl = 'https://bop.example';
  const { out, result } = await buildInto({ siteUrl });
  try {
    assert.deepEqual(result.errors, []);
    assert.equal(result.sitemap, true);
    const html = await readFile(path.join(out, 'index.html'), 'utf8');
    assert.ok(html.includes('<link rel="canonical" href="https://bop.example/">'));
    assert.ok(html.includes('content="https://bop.example/assets/img/og.png"'));
    assert.ok(!html.includes('__SITE_URL__'));

    const map = await readFile(path.join(out, 'sitemap.xml'), 'utf8');
    assert.match(map, /<loc>https:\/\/bop\.example\/<\/loc>/);
    const robots = await readFile(path.join(out, 'robots.txt'), 'utf8');
    assert.match(robots, /Sitemap: https:\/\/bop\.example\/sitemap\.xml/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('the page passes the structural checks the build enforces', async () => {
  const { out, result } = await buildInto({ siteUrl: undefined });
  try {
    const html = await readFile(path.join(out, 'index.html'), 'utf8');
    const files = new Set(result.files);
    assert.deepEqual(validateHtml(html, { files }).errors, []);

    assert.match(html, /<html lang="en">/);
    assert.equal((html.match(/<h1\b/gi) ?? []).length, 1);
    assert.ok(html.includes('data-badge-lab'), 'the interactive model is present');
    assert.ok(html.includes('not a live connection'), 'the simulation is labelled');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('the validator rejects broken references and missing alt text', () => {
  const html = `<!doctype html><html lang="en"><head>
    <title>A page for testing the validator</title>
    <meta name="description" content="${'A description long enough to pass the minimum length check. '.repeat(2)}">
    <meta name="viewport" content="width=device-width">
    <meta property="og:title" content="x"><meta property="og:description" content="x">
    <meta property="og:image" content="/missing.png"><meta name="twitter:card" content="summary">
    </head><body><h1>Title</h1><h3>Skipped a level</h3>
    <img src="/missing.png" width="10" height="10">
    <a href="/nope/">broken</a></body></html>`;
  const { errors } = validateHtml(html, { files: new Set(['index.html']) });
  assert.ok(errors.some((error) => error.includes('no alt attribute')), errors.join('\n'));
  assert.ok(errors.some((error) => error.includes('Broken local reference')), errors.join('\n'));
  assert.ok(errors.some((error) => error.includes('Heading order')), errors.join('\n'));
  assert.ok(errors.some((error) => error.includes('fetchpriority')), errors.join('\n'));
});

test('the shipped payload stays inside its budget', async () => {
  const { out } = await buildInto({ siteUrl: undefined });
  try {
    const gzip = async (file) => gzipSync(await readFile(path.join(out, file))).byteLength;
    const html = await readFile(path.join(out, 'index.html'));
    const css = await gzip('assets/styles.css');
    const js = (await gzip('assets/app.js')) + (await gzip('assets/badge-model.js'));
    const images = ['desktop-dashboard.webp', 'desktop-dashboard-900.webp', 'android-spaces.webp',
      'android-spaces-light.webp', 'android-bubble.webp', 'android-checks.webp',
      'desktop-settings.webp', 'desktop-space.webp', 'reminder.webp', 'og.png'];

    let imageBytes = 0;
    for (const image of images) imageBytes += (await stat(path.join(out, 'assets/img', image))).size;

    assert.ok(html.byteLength < 60 * 1024, `html ${html.byteLength} bytes`);
    assert.ok(css < 20 * 1024, `css gzip ${css} bytes`);
    assert.ok(js < 9 * 1024, `js gzip ${js} bytes`);
    assert.ok(imageBytes < 900 * 1024, `images ${(imageBytes / 1024).toFixed(0)} KB`);
    assert.ok((await stat(path.join(out, 'assets/fonts/bricolage-grotesque-latin.woff2'))).size < 110 * 1024);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
