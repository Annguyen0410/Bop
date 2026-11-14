import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, validateHtml } from './site-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const PAGE_FILES = ['index.html', 'robots.txt'];
const ASSET_DIRS = ['assets'];

function normaliseSiteUrl(value) {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) {
    throw new Error(`SITE_URL must be an absolute http(s) URL, received: ${value}`);
  }
  return trimmed;
}

function applySiteUrl(html, siteUrl) {
  if (siteUrl) {
    return html
      .replaceAll('__SITE_URL__', siteUrl)
      .replaceAll('content="/assets/img/og.png"', `content="${siteUrl}/assets/img/og.png"`);
  }
  // No domain has been chosen: drop the canonical link rather than invent one. og:image stays
  // root-relative, which resolves on the page but is not enough for a social crawler until
  // SITE_URL is supplied at build time.
  return html
    .replace(/^[ \t]*<!-- The build removes this line[\s\S]*?-->\r?\n/m, '')
    .replace(/^[ \t]*<link rel="canonical"[^>]*>\r?\n?/m, '');
}

function sitemap(siteUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

/**
 * Build the static site into `outDir`. There is no bundler on purpose: the page is HTML, one
 * stylesheet, one small module and self-hosted assets, and a copy is the honest build step.
 */
export async function buildSite({ outDir = path.join(root, 'dist'), siteUrl = process.env.SITE_URL } = {}) {
  const url = normaliseSiteUrl(siteUrl);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const file of PAGE_FILES) {
    if (file === 'index.html') {
      const html = await readFile(path.join(root, file), 'utf8');
      await writeFile(path.join(outDir, file), applySiteUrl(html, url));
    } else {
      await cp(path.join(root, file), path.join(outDir, file));
    }
  }

  for (const dir of ASSET_DIRS) {
    await cp(path.join(root, dir), path.join(outDir, dir), { recursive: true });
  }

  if (url) {
    await writeFile(path.join(outDir, 'sitemap.xml'), sitemap(url));
    const robots = await readFile(path.join(outDir, 'robots.txt'), 'utf8');
    if (!robots.includes('Sitemap:')) {
      await writeFile(path.join(outDir, 'robots.txt'), `${robots.trimEnd()}\nSitemap: ${url}/sitemap.xml\n`);
    }
  }

  const files = await listFiles(outDir);
  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
  const { errors, warnings, stats } = validateHtml(html, { files, siteUrl: url });

  let bytes = 0;
  for (const file of files) bytes += (await readFile(path.join(outDir, file))).byteLength;

  return {
    outDir,
    siteUrl: url,
    files: [...files].sort(),
    errors,
    warnings,
    stats,
    bytes,
    sitemap: files.has('sitemap.xml'),
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = await buildSite({ outDir: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`error: ${error}`);
    console.error(`\nBuild failed with ${result.errors.length} error(s).`);
    process.exit(1);
  }
  const kb = (result.bytes / 1024).toFixed(0);
  console.log(`Built ${result.files.length} files (${kb} KB) into ${path.relative(process.cwd(), result.outDir) || '.'}`);
  console.log(`  ${result.stats.images} images · canonical ${result.siteUrl ?? 'omitted (set SITE_URL to add one)'} · sitemap ${result.sitemap ? 'yes' : 'omitted'}`);
}
