import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const LOCAL_PROTOCOLS = /^(?:#|mailto:|tel:|data:|https?:|\/\/)/i;

/** Strip a URL down to the file path a static build would have to contain. */
function localPath(reference) {
  const clean = reference.split('#')[0].split('?')[0].trim();
  return clean || null;
}

function attr(tag, name) {
  const found = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return found ? found[1] : null;
}

/**
 * Validate a built index.html against the document this project promises: one h1, real alt text,
 * sized images, no placeholders, no external subresources, and every local reference present.
 *
 * `files` is the set of paths in the build output, relative to its root and slash-separated.
 */
export function validateHtml(html, { files = new Set(), siteUrl = null } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  if (!/^\s*<!doctype html>/i.test(html)) fail('Missing <!doctype html>.');
  if (!/<html[^>]+lang="[a-z-]+"/i.test(html)) fail('<html> needs a lang attribute.');

  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
  if (title.length < 10) fail('The <title> is shorter than 10 characters.');
  if (title.length > 70) warn(`The <title> is ${title.length} characters; search results truncate past ~60.`);

  const description = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1]?.trim() ?? '';
  if (description.length < 50) fail('The meta description is shorter than 50 characters.');
  if (description.length > 200) warn('The meta description is longer than 200 characters.');

  if (!/<meta\s+name="viewport"/i.test(html)) fail('Missing the viewport meta tag.');

  for (const property of ['og:title', 'og:description', 'og:image']) {
    if (!html.includes(`property="${property}"`)) fail(`Missing ${property} metadata.`);
  }
  if (!html.includes('name="twitter:card"')) fail('Missing the Twitter card metadata.');

  const h1s = html.match(/<h1\b/gi) ?? [];
  if (h1s.length !== 1) fail(`Expected exactly one <h1>, found ${h1s.length}.`);

  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  if (levels[0] !== 1) fail('The first heading is not an <h1>.');
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index] - levels[index - 1] > 1) {
      fail(`Heading order jumps from h${levels[index - 1]} to h${levels[index]}.`);
      break;
    }
  }

  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  if (images.length === 0) fail('The page contains no images; the product visual is missing.');
  let highPriority = 0;
  for (const image of images) {
    const src = attr(image, 'src') ?? '(no src)';
    if (attr(image, 'alt') === null) fail(`<img src="${src}"> has no alt attribute.`);
    const width = Number(attr(image, 'width'));
    const height = Number(attr(image, 'height'));
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      fail(`<img src="${src}"> needs numeric width and height to reserve space (CLS).`);
    }
    if (attr(image, 'fetchpriority') === 'high') {
      highPriority += 1;
      if (attr(image, 'loading') === 'lazy') fail('The LCP image is both fetchpriority="high" and loading="lazy".');
    }
  }
  if (highPriority !== 1) fail(`Expected exactly one fetchpriority="high" image, found ${highPriority}.`);

  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const src = attr(`<script ${match[1]}>`, 'src');
    if (!src) continue;
    if (/^https?:/i.test(src)) fail(`Third-party script: ${src}`);
  }

  for (const match of html.matchAll(/<(?:img|script|iframe|source)\b[^>]*?\ssrc="(https?:\/\/[^"]+)"/gi)) {
    fail(`External subresource: ${match[1]}`);
  }

  if (/\son[a-z]+\s*=/i.test(html)) fail('Inline event handler attributes are not allowed.');

  if (html.includes('__SITE_URL__')) fail('An unresolved __SITE_URL__ placeholder is left in the build.');

  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i)?.[1] ?? null;
  if (siteUrl) {
    if (canonical !== `${siteUrl}/`) fail(`The canonical URL should be ${siteUrl}/, found ${canonical ?? 'nothing'}.`);
    const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1];
    if (!ogImage || !ogImage.startsWith('https://')) fail('og:image must be an absolute URL in a deployed build.');
  } else if (canonical) {
    fail('A canonical URL is present even though no SITE_URL was supplied.');
  }

  for (const match of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      fail(`Invalid JSON-LD: ${error.message}`);
    }
  }

  for (const match of html.matchAll(/<dialog\b[^>]*>/gi)) {
    if (!/aria-(?:labelledby|label)=/i.test(match[0])) fail('A <dialog> is missing an accessible name.');
  }

  const references = [];
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/gi)) references.push(match[1]);
  for (const match of html.matchAll(/\bsrcset="([^"]+)"/gi)) {
    for (const candidate of match[1].split(',')) references.push(candidate.trim().split(/\s+/)[0]);
  }

  const seen = new Set();
  for (const reference of references) {
    if (!reference || LOCAL_PROTOCOLS.test(reference)) continue;
    if (reference.startsWith('{{')) continue;
    const clean = localPath(reference);
    if (!clean) continue;
    const target = clean.startsWith('/') ? clean.slice(1) : clean;
    if (seen.has(target)) continue;
    seen.add(target);
    if (!files.has(target)) fail(`Broken local reference: ${reference}`);
  }

  return { errors, warnings, stats: { images: images.length, title, description } };
}

/** Every file in a directory tree, as slash-separated paths relative to `root`. */
export async function listFiles(root, base = root) {
  const output = new Set();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const nested of await listFiles(absolute, base)) output.add(nested);
    } else {
      output.add(path.relative(base, absolute).split(path.sep).join('/'));
    }
  }
  return output;
}

export async function readIndex(distDir) {
  return readFile(path.join(distDir, 'index.html'), 'utf8');
}

export async function sizeOf(file) {
  return (await stat(file)).size;
}
