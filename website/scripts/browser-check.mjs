import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const artifacts = path.join(root, 'test', 'artifacts');

const CONTRAST_TARGETS = [
  { selector: '.headline-line--mark', label: 'Hero highlight' },
  { selector: '.mark-underline', label: 'Download highlight' },
  { selector: '.hero__lead', label: 'Hero lead' },
  { selector: '.section__lead', label: 'Section lead' },
  { selector: '.feature--lead > p', label: 'Lime panel body' },
  { selector: '.feature--privacy > p', label: 'Lavender panel body' },
  { selector: '.proof-row__note', label: 'Proof source' },
  { selector: '.proof-row__result', label: 'Proof result' },
  { selector: '.button--primary', label: 'Primary button' },
  { selector: '.button--ghost', label: 'Ghost button' },
  { selector: '.lab__readout', label: 'Demo readout' },
  { selector: '.lab__hint', label: 'Demo hint' },
  { selector: '.badge--vip', label: 'VIP badge digits' },
  { selector: '.badge--normal', label: 'Ordinary badge digits' },
  { selector: '.download__lead', label: 'Download lead' },
  { selector: '.download-card__meta', label: 'Download card meta' },
  { selector: '.footer__legal', label: 'Footer legal' },
  { selector: '.masthead__nav a', label: 'Header nav' },
  { selector: '.eyebrow', label: 'Eyebrow label' },
  { selector: '.shot__cap', label: 'Gallery caption' },
  { selector: '.step__meta', label: 'Step meta' },
];

/** Resolve any CSS color (including oklch) to sRGB and measure WCAG contrast. */
async function measureContrast(page) {
  return page.evaluate((targets) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    const resolve = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = '#000';
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };

    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    const ratio = (first, second) => {
      const a = luminance(first);
      const b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };

    const background = (element) => {
      let node = element;
      while (node) {
        const colour = resolve(getComputedStyle(node).backgroundColor);
        if (colour.a > 0.95) return colour;
        node = node.parentElement;
      }
      return resolve('white');
    };

    return targets.map(({ selector, label }) => {
      const element = document.querySelector(selector);
      if (!element) return { selector, label, missing: true };
      const style = getComputedStyle(element);
      const size = parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      return {
        selector,
        label,
        measured: Math.round(ratio(resolve(style.color), background(element)) * 100) / 100,
        required: large ? 3 : 4.5,
        size,
        weight,
      };
    });
  }, CONTRAST_TARGETS);
}

async function run() {
  await mkdir(artifacts, { recursive: true });
  // Port 0 lets the OS choose a free port, so a stray server from an interrupted run cannot
  // block the check.
  const server = await startServer({ root: dist, port: 0 });
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const failures = [];
  const notes = [];
  const check = (name, ok, detail = '') => {
    if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    return ok;
  };

  // A very tall mobile page can exceed headless Chrome's maximum capture surface. Fall back to
  // viewport captures at the top, middle and bottom so the review still has real pixels.
  const capture = async (page, file) => {
    try {
      await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
      return;
    } catch (error) {
      notes.push(`full-page capture fallback for ${path.basename(file)}: ${error.message.split('\n')[0]}`);
    }
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const view = page.viewportSize();
    const offsets = [0, Math.round((height - view.height) / 2), Math.max(0, height - view.height)];
    for (let index = 0; index < offsets.length; index += 1) {
      await page.evaluate((top) => window.scrollTo(0, top), offsets[index]);
      await page.waitForTimeout(120);
      await page.screenshot({ path: file.replace('.png', `-${index + 1}.png`) });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  };

  try {
    console.log('Launching Chrome and opening the built site…');
    const viewports = [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'mobile', width: 360, height: 800 },
    ];

    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
      const page = await context.newPage();
      const consoleErrors = [];
      const failedResponses = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', (error) => consoleErrors.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
      });

      const response = await page.goto(base, { waitUntil: 'load' });
      check(`${viewport.name}: responds 200`, response?.status() === 200, String(response?.status()));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);

      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      check(`${viewport.name}: no horizontal overflow`, widths.scroll <= widths.client + 1, `${widths.scroll} > ${widths.client}`);

      // Force every image to load so the check verifies the assets themselves, not the browser's
      // lazy-loading heuristics. No decode() here: a lazy image that is never fetched leaves
      // decode() pending forever, which would hang the whole check.
      await page.evaluate(() => {
        for (const image of document.images) image.loading = 'eager';
      });
      await page.waitForFunction(
        () => [...document.images].every((image) => image.complete && image.naturalWidth > 0),
        null,
        { timeout: 15000 },
      ).catch(() => {});
      console.log(`  ${viewport.name}: layout, console, images`);
      const images = await page.evaluate(() => [...document.images]
        .filter((image) => image.getAttribute('src'))
        .map((image) => ({
          src: (image.currentSrc || image.src).split('/').pop(),
          complete: image.complete,
          width: image.naturalWidth,
        })));
      const broken = images.filter((image) => !image.complete || image.width === 0);
      check(
        `${viewport.name}: every image loads`,
        broken.length === 0 && failedResponses.length === 0,
        broken.map((image) => image.src).join(', ') || failedResponses.join(', '),
      );

      const heading = await page.locator('h1').boundingBox();
      check(`${viewport.name}: h1 is inside the viewport`, heading !== null && heading.width <= viewport.width, JSON.stringify(heading));
      check(`${viewport.name}: no console errors`, consoleErrors.length === 0, consoleErrors.join(' | '));

      await capture(page, path.join(artifacts, `${viewport.name}-light.png`));

      if (viewport.name === 'desktop') {
        // The sticky masthead would be composited over an element screenshot; hide it for the
        // section plates so the review sees the section itself.
        await page.evaluate(() => {
          document.querySelector('.masthead').style.visibility = 'hidden';
          document.querySelector('.reading-rule').style.visibility = 'hidden';
        });
        for (const [section, selector] of [
          ['hero', '.hero'], ['features', '.features'], ['demo', '.lab'], ['download', '.download'],
        ]) {
          const box = page.locator(selector);
          if (await box.count()) {
            await box.first().scrollIntoViewIfNeeded();
            await page.waitForTimeout(80);
            await box.first().screenshot({ path: path.join(artifacts, `section-${section}.png`) });
          }
        }
        await page.evaluate(() => {
          document.querySelector('.masthead').style.visibility = '';
          document.querySelector('.reading-rule').style.visibility = '';
        });
      }
      if (viewport.name === 'mobile') {
        await page.locator('.hero').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(artifacts, 'mobile-hero.png') });
        await page.locator('.lab').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(artifacts, 'mobile-demo.png') });
        await page.locator('.download').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(artifacts, 'mobile-download.png') });
      }

      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    console.log('  interactions: badge model, dialog, keyboard, contrast');

    /* ---- the badge simulation ---- */
    const badge = page.locator('[data-badge]');
    const readout = page.locator('[data-readout]');

    await page.locator('[data-arrive="A"]').click();
    await page.locator('[data-arrive="A"]').click();
    await page.locator('[data-arrive="B"]').click();
    check('demo: three arrivals read 3', (await badge.textContent()).trim() === '3', await badge.textContent());
    check('demo: ordinary arrivals stay blue', !(await badge.getAttribute('class')).includes('is-vip'));
    check('demo: readout names the blue tone', (await readout.textContent()).includes('blue'));

    await page.locator('[data-vip="A"]').check();
    check('demo: one VIP waiting chat turns the badge red', (await badge.getAttribute('class')).includes('is-vip'));
    check('demo: readout explains the red tone', (await readout.textContent()).includes('red'));
    const badgeColour = await badge.evaluate((element) => getComputedStyle(element).backgroundColor);
    const channels = badgeColour.match(/[\d.]+/g)?.map(Number) ?? [];
    check('demo: VIP badge is red, not merely labelled', channels[0] > channels[1] && channels[0] > channels[2], badgeColour);

    await page.evaluate(() => {
      const button = document.querySelector('[data-arrive="A"]');
      for (let index = 0; index < 100; index += 1) button.click();
    });
    check('demo: the cap reads 99+', (await badge.textContent()).trim() === '99+', await badge.textContent());

    await page.locator('[data-reset]').click();
    check('demo: clearing everything hides the badge', await badge.isHidden());
    check('demo: clearing resets the VIP switches', !(await page.locator('[data-vip="A"]').isChecked()));
    await page.locator('[data-arrive="D"]').click();
    await page.locator('[data-read="D"]').click();
    check('demo: reading the last card hides the badge again', await badge.isHidden());

    /* ---- the gallery dialog ---- */
    await page.locator('[data-shot]').first().click();
    const dialog = page.locator('#shot-dialog');
    check('gallery: dialog opens modally', await dialog.evaluate((element) => element.open && element.matches(':modal')));
    check('gallery: dialog shows the chosen caption', (await page.locator('#shot-title').textContent()).length > 4);
    await page.screenshot({ path: path.join(artifacts, 'dialog.png') });
    await page.keyboard.press('Escape');
    check('gallery: Escape closes the dialog', !(await dialog.evaluate((element) => element.open)));

    /* ---- anchor navigation clears the sticky masthead ---- */
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      location.hash = '#demo';
    });
    await page.waitForTimeout(150);
    const clearance = await page.evaluate(() => {
      const header = document.querySelector('.masthead').getBoundingClientRect();
      const section = document.querySelector('#demo').getBoundingClientRect();
      return Math.round(section.top - header.bottom);
    });
    check('navigation: an anchored section clears the sticky header', clearance >= -1, `${clearance}px`);

    /* ---- keyboard focus ---- */
    await page.goto(base, { waitUntil: 'load' });
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      return { tag: element.tagName, text: element.textContent.trim(), outline: style.outlineStyle, width: style.outlineWidth };
    });
    check('keyboard: the first Tab reaches the skip link', focus.tag === 'A' && focus.text.startsWith('Skip'), JSON.stringify(focus));
    check('keyboard: a visible focus ring is drawn', focus.outline !== 'none' && parseFloat(focus.width) >= 2, JSON.stringify(focus));

    /* ---- contrast, both schemes ---- */
    const light = await measureContrast(page);
    for (const result of light) {
      if (result.missing) { failures.push(`contrast (light): ${result.label} not found`); continue; }
      check(
        `contrast (light): ${result.label} ${result.measured}:1 ≥ ${result.required}:1`,
        result.measured >= result.required,
        `${result.measured} at ${result.size}px/${result.weight}`,
      );
    }

    await page.locator('input[name="appearance"][value="dark"]').check();
    await page.waitForTimeout(450);
    check('appearance: the meta colour-scheme follows the choice', (await page.locator('meta[name="color-scheme"]').getAttribute('content')) === 'dark');
    const darkScheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    check('appearance: the CSS scheme follows the meta tag', darkScheme === 'dark', darkScheme);
    await capture(page, path.join(artifacts, 'desktop-dark.png'));
    await page.locator('.hero').scrollIntoViewIfNeeded();
    await page.locator('.hero').screenshot({ path: path.join(artifacts, 'section-hero-dark.png') });

    const dark = await measureContrast(page);
    for (const result of dark) {
      if (result.missing) { failures.push(`contrast (dark): ${result.label} not found`); continue; }
      check(
        `contrast (dark): ${result.label} ${result.measured}:1 ≥ ${result.required}:1`,
        result.measured >= result.required,
        `${result.measured} at ${result.size}px/${result.weight}`,
      );
    }

    await page.reload({ waitUntil: 'load' });
    check('appearance: the choice survives a reload', (await page.locator('meta[name="color-scheme"]').getAttribute('content')) === 'dark');
    await page.locator('input[name="appearance"][value="system"]').check();
    check('appearance: System reverts the override', (await page.locator('meta[name="color-scheme"]').getAttribute('content')) === 'light dark');

    check('interactions: no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
    notes.push('desktop screenshots: desktop-light.png, desktop-dark.png, tablet-light.png, mobile-light.png, dialog.png');
    await context.close();

    /* ---- reduced motion ---- */
    console.log('  reduced motion');
    const calm = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
    const calmPage = await calm.newPage();
    const calmErrors = [];
    calmPage.on('pageerror', (error) => calmErrors.push(error.message));
    await calmPage.goto(base, { waitUntil: 'load' });
    const visibility = await calmPage.evaluate(() => {
      const feature = document.querySelector('.feature');
      const heading = document.querySelector('h1');
      return {
        featureOpacity: getComputedStyle(feature).opacity,
        headingOpacity: getComputedStyle(heading).opacity,
        ruleDisplay: getComputedStyle(document.querySelector('.reading-rule')).display,
      };
    });
    check('reduced motion: content stays visible', visibility.featureOpacity === '1' && visibility.headingOpacity === '1', JSON.stringify(visibility));
    check('reduced motion: no page errors', calmErrors.length === 0, calmErrors.join(' | '));
    await calm.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    failures,
    notes,
    contrastTargets: CONTRAST_TARGETS.length,
  };
  await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

  if (failures.length > 0) {
    console.error(`Browser check failed (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Browser check passed: 3 viewports, demo interactions, dialog, keyboard, reduced motion, ${CONTRAST_TARGETS.length * 2} contrast pairs.`);
  for (const note of notes) console.log(`  ${note}`);
}

await run();
