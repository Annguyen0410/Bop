'use strict';

/**
 * Bop Desktop's space model. No Electron and no Node dependency at all, so every rule is unit-tested.
 *
 * Two deliberate differences from the Android build:
 *
 * 1. A space carries a `kind`. `social` spaces are the messaging accounts the phone build already
 *    handles. `tasks` spaces are the work/earning sites (user-testing panels, crowdsourcing platforms)
 *    that the phone build deliberately does not have.
 * 2. A space can be *watched*. On the desktop the page keeps a live connection and its own
 *    Notification API works, so Bop can also notice a page that changed while nobody was looking —
 *    which is the whole point of the task spaces, where a new test disappears in minutes.
 *
 * The identity rules are still a one-for-one port of the Android `AccountId`: bijective base-26 names
 * A..Z, AA..ZZ, ..., no fixed ceiling, and stored names validated on read.
 */

const MAX_ORDINAL = 2147483647; // Same ceiling as the Android 32-bit Int, so ids stay interchangeable.
const MAX_NAME_LENGTH = 7;

const KINDS = ['social', 'tasks'];
const DEFAULT_KIND = 'social';

/** A..Z, AA..AZ, BA.. -> the A1Z26-bijective name for a zero-based ordinal. */
function nameForOrdinal(ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > MAX_ORDINAL) return null;
  let n = ordinal + 1;
  let out = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** The inverse of {@link nameForOrdinal}; null for anything that is not a plain A-Z name. */
function ordinalForName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
  let ordinal = 0;
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (code < 65 || code > 90) return null;
    ordinal = ordinal * 26 + (code - 64);
    if (ordinal > MAX_ORDINAL + 1) return null;
  }
  return ordinal - 1;
}

/** Compares two space names the way the Android app sorts `AccountId` values. */
function compareNames(left, right) {
  const a = ordinalForName(left);
  const b = ordinalForName(right);
  if (a === null || b === null) return String(left).localeCompare(String(right));
  return a - b;
}

const ACCENTS = {
  messenger: 0x5375ff, facebook: 0x1877f2, instagram: 0xe1306c, whatsapp: 0x25d366,
  tiktok: 0x6b4bff, telegram: 0x2aabee, zalo: 0x0068ff, x: 0x1da1f2,
  threads: 0x8b5cf6, reddit: 0xff4500, discord: 0x5865f2, snapchat: 0xf5c518,
  linkedin: 0x0a66c2, viber: 0x7360f2, skype: 0x00aff0, googlechat: 0x00ac47,
  vk: 0x0077ff, bluesky: 0x0085ff, wechat: 0x07c160,
  // Task and earning panels. Verified entry domains; a panel that moves keeps working because every
  // task space's URL stays editable in the app.
  usertesting: 0xff4a9c, userlytics: 0xff8a00, prolific: 0x1f9d55, clickworker: 0x0f766e,
  toloka: 0xffd400, appen: 0x0057b8, utest: 0x00a3e0, mturk: 0xff9900,
  userfeel: 0x7c3aed, intellizoom: 0x0ea5e9, trymata: 0xdb2777, respondent: 0x111827,
  testbirds: 0x84cc16,
  custom: 0x7862bc,
};

/**
 * Services a space can host. `hosts` is the allow-list the space's main frame may navigate on;
 * anything else is handed to the system browser instead of rendering inside the space.
 *
 * `kind` decides which half of the hub the space appears in. `login` is the desktop-specific note,
 * because web sign-in differs per service and a wrong expectation is the usual support question.
 */
const APPS = [
  // ---- social ---------------------------------------------------------------------------------
  { id: 'messenger', label: 'Messenger', kind: 'social', home: 'https://www.messenger.com/', hosts: ['facebook.com', 'messenger.com'], login: 'Sign in with your Facebook account. Each space gets its own cookie jar, so two Facebook logins run side by side.' },
  { id: 'facebook', label: 'Facebook', kind: 'social', home: 'https://www.facebook.com/messages', hosts: ['facebook.com', 'messenger.com'], login: "The Facebook website including its messages page. Facebook's own notifications mix likes, job ads and page posts with messages, so read the card title before trusting it." },
  { id: 'instagram', label: 'Instagram', kind: 'social', home: 'https://www.instagram.com/direct/inbox/', hosts: ['instagram.com', 'facebook.com'], login: 'Sign in normally. Two spaces can hold two Instagram accounts at once.' },
  { id: 'whatsapp', label: 'WhatsApp', kind: 'social', home: 'https://web.whatsapp.com/', hosts: ['whatsapp.com', 'whatsapp.net'], login: 'Link this computer by scanning the QR code with WhatsApp on your phone. WhatsApp limits how many devices can be linked.' },
  { id: 'tiktok', label: 'TikTok', kind: 'social', home: 'https://www.tiktok.com/messages', hosts: ['tiktok.com'], login: 'Sign in with your TikTok account. Notifications arrive from the website while the space is loaded.' },
  { id: 'telegram', label: 'Telegram', kind: 'social', home: 'https://web.telegram.org/', hosts: ['telegram.org', 't.me'], login: 'Sign in with your phone number (the code arrives in the Telegram app) or scan a QR code from another device.' },
  { id: 'zalo', label: 'Zalo', kind: 'social', home: 'https://chat.zalo.me/', hosts: ['zalo.me', 'zaloapp.com'], login: 'Sign in by scanning the QR code with Zalo on your phone.' },
  { id: 'x', label: 'X', kind: 'social', home: 'https://x.com/messages', hosts: ['x.com', 'twitter.com'], login: 'Sign in normally. Two spaces hold two X accounts.' },
  { id: 'threads', label: 'Threads', kind: 'social', home: 'https://www.threads.com/', hosts: ['threads.com', 'threads.net'], login: 'Sign in with your Instagram account.' },
  { id: 'reddit', label: 'Reddit', kind: 'social', home: 'https://www.reddit.com/chat/', hosts: ['reddit.com', 'redd.it'], login: 'Sign in normally. Reddit chat notifications arrive while the space is loaded.' },
  { id: 'discord', label: 'Discord', kind: 'social', home: 'https://discord.com/app', hosts: ['discord.com', 'discord.gg', 'discordapp.com'], login: 'Sign in normally, invite links included.' },
  { id: 'snapchat', label: 'Snapchat', kind: 'social', home: 'https://web.snapchat.com/', hosts: ['snapchat.com'], login: 'Scan the QR code with Snapchat on your phone to link this computer.' },
  { id: 'linkedin', label: 'LinkedIn', kind: 'social', home: 'https://www.linkedin.com/messaging/', hosts: ['linkedin.com'], login: 'Sign in normally. Notifications here include job and network alerts, not only messages.' },
  { id: 'viber', label: 'Viber', kind: 'social', home: 'https://web.viber.com/', hosts: ['viber.com'], login: 'Scan the QR code with Viber on your phone.' },
  { id: 'skype', label: 'Skype', kind: 'social', home: 'https://web.skype.com/', hosts: ['skype.com', 'live.com', 'microsoft.com', 'microsoftonline.com'], login: 'Sign-in continues on Microsoft’s own live.com pages, which is why those hosts are allowed in this space.' },
  { id: 'googlechat', label: 'Google Chat', kind: 'social', home: 'https://chat.google.com/', hosts: ['chat.google.com', 'accounts.google.com', 'myaccount.google.com'], login: 'Sign-in stays on Google’s own accounts page. Two spaces can hold two Google accounts.' },
  { id: 'vk', label: 'VK', kind: 'social', home: 'https://vk.com/im', hosts: ['vk.com', 'vk.me', 'vk.cc'], login: 'Sign in normally.' },
  { id: 'bluesky', label: 'Bluesky', kind: 'social', home: 'https://bsky.app/messages', hosts: ['bsky.app', 'bsky.social'], login: 'Sign in with your handle and app password.' },
  { id: 'wechat', label: 'WeChat', kind: 'social', home: 'https://web.wechat.com/', hosts: ['wechat.com', 'weixin.qq.com'], login: 'Scan the QR code with WeChat on your phone.' },

  // ---- task and earning panels ----------------------------------------------------------------
  { id: 'usertesting', label: 'UserTesting', kind: 'tasks', home: 'https://www.usertesting.com/', hosts: ['usertesting.com'], login: 'Sign in at the top right, then open the tester dashboard. New tests appear there, and a test can fill up within minutes.' },
  { id: 'userlytics', label: 'Userlytics', kind: 'tasks', home: 'https://www.userlytics.com/', hosts: ['userlytics.com'], login: 'Sign in and open your tester dashboard for available studies.' },
  { id: 'prolific', label: 'Prolific', kind: 'tasks', home: 'https://www.prolific.com/', hosts: ['prolific.com'], login: 'Sign in and open Studies. Prolific is the most time-critical panel here — good studies fill almost immediately.' },
  { id: 'clickworker', label: 'Clickworker', kind: 'tasks', home: 'https://www.clickworker.com/', hosts: ['clickworker.com'], login: 'Sign in and open the workplace for available jobs.' },
  { id: 'toloka', label: 'Toloka', kind: 'tasks', home: 'https://toloka.ai/', hosts: ['toloka.ai', 'toloka.yandex.com'], login: 'Sign in and open your task list.' },
  { id: 'appen', label: 'Appen', kind: 'tasks', home: 'https://connect.appen.com/', hosts: ['appen.com'], login: 'Sign in to Appen Connect and open your projects.' },
  { id: 'utest', label: 'uTest', kind: 'tasks', home: 'https://www.utest.com/', hosts: ['utest.com', 'applause.com'], login: 'Sign in and open your project board.' },
  { id: 'mturk', label: 'Amazon MTurk', kind: 'tasks', home: 'https://worker.mturk.com/', hosts: ['mturk.com', 'amazon.com'], login: 'Sign in with your Amazon account. Available work is job-list dependent, so watch the HITs page you actually use.' },
  { id: 'userfeel', label: 'Userfeel', kind: 'tasks', home: 'https://www.userfeel.com/', hosts: ['userfeel.com'], login: 'Sign in and open your tester page for available tests.' },
  { id: 'intellizoom', label: 'IntelliZoom', kind: 'tasks', home: 'https://www.intellizoom.com/', hosts: ['intellizoom.com', 'userzoom.com'], login: 'Sign in and open the studies list.' },
  { id: 'trymata', label: 'Trymata', kind: 'tasks', home: 'https://app.trymata.com/', hosts: ['trymata.com'], login: 'Sign in and open available tests.' },
  { id: 'respondent', label: 'Respondent', kind: 'tasks', home: 'https://app.respondent.io/', hosts: ['respondent.io'], login: 'Sign in and open your project feed.' },
  { id: 'testbirds', label: 'Testbirds', kind: 'tasks', home: 'https://nest.testbirds.com/', hosts: ['testbirds.com'], login: 'Sign in to the Nest and open available tests.' },
  { id: 'custom', label: 'Any other site', kind: 'tasks', home: '', hosts: [], login: 'Type the exact page you want to watch. The whole host is allowed to navigate, and only that host.' },
];

const DEFAULT_APP_ID = 'messenger';

function appById(id) {
  return APPS.find((app) => app.id === id) || null;
}

/** Stored ids are validated on read, so an unknown id falls back instead of hiding the space. */
function appOrDefault(id) {
  return appById(id) || appById(DEFAULT_APP_ID);
}

function hexColor(id) {
  const value = ACCENTS[appById(id) ? id : DEFAULT_APP_ID] || ACCENTS[DEFAULT_APP_ID];
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** A custom space allows exactly the host the user typed; a catalog space allows its own domains. */
function hostsFor(space) {
  const app = appOrDefault(space.appId);
  if (space.appId !== 'custom') return app.hosts;
  const hostname = hostnameOf(space.url);
  return hostname ? [hostname] : [];
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch (_) {
    return null;
  }
}

/** Only the main frame may load these; anything else is handed to the system browser. */
function hostAllowed(hosts, hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;
  const host = hostname.toLowerCase();
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** The URL a space opens: its own typed URL for custom spaces, the catalog home otherwise. */
function homeFor(space) {
  if (space.appId === 'custom') return typeof space.url === 'string' ? space.url : '';
  return appOrDefault(space.appId).home;
}

function pageAllowed(space, url) {
  const hostname = hostnameOf(url);
  if (!hostname) return false;
  if (!hostAllowed(hostsFor(space), hostname)) return false;
  if (url.startsWith('https://')) return true;
  // Plain http is refused everywhere except a loopback address, which cannot leave the machine.
  // Same rule the Android build enforces with usesCleartextTraffic="false".
  return url.startsWith('http://') && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1');
}

/**
 * What opening a space needs, or the plain-language reason it cannot be opened.
 *
 * A space with no address is a real state — a `custom` space whose address was never filled in, or was
 * cleared by hand — and measured on 0.1.4 it was a trap: `Open` created an empty pane that covered the
 * whole hub, painted nothing and swallowed every click in that area, including the dialog the user
 * would have used to fix it. So there is exactly one place that decides whether a space has a page to
 * show, and the app refuses the rest out loud instead of drawing a blank.
 */
function openTarget(space) {
  if (!space) return { url: '', error: 'That space does not exist any more.' };
  const url = homeFor(space);
  if (!url) {
    return {
      url: '',
      error: space.appId === 'custom'
        ? 'This space has no address yet. Open Edit and paste the page it should show.'
        : 'This space has no home address. Open Edit and pick a service.',
    };
  }
  if (!pageAllowed(space, url)) {
    const allowed = hostsFor(space);
    return { url: '', error: `Only an https page on ${allowed.join(', ') || 'its own host'} can open in this space.` };
  }
  return { url, error: null };
}

const DEFAULT_SLOTS = ['A', 'B'];
/** Bumped when a stored file needs a one-time repair on read; see [normalize]. */
const STATE_VERSION = 3;
/** The version that introduced per-kind layouts; a file older than this gets its layout repaired once. */
const LAYOUT_VERSION = 2;
const DEFAULT_WATCH_MINUTES = 10;
const MIN_WATCH_MINUTES = 1;
const MAX_WATCH_MINUTES = 720;
const MAX_PHRASE = 80;

/**
 * A space asks for the *phone* layout by default. The pane Bop gives a space is narrow on purpose —
 * narrower than most desktop sites are designed for — and a wide layout is where a page's own dialog
 * ends up with its close button outside the visible area. The mobile site is the one built to fit an
 * arbitrary width, so it stays the default for task panels, and `phoneLayout: true` can be picked by
 * hand for any space.
 */
const DEFAULT_PHONE_LAYOUT = true;

/**
 * What a *new* space starts on, per kind.
 *
 * A messaging service's mobile website is not its messages page. Measured with the phone user agent
 * this build used for every space (see docs/desktop.md): `tiktok.com/messages` is replaced by the For
 * You feed, `web.whatsapp.com` answers with its `/mobile/` landing page, Snapchat sends a mobile
 * landing page, and `web.skype.com` refuses the browser outright. None of those pages shows a chat or
 * can raise a message alert, which is the one thing a `social` space exists for — so social spaces
 * start on the desktop site. Task panels keep the phone layout: they are dashboards built to be tapped
 * and their mobile form fits the narrow pane.
 */
function defaultPhoneLayout(app, kind) {
  const resolved = KINDS.includes(kind) ? kind : (app && KINDS.includes(app.kind) ? app.kind : DEFAULT_KIND);
  return resolved !== 'social';
}

/**
 * What a site is told about the browser it is talking to.
 *
 * Neither agent may carry the words `Electron` or `Bop`. Measured on 0.1.5 against
 * `app.usercrowd.com` (a real task panel, and the site this app exists for): with the Electron default
 * agent the site answered `https://app.usercrowd.com/unsupported_browser` — "Sorry, you can't use
 * UserCrowd on this version of Electron" — while the very same engine, asked as Chrome, served its
 * sign-in page. A site that refuses Electron refuses Bop with it, so the platform claim is kept to what
 * the engine actually is, and the only difference between the two agents is the device they claim.
 *
 * `phoneLayout` (the default) claims a phone running *this* Chromium, so the site serves the mobile
 * layout — the one built to fit an arbitrary width. The desktop agent claims the desktop it is really
 * running on, for the services whose mobile site has no messages page at all.
 */
function userAgentFor(space, environment = {}) {
  const version = String(environment.chrome || '0');
  if (space && space.phoneLayout === false) {
    const system = environment.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
      : environment.platform === 'linux' ? 'X11; Linux x86_64'
        : 'Windows NT 10.0; Win64; x64';
    return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  }
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`;
}

/**
 * True when a page answered by refusing the browser instead of serving itself. Nothing about that page
 * says why it happened in a way the user can act on: they only see a pane that looks like Bop failed to
 * load. Naming it on the space card is the difference between a mystery and a next step.
 *
 * The URL is checked because a refusal is usually its own route (`/unsupported_browser`), and the title
 * because a refusal is usually its own sentence. Both are short and specific; the page *body* is never
 * read, so an article that happens to discuss old browsers cannot trip this.
 */
function browserRefusal(url, title) {
  if (/unsupported[_-]?browser|browser[_-]?(?:not[_-]?supported|blocked)/i.test(String(url || ''))) return true;
  const heading = String(title || '');
  if (/this version of (?:electron|bop)/i.test(heading)) return true;
  return /browser/i.test(heading) && /(unsupported|not supported|update|out of date|outdated|older|blocked)/i.test(heading);
}

function watchDefaults() {
  return {
    enabled: false,
    minutes: DEFAULT_WATCH_MINUTES,
    selector: '',
    // A watch can also be filtered by phrase. `require` turns a noisy board into "only card me when a
    // study is actually available"; `ignore` drops the parts of a page that churn on their own (ads,
    // a clock, a chat ticker). Both are plain case-insensitive substrings of the page title + text.
    require: '',
    ignore: '',
    fingerprint: null,
    lastCheckAt: 0,
    lastChangeAt: 0,
    failures: 0,
  };
}

function normalizeWatch(raw) {
  const base = watchDefaults();
  if (!raw || typeof raw !== 'object') return base;
  const minutes = Number(raw.minutes);
  const phrase = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_PHRASE) : '');
  return {
    enabled: raw.enabled === true,
    minutes: Number.isFinite(minutes)
      ? Math.min(Math.max(Math.round(minutes), MIN_WATCH_MINUTES), MAX_WATCH_MINUTES)
      : DEFAULT_WATCH_MINUTES,
    selector: typeof raw.selector === 'string' ? raw.selector.trim().slice(0, 200) : '',
    require: phrase(raw.require),
    ignore: phrase(raw.ignore),
    fingerprint: typeof raw.fingerprint === 'string' ? raw.fingerprint.slice(0, 64) : null,
    lastCheckAt: Number.isFinite(Number(raw.lastCheckAt)) ? Number(raw.lastCheckAt) : 0,
    lastChangeAt: Number.isFinite(Number(raw.lastChangeAt)) ? Number(raw.lastChangeAt) : 0,
    failures: Number.isFinite(Number(raw.failures)) ? Math.max(0, Math.round(Number(raw.failures))) : 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Bubble preferences. The bubble is the one part of the desktop app you look at all day, so its size,
// transparency, what a double-click does and the picture it wears are all settings rather than
// constants. They live in the same encrypted file as everything else, and the spot it was dropped in is
// stored as a fraction of the screen so a resize or a second monitor keeps it there. Nothing here docks
// it to an edge: the bubble stays wherever it was dropped.
// ---------------------------------------------------------------------------------------------
const BUBBLE_SIZES = [48, 56, 64, 72, 80];
const DEFAULT_BUBBLE_SIZE = 64;
const BUBBLE_MIN_OPACITY = 45;
const BUBBLE_MAX_OPACITY = 100;
const BUBBLE_DOUBLE_CLICK = ['menu', 'last-space', 'dashboard'];
/** Characters of avatar data URL allowed in the settings file. Same bound as `avatar.js` keeps. */
const AVATAR_MAX_LENGTH = 400_000;

function bubbleDefaults() {
  return { size: DEFAULT_BUBBLE_SIZE, opacity: 100, doubleClick: 'menu', overFullscreen: true, spotX: 0.02, spotY: 0.35, avatar: '' };
}

/**
 * The bubble's face: a picture the user picked, kept as a data URL so it cannot break when the file it
 * came from is moved or deleted. Anything that is not a bounded data URL is dropped rather than trusted
 * — this value ends up in an `img` in a window with a strict content policy.
 */
function normalizeAvatar(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  if (!value) return '';
  if (value.length > AVATAR_MAX_LENGTH) return fallback;
  return /^data:image\//.test(value) ? value : fallback;
}

/** Snaps a requested pixel size to the nearest offered size, so a hand edit cannot ask for a 3px bubble. */
function nearestBubbleSize(value) {
  return BUBBLE_SIZES.reduce((best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best), BUBBLE_SIZES[0]);
}

function fraction(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, 0), 1);
}

function normalizeBubblePrefs(raw) {
  const base = bubbleDefaults();
  if (!raw || typeof raw !== 'object') return base;
  const size = Number(raw.size);
  const opacity = Number(raw.opacity);
  return {
    size: nearestBubbleSize(Number.isFinite(size) ? size : base.size),
    opacity: Number.isFinite(opacity)
      ? Math.min(Math.max(Math.round(opacity), BUBBLE_MIN_OPACITY), BUBBLE_MAX_OPACITY)
      : base.opacity,
    doubleClick: BUBBLE_DOUBLE_CLICK.includes(raw.doubleClick) ? raw.doubleClick : base.doubleClick,
    overFullscreen: raw.overFullscreen !== false,
    avatar: normalizeAvatar(raw.avatar, base.avatar),
    spotX: fraction(raw.spotX, base.spotX),
    spotY: fraction(raw.spotY, base.spotY),
  };
}

function setBubblePref(state, patch) {
  if (!patch || typeof patch !== 'object') return state;
  return { ...state, bubblePrefs: normalizeBubblePrefs({ ...(state.bubblePrefs || {}), ...patch }) };
}

function defaultState() {
  return {
    version: STATE_VERSION,
    spaces: DEFAULT_SLOTS.map((id) => ({
      id, label: `Account ${id}`, appId: DEFAULT_APP_ID, kind: DEFAULT_KIND, url: '', phoneLayout: defaultPhoneLayout(appOrDefault(DEFAULT_APP_ID), DEFAULT_KIND), watch: watchDefaults(),
    })),
    slots: [...DEFAULT_SLOTS],
    loadedSlots: [], // Only pages the user opened are restored; new spaces do not silently sign in.
    theme: 'system',
    // The bubble is on from the start. Bop is a monitor: something has to be visible when a message
    // arrives, and a bubble that never appears is exactly the "it does nothing" answer.
    bubble: true,
    bubblePrefs: bubbleDefaults(),
    watchWhileRunning: true,
    messageSound: true,
    // Started by the operating system at sign-in, so Bop is listening before the first message.
    startAtLogin: true,
    // Space pages keep their timers and sockets at full rate while they sit in the background pane;
    // see [spaceView] for what that trades against.
    keepPagesAlive: true,
    monitorState: {}, // Unread metadata only. Never titles, sender names or message contents.
  };
}

function accountFor(state, id) {
  return state.spaces.find((space) => space.id === id) || null;
}

/** Enabled spaces only, in name order. */
function enabledSpaces(state) {
  return sortedSlots(state).map((id) => accountFor(state, id)).filter(Boolean);
}

function sortedSlots(state) {
  return [...new Set(state.slots)].sort(compareNames);
}

/**
 * The next free name, taken from the *enabled* spaces so a removed letter comes back into the pool
 * before a brand-new one is minted. A hidden space keeps its binding but loses its claim on the name.
 */
function nextFree(state) {
  const taken = new Set(state.slots);
  let ordinal = 0;
  while (taken.has(nameForOrdinal(ordinal))) ordinal += 1;
  return nameForOrdinal(ordinal);
}

/** Enabling a space keeps its old label/app/watch settings when it was only hidden before. */
function enableSlot(state, id, options = {}) {
  if (!id) return state;
  const existing = accountFor(state, id);
  const app = appOrDefault(options.appId);
  const kind = KINDS.includes(options.kind) ? options.kind : app.kind;
  const created = {
    id,
    label: options.label || `Account ${id}`,
    appId: app.id,
    kind,
    url: typeof options.url === 'string' ? options.url : '',
    phoneLayout: options.phoneLayout == null ? defaultPhoneLayout(app, kind) : options.phoneLayout !== false,
    watch: watchDefaults(),
  };
  const spaces = existing ? state.spaces : [...state.spaces, created];
  if (state.slots.includes(id)) return { ...state, spaces };
  return { ...state, spaces, slots: [...state.slots, id] };
}

/** Disabling hides the space but keeps its label, app and watch settings for a later return. */
function disableSlot(state, id) {
  if (DEFAULT_SLOTS.includes(id) && state.slots.length <= DEFAULT_SLOTS.length) return state;
  if (!state.slots.includes(id)) return state;
  return { ...state, slots: state.slots.filter((value) => value !== id), loadedSlots: (state.loadedSlots || []).filter((value) => value !== id) };
}

function rename(state, id, label) {
  const trimmed = String(label == null ? '' : label).trim().slice(0, 60);
  if (!trimmed) return state;
  return { ...state, spaces: state.spaces.map((space) => (space.id === id ? { ...space, label: trimmed } : space)) };
}

function selectApp(state, id, appId, options = {}) {
  const app = appById(appId);
  if (!app || !state.slots.includes(id)) return state;
  return {
    ...state,
    spaces: state.spaces.map((space) => {
      if (space.id !== id) return space;
      const kind = KINDS.includes(options.kind) ? options.kind : app.kind;
      // A change of kind moves the space between the two halves of the hub, so its layout follows the
      // new half's default. Picking another app inside the same half leaves the user's layout alone.
      return { ...space, appId, kind, phoneLayout: kind === space.kind ? space.phoneLayout : defaultPhoneLayout(app, kind) };
    }),
  };
}

/** Custom spaces need a real https URL before they can open anything. */
function setUrl(state, id, url) {
  const value = String(url == null ? '' : url).trim().slice(0, 500);
  return { ...state, spaces: state.spaces.map((space) => (space.id === id ? { ...space, url: value } : space)) };
}

// ---------------------------------------------------------------------------------------------
// Fit and layout. On both builds the web screen must fit whatever screen it is given, so the phone
// layout is a property of a space rather than a global setting: one panel can keep its desktop form
// while everything else fits.
// ---------------------------------------------------------------------------------------------
function setPhoneLayout(state, id, on) {
  if (!state.slots.includes(id)) return state;
  return {
    ...state,
    spaces: state.spaces.map((space) => (space.id === id ? { ...space, phoneLayout: on === true } : space)),
  };
}

function setWatch(state, id, patch) {
  return {
    ...state,
    spaces: state.spaces.map((space) => (space.id === id
      ? { ...space, watch: normalizeWatch({ ...space.watch, ...patch }) }
      : space)),
  };
}

/** Remember explicit page opens, independently of the foreground pane. */
function rememberLoaded(state, id) {
  if (!state.slots.includes(id) || (state.loadedSlots || []).includes(id)) return state;
  return { ...state, loadedSlots: [...(state.loadedSlots || []), id] };
}

/** Accept notification data only; the website cannot choose another account's id. */
function webAlert(space, payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.title !== 'string' || typeof payload.tag !== 'string') return null;
  return {
    spaceId: space.id,
    tag: `web:${payload.tag}`.slice(0, 220),
    kind: 'web',
    title: `${space.label}${payload.title ? ` · ${payload.title}` : ''}`.slice(0, 160),
    body: typeof payload.body === 'string' ? payload.body.slice(0, 400) : 'New alert from this page.',
  };
}

/** Reads a stored file back, repairing anything a hand edit or an older version could break. */
function normalize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  // A file written before 0.1.3 carries version 1 and the phone layout it defaulted to for every
  // space. Social spaces are moved to the desktop site once here: their mobile pages have no messages
  // UI at all (see [defaultPhoneLayout]), so a stored `true` for one is that old default, not a choice.
  // From version 2 on, the stored value is whatever the user or the picker chose.
  const version = Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1;
  const seen = new Set();
  const spaces = [];
  for (const entry of Array.isArray(raw.spaces) ? raw.spaces : []) {
    const id = typeof entry === 'string' ? entry : entry && entry.id;
    if (ordinalForName(id) === null || seen.has(id)) continue;
    seen.add(id);
    const app = appOrDefault(entry && entry.appId);
    const kind = KINDS.includes(entry && entry.kind) ? entry.kind : app.kind;
    // An entry that never recorded a layout — a file from before the field, or a hand edit — follows its
    // kind's default instead of guessing.
    const storedLayout = !entry || entry.phoneLayout === undefined || entry.phoneLayout === null
      ? defaultPhoneLayout(app, kind)
      : entry.phoneLayout !== false;
    spaces.push({
      id,
      label: String((entry && entry.label) || `Account ${id}`).trim().slice(0, 60) || `Account ${id}`,
      appId: app.id,
      kind,
      url: typeof (entry && entry.url) === 'string' ? String(entry.url).trim().slice(0, 500) : '',
      phoneLayout: version >= LAYOUT_VERSION ? storedLayout : (kind === 'social' ? false : storedLayout),
      watch: normalizeWatch(entry && entry.watch),
    });
  }
  for (const id of DEFAULT_SLOTS) {
    if (!seen.has(id)) {
      seen.add(id);
      spaces.push({ id, label: `Account ${id}`, appId: DEFAULT_APP_ID, kind: DEFAULT_KIND, url: '',
        phoneLayout: defaultPhoneLayout(appOrDefault(DEFAULT_APP_ID), DEFAULT_KIND), watch: watchDefaults() });
    }
  }
  const stored = Array.isArray(raw.slots) ? raw.slots : DEFAULT_SLOTS;
  const slots = [...new Set(stored.filter((id) => ordinalForName(id) !== null))].sort(compareNames);
  return {
    version: STATE_VERSION,
    spaces: spaces.sort((left, right) => compareNames(left.id, right.id)),
    slots: slots.length ? slots : [...DEFAULT_SLOTS],
    loadedSlots: [...new Set(Array.isArray(raw.loadedSlots) ? raw.loadedSlots : [])].filter((id) => slots.includes(id) && seen.has(id)),
    theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'system',
    // A file written before version 3 cannot tell "the user stopped the bubble" from "nobody ever
    // started one" — the old default was off, so every such file says false. The bubble is therefore
    // switched on once, and from version 3 on the stored value is the user's own choice.
    bubble: version >= STATE_VERSION ? raw.bubble !== false : true,
    startAtLogin: raw.startAtLogin !== false,
    keepPagesAlive: raw.keepPagesAlive !== false,
    bubblePrefs: normalizeBubblePrefs(raw.bubblePrefs),
    watchWhileRunning: raw.watchWhileRunning !== false,
    messageSound: raw.messageSound !== false,
    monitorState: Object.fromEntries(slots.filter(id => seen.has(id)).map(id => {
      const unread = raw.monitorState && raw.monitorState[id] && raw.monitorState[id].unread;
      return [id, { unread: Number.isInteger(unread) && unread >= 0 && unread <= 99 ? unread : null }];
    })),
  };
}

/** One observed alert. Alerts are runtime-only, exactly like the Android build. */
function addAlert(alerts, alert, limit = 300) {
  const withoutDuplicate = alerts.filter((value) => !(value.spaceId === alert.spaceId && value.tag === alert.tag));
  return [alert, ...withoutDuplicate].slice(0, limit);
}

function pendingFor(alerts, id) {
  return alerts.filter((alert) => alert.spaceId === id && !alert.acknowledged).length;
}

module.exports = {
  MAX_ORDINAL,
  KINDS,
  APPS,
  DEFAULT_APP_ID,
  DEFAULT_KIND,
  DEFAULT_SLOTS,
  STATE_VERSION,
  LAYOUT_VERSION,
  DEFAULT_WATCH_MINUTES,
  MIN_WATCH_MINUTES,
  MAX_WATCH_MINUTES,
  DEFAULT_PHONE_LAYOUT,
  defaultPhoneLayout,
  userAgentFor,
  browserRefusal,
  MAX_PHRASE,
  BUBBLE_SIZES,
  DEFAULT_BUBBLE_SIZE,
  BUBBLE_MIN_OPACITY,
  BUBBLE_MAX_OPACITY,
  BUBBLE_DOUBLE_CLICK,
  AVATAR_MAX_LENGTH,
  normalizeAvatar,
  nameForOrdinal,
  ordinalForName,
  compareNames,
  appById,
  appOrDefault,
  hexColor,
  hostsFor,
  hostnameOf,
  hostAllowed,
  homeFor,
  pageAllowed,
  openTarget,
  watchDefaults,
  normalizeWatch,
  bubbleDefaults,
  normalizeBubblePrefs,
  nearestBubbleSize,
  setBubblePref,
  defaultState,
  accountFor,
  enabledSpaces,
  sortedSlots,
  nextFree,
  enableSlot,
  disableSlot,
  rename,
  selectApp,
  setUrl,
  setPhoneLayout,
  setWatch,
  normalize,
  addAlert,
  pendingFor,
  rememberLoaded,
  webAlert,
};
