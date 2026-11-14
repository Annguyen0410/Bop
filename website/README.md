# Bop — product site

The site in this folder introduces the two Bop apps. It is a static page: HTML, one stylesheet, one
small ES module, one self-hosted variable font and WebP captures of the real app. No runtime
dependencies, no build framework, no third-party requests.

```bash
cd website
npm ci
npm run dev        # http://127.0.0.1:4173, serves this folder
npm run build      # -> dist/, then validates the output
npm run preview    # serves dist/
npm test           # node:test, including the build and the payload budget
npm run check:browser   # real Chrome via playwright-core, screenshots in test/artifacts/
```

## The design

The app's own identity is a friendly lime bubble on a plum field, chunky rounded type and two
accent surfaces: lime for "go" and lavender for quiet facts. The site keeps that palette, uses
Bricolage Grotesque for display type and the system mono for labels, and organizes itself as an
editorial sheet: hairline rules, numbered sections, asymmetric feature spans, and real captures on
paper-white plates instead of a wall of identical cards.

Two sections carry the product argument rather than describing it:

- **04 / Poke the bubble** is a working model of the unread badge. It uses the same rules as
  `VipBadge.kt` — 99+ ceiling, one VIP waiting chat turns the badge red, zero hides it — and it says
  on the page that it is a simulation, not a live connection.
- **06 / Proof** lists only measurements that exist in this repository, each with a link to its raw
  report, and a plain block of what Bop cannot do.

The page does not invent a store listing, a licence or a signed build. All four download links point
at the real `v0.2.8` release assets.

## Modern web techniques used

- `light-dark()` colour tokens with `color-scheme`, plus a persistent three-state appearance control
  (System / Light / Dark) that writes to `localStorage` and a `<meta name="color-scheme">`, mapped
  back into CSS with `:has()`. The control lives in the footer, not in the site chrome, and the page
  works without JavaScript.
- Container queries on feature items, `clamp()` fluid type, logical properties, `text-wrap: balance`
  for headings and `pretty` for body copy, and `color-mix()` for derived surfaces.
- A scroll-driven reading rule behind `@supports (animation-timeline: scroll())` and
  `prefers-reduced-motion: no-preference`; nothing depends on it.
- Native `<dialog>` for the screenshot lightbox (`showModal`, `closedby="any"`, a pointer-position
  fallback where `closedBy` is missing, scroll containment on the dialog and its backdrop).
- Native `<details>` for the FAQ, real `<button>` controls with an `aria-live` readout in the demo,
  and a skip link. No ARIA roles duplicate what the elements already provide.
- `fetchpriority="high"` on exactly one image (the desktop hub, the LCP candidate), `loading="lazy"`
  everywhere below the fold, and explicit `width`/`height` on every image.

## Build and deployment

`npm run build` copies the page and assets to `dist/` and validates them. Set `SITE_URL` to add a
canonical URL, an absolute `og:image` and a `sitemap.xml`:

```bash
SITE_URL=https://your.domain npm run build
```

Without it, the canonical line is removed rather than filled with a made-up domain, and no sitemap is
written — a sitemap needs absolute URLs. `robots.txt` is always present.

`dist/` is plain static files. Upload it to any static host (GitHub Pages, Cloudflare Pages, Netlify,
S3, nginx). There is no server-side component, no environment variable at runtime and no secret.

**Not deployed from this repository.** No domain has been chosen, so no live URL is claimed anywhere
on the page.

## Checks

| Command | What it proves |
| --- | --- |
| `npm run build` | Every local reference resolves, images are sized and described, one h1, heading order, meta/OG present, JSON-LD parses, no external subresources, no inline handlers, no placeholder left |
| `npm test` | The badge rules match `VipBadge.kt`; builds with and without `SITE_URL`; the validator rejects broken markup; HTML/CSS/JS/image/font budgets hold |
| `npm run check:browser` | In installed Chrome: 1440/768/360 layouts have no horizontal overflow and no broken images, no console errors, the badge demo obeys the rules including the 99+ cap, the dialog opens and closes with Escape, the first Tab reaches the skip link with a visible ring, 42 contrast pairs pass WCAG in both schemes, and reduced motion leaves all content visible |

`check:browser` writes screenshots and `report.json` to `test/artifacts/` (ignored by git). It uses
`playwright-core` with `channel: "chrome"`, so it does not download a browser.

## Assets

- `assets/fonts/bricolage-grotesque-latin.woff2` — Bricolage Grotesque (SIL Open Font License),
  latin subset, self-hosted.
- `assets/img/*.webp` — conversions of captures in `docs/screenshots/` and
  `docs/evidence/desktop-portable/`. Nothing is a mockup; captions say what each capture shows.
- `assets/img/og.png` — the 1200×630 social card, rendered from `scripts/og.html` with headless
  Chrome. Re-render it after changing the wordmark or the headline:

  ```bash
  cd scripts
  chrome --headless=new --window-size=1200,630 --screenshot=../assets/img/og.png "$(pwd)/og.html"
  ```
