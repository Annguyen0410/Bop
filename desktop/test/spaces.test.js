'use strict';

const test = require('node:test');
const assert = require('node:assert');
const spaces = require('../src/main/spaces.js');

test('space names round-trip through every ordinal a user could reach', () => {
  for (let ordinal = 0; ordinal < 10000; ordinal += 1) {
    const name = spaces.nameForOrdinal(ordinal);
    assert.strictEqual(spaces.ordinalForName(name), ordinal, `${ordinal} -> ${name}`);
  }
  assert.strictEqual(spaces.nameForOrdinal(0), 'A');
  assert.strictEqual(spaces.nameForOrdinal(25), 'Z');
  assert.strictEqual(spaces.nameForOrdinal(26), 'AA');
  assert.strictEqual(spaces.nameForOrdinal(51), 'AZ');
  assert.strictEqual(spaces.nameForOrdinal(52), 'BA');
});

test('a bad or hand-edited name is rejected rather than guessed', () => {
  for (const value of ['', 'a', 'AB-', 'ABC DEF', '1234', 'abcd', null, undefined, 42, 'A'.repeat(8)]) {
    assert.strictEqual(spaces.ordinalForName(value), null, String(value));
  }
  assert.strictEqual(spaces.nameForOrdinal(-1), null);
  assert.strictEqual(spaces.nameForOrdinal(1.5), null);
  assert.strictEqual(spaces.ordinalForName(spaces.nameForOrdinal(spaces.MAX_ORDINAL)), spaces.MAX_ORDINAL);
  assert.strictEqual(spaces.nameForOrdinal(spaces.MAX_ORDINAL + 1), null);
});

test('two hundred spaces get two hundred distinct names and nonzero-order sorting', () => {
  let state = spaces.defaultState();
  for (let index = 0; index < 200; index += 1) {
    state = spaces.enableSlot(state, spaces.nextFree(state));
  }
  assert.strictEqual(state.slots.length, 202);
  assert.strictEqual(new Set(state.slots).size, 202);
  const ordered = spaces.sortedSlots(state);
  assert.strictEqual(ordered[0], 'A');
  assert.strictEqual(ordered[ordered.length - 1], spaces.nameForOrdinal(201));
  assert.ok(ordered.indexOf('Z') < ordered.indexOf('AA'));
});

test('removing a space returns its letter to the pool instead of burning it', () => {
  let state = spaces.defaultState();
  state = spaces.enableSlot(state, 'C');
  assert.strictEqual(spaces.nextFree(state), 'D');
  state = spaces.disableSlot(state, 'C');
  assert.strictEqual(spaces.nextFree(state), 'C');
  // The base pair cannot be removed.
  assert.strictEqual(spaces.disableSlot(state, 'A'), state);
  assert.strictEqual(spaces.disableSlot(state, 'B'), state);
});

test('hiding a space keeps its label, app and watch settings for a later return', () => {
  let state = spaces.defaultState();
  state = spaces.enableSlot(state, 'C', { appId: 'prolific', kind: 'tasks' });
  state = spaces.rename(state, 'C', 'Studies');
  state = spaces.setWatch(state, 'C', { enabled: true, minutes: 5, selector: '.test-list' });
  state = spaces.disableSlot(state, 'C');
  assert.ok(!state.slots.includes('C'));
  const hidden = spaces.accountFor(state, 'C');
  assert.strictEqual(hidden.label, 'Studies');
  assert.strictEqual(hidden.appId, 'prolific');
  assert.strictEqual(hidden.kind, 'tasks');
  assert.strictEqual(hidden.watch.enabled, true);
  state = spaces.enableSlot(state, 'C');
  assert.strictEqual(spaces.accountFor(state, 'C').label, 'Studies');
  assert.strictEqual(spaces.accountFor(state, 'C').watch.minutes, 5);
});

test('changing the app moves the space between the two halves of the hub', () => {
  let state = spaces.defaultState();
  state = spaces.enableSlot(state, 'C', { appId: 'messenger', kind: 'social' });
  assert.strictEqual(spaces.accountFor(state, 'C').kind, 'social');
  state = spaces.selectApp(state, 'C', 'prolific');
  assert.strictEqual(spaces.accountFor(state, 'C').kind, 'tasks');
  state = spaces.selectApp(state, 'C', 'not-a-real-app');
  assert.strictEqual(spaces.accountFor(state, 'C').appId, 'prolific', 'an unknown id must not change anything');
  // A hidden space is not silently reconfigured.
  state = spaces.disableSlot(state, 'C');
  assert.strictEqual(spaces.selectApp(state, 'C', 'discord'), state);
});

test('a custom space only ever allows the host the user typed', () => {
  let state = spaces.defaultState();
  state = spaces.enableSlot(state, 'C', { appId: 'custom', kind: 'tasks' });
  state = spaces.setUrl(state, 'C', 'https://app.example.com/work/list');
  const space = spaces.accountFor(state, 'C');
  assert.deepStrictEqual(spaces.hostsFor(space), ['app.example.com']);
  assert.strictEqual(spaces.homeFor(space), 'https://app.example.com/work/list');
  assert.ok(spaces.pageAllowed(space, 'https://app.example.com/anything'));
  assert.ok(spaces.pageAllowed(space, 'https://jobs.app.example.com/x'));
  assert.ok(!spaces.pageAllowed(space, 'https://example.com.evil.test/'));
  assert.ok(!spaces.pageAllowed(space, 'https://other.com/'));
  assert.ok(!spaces.pageAllowed(space, 'http://app.example.com/'));
  // A custom space without a URL cannot open anything at all.
  assert.ok(!spaces.pageAllowed(spaces.accountFor(spaces.enableSlot(state, 'D', { appId: 'custom' }), 'D'), 'https://example.com/'));

  // Which is why Open has to ask for the address rather than pretend it opened something. On 0.1.4 a
  // space left in that state opened an empty pane that covered the hub and swallowed the clicks meant
  // for the dialog that would have fixed it, so the refusal carries a message the UI can show.
  const blankState = spaces.enableSlot(spaces.defaultState(), 'C', { appId: 'custom', kind: 'tasks' });
  const blank = spaces.accountFor(blankState, 'C');
  assert.deepStrictEqual(spaces.openTarget(blank), {
    url: '',
    error: 'This space has no address yet. Open Edit and paste the page it should show.',
  });
  assert.deepStrictEqual(spaces.openTarget(space), { url: 'https://app.example.com/work/list', error: null });
  const refused = spaces.openTarget(spaces.accountFor(spaces.setUrl(blankState, 'C', 'http://app.example.com/'), 'C'));
  assert.strictEqual(refused.url, '');
  assert.match(refused.error, /Only an https page/);
  const loopback = spaces.accountFor(spaces.setUrl(blankState, 'C', 'http://127.0.0.1:8790/panel'), 'C');
  assert.deepStrictEqual(spaces.openTarget(loopback), { url: 'http://127.0.0.1:8790/panel', error: null });
  assert.match(spaces.openTarget(null).error, /does not exist any more/);
  // A catalog space always has somewhere to go, so it never needs an address from the user.
  assert.strictEqual(spaces.openTarget(spaces.accountFor(spaces.defaultState(), 'A')).error, null);
});

test('catalog spaces allow their own domains and nothing else', () => {
  const messenger = spaces.accountFor(spaces.defaultState(), 'A');
  assert.ok(spaces.pageAllowed(messenger, 'https://www.messenger.com/'));
  assert.ok(spaces.pageAllowed(messenger, 'https://m.messenger.com/'));
  assert.ok(!spaces.pageAllowed(messenger, 'https://messenger.com.evil.test/'));
  assert.ok(!spaces.pageAllowed(messenger, 'http://www.messenger.com/'));
  const skype = spaces.enableSlot(spaces.defaultState(), 'C', { appId: 'skype' });
  assert.ok(spaces.pageAllowed(spaces.accountFor(skype, 'C'), 'https://login.live.com/'));
});

test('every catalog entry is a real https home with at least one host, and both kinds are populated', () => {
  for (const app of spaces.APPS) {
    assert.ok(app.id && app.label && app.login, app.id);
    assert.ok(spaces.KINDS.includes(app.kind), `${app.id} kind`);
    if (app.id === 'custom') {
      assert.strictEqual(app.home, '');
      assert.deepStrictEqual(app.hosts, []);
      continue;
    }
    assert.ok(app.home.startsWith('https://'), `${app.id} home must be https`);
    assert.ok(app.hosts.length > 0, `${app.id} needs hosts`);
    assert.ok(spaces.hostAllowed(app.hosts, spaces.hostnameOf(app.home)), `${app.id} home host must be allowed`);
  }
  assert.ok(spaces.APPS.filter((app) => app.kind === 'social').length >= 19);
  assert.ok(spaces.APPS.filter((app) => app.kind === 'tasks').length >= 13);
  assert.strictEqual(new Set(spaces.APPS.map((app) => app.id)).size, spaces.APPS.length);
  assert.ok(spaces.hexColor('usertesting').startsWith('#'));
  assert.strictEqual(spaces.hexColor('nope'), spaces.hexColor(spaces.DEFAULT_APP_ID));
});

test('a damaged settings file is repaired instead of losing every space', () => {
  const restored = spaces.normalize({
    spaces: [
      { id: 'A', label: 'Work', appId: 'prolific', kind: 'tasks', watch: { enabled: true, minutes: 9999 } },
      { id: 'A', label: 'duplicate', appId: 'discord' },
      { id: 'zz', label: 'lowercase', appId: 'discord' },
      { id: 'C', label: '', appId: 'nonsense' },
    ],
    slots: ['A', 'C', 'C', 'nope'],
    theme: 'neon',
    bubble: 'yes',
  });
  assert.deepStrictEqual(restored.spaces.map((space) => space.id), ['A', 'B', 'C']);
  assert.strictEqual(spaces.accountFor(restored, 'A').label, 'Work');
  assert.strictEqual(spaces.accountFor(restored, 'A').kind, 'tasks');
  assert.strictEqual(spaces.accountFor(restored, 'A').watch.minutes, spaces.MAX_WATCH_MINUTES);
  assert.strictEqual(spaces.accountFor(restored, 'B').appId, spaces.DEFAULT_APP_ID, 'a missing base slot is restored');
  assert.strictEqual(spaces.accountFor(restored, 'C').appId, spaces.DEFAULT_APP_ID, 'an unknown app falls back');
  assert.strictEqual(spaces.accountFor(restored, 'C').label, 'Account C');
  assert.deepStrictEqual(restored.slots, ['A', 'C']);
  assert.strictEqual(restored.theme, 'system');
  // This file has no version, so it predates the bubble default: the old default was off, which means it
  // cannot express "the user stopped the bubble", so the bubble is switched on once — and the damaged
  // string is still repaired into a boolean rather than passed through.
  assert.strictEqual(restored.bubble, true);
  assert.deepStrictEqual(spaces.normalize(null).slots, spaces.DEFAULT_SLOTS);
});

test('watch settings are clamped into a range a scheduler can actually use', () => {
  assert.strictEqual(spaces.normalizeWatch({ minutes: 0 }).minutes, spaces.MIN_WATCH_MINUTES);
  assert.strictEqual(spaces.normalizeWatch({ minutes: 'abc' }).minutes, spaces.DEFAULT_WATCH_MINUTES);
  assert.strictEqual(spaces.normalizeWatch({ minutes: 3.6 }).minutes, 4);
  assert.strictEqual(spaces.normalizeWatch({}).enabled, false);
  assert.strictEqual(spaces.normalizeWatch({ enabled: 'yes' }).enabled, false, 'only a real boolean enables watching');
  assert.strictEqual(spaces.normalizeWatch({ selector: '  .x  ' }).selector, '.x');
  assert.strictEqual(spaces.normalizeWatch({ failures: -5 }).failures, 0);
});

test('watch phrase filters are trimmed, capped, and default to off', () => {
  const defaults = spaces.watchDefaults();
  assert.strictEqual(defaults.require, '');
  assert.strictEqual(defaults.ignore, '');
  assert.deepStrictEqual(spaces.normalizeWatch({}), defaults);
  assert.strictEqual(spaces.normalizeWatch({ require: '  available  ' }).require, 'available');
  assert.strictEqual(spaces.normalizeWatch({ ignore: 42 }).ignore, '');
  assert.strictEqual(spaces.normalizeWatch({ require: 'x'.repeat(500) }).require.length, spaces.MAX_PHRASE);
});

test('bubble settings are clamped, snapped to an offered size, and round-trip through the file', () => {
  const base = spaces.bubbleDefaults();
  assert.deepStrictEqual(spaces.normalizeBubblePrefs(null), base);
  assert.strictEqual(spaces.normalizeBubblePrefs({ size: 900 }).size, spaces.BUBBLE_SIZES[spaces.BUBBLE_SIZES.length - 1]);
  assert.strictEqual(spaces.normalizeBubblePrefs({ size: 0 }).size, spaces.BUBBLE_SIZES[0]);
  assert.strictEqual(spaces.normalizeBubblePrefs({ size: 60 }).size, 56, 'a value between sizes picks the nearer one');
  assert.strictEqual(spaces.normalizeBubblePrefs({ opacity: 5 }).opacity, spaces.BUBBLE_MIN_OPACITY);
  assert.strictEqual(spaces.normalizeBubblePrefs({ opacity: 999 }).opacity, spaces.BUBBLE_MAX_OPACITY);
  assert.strictEqual(spaces.normalizeBubblePrefs({ opacity: 'abc' }).opacity, base.opacity);
  assert.strictEqual(spaces.normalizeBubblePrefs({ doubleClick: 'nope' }).doubleClick, 'menu');
  assert.strictEqual(spaces.normalizeBubblePrefs({ overFullscreen: false }).overFullscreen, false);
  assert.strictEqual(spaces.normalizeBubblePrefs({}).overFullscreen, true, 'showing over full-screen apps is the default');
  assert.strictEqual(spaces.normalizeBubblePrefs({ spotX: 4 }).spotX, 1);
  assert.strictEqual(spaces.normalizeBubblePrefs({ spotY: -2 }).spotY, 0);
  assert.strictEqual(spaces.normalizeBubblePrefs({ spotY: 'x' }).spotY, base.spotY);

  let state = spaces.defaultState();
  state = spaces.setBubblePref(state, { size: 48, spotX: 0.5 });
  assert.strictEqual(state.bubblePrefs.size, 48);
  assert.strictEqual(state.bubblePrefs.doubleClick, 'menu', 'a patch leaves the untouched fields alone');
  assert.strictEqual(state.bubblePrefs.opacity, 100);
  assert.strictEqual(spaces.setBubblePref(state, null), state, 'a nonsense patch changes nothing');

  const reloaded = spaces.normalize(JSON.parse(JSON.stringify(state)));
  assert.deepStrictEqual(reloaded.bubblePrefs, state.bubblePrefs);
  assert.strictEqual(spaces.normalize({}).bubblePrefs.size, spaces.DEFAULT_BUBBLE_SIZE);
  assert.ok(spaces.BUBBLE_SIZES.includes(spaces.DEFAULT_BUBBLE_SIZE));
  assert.deepStrictEqual(spaces.BUBBLE_DOUBLE_CLICK, ['menu', 'last-space', 'dashboard']);
});

test('a messaging space asks for the desktop site, a task panel for the layout that fits', () => {
  // Measured with the phone user agent this build used for every space: tiktok.com/messages is replaced
  // by the For You feed, web.whatsapp.com answers with its /mobile/ landing page, Snapchat serves a
  // mobile landing page and web.skype.com refuses the browser. None of those pages shows a chat or can
  // raise a message alert, so a social space starts on the desktop site, while a task panel keeps the
  // mobile layout that fits the narrow pane — the wide layout is where a panel's dialog ends up half
  // off the edge, close button included.
  assert.strictEqual(spaces.defaultPhoneLayout(spaces.appById('tiktok'), 'social'), false);
  assert.strictEqual(spaces.defaultPhoneLayout(spaces.appById('prolific'), 'tasks'), true);
  assert.strictEqual(spaces.DEFAULT_PHONE_LAYOUT, true, 'the phone layout is still the constant itself');
  assert.ok(spaces.defaultState().spaces.every((space) => space.phoneLayout === false));

  let state = spaces.defaultState();
  state = spaces.enableSlot(state, 'C', { appId: 'prolific', kind: 'tasks' });
  assert.strictEqual(spaces.accountFor(state, 'C').phoneLayout, true, 'a new task panel fits by default');
  state = spaces.enableSlot(state, 'D', { appId: 'telegram', kind: 'social' });
  assert.strictEqual(spaces.accountFor(state, 'D').phoneLayout, false, 'a new messaging space uses the desktop site');
  state = spaces.enableSlot(state, 'E', { appId: 'telegram', kind: 'social', phoneLayout: true });
  assert.strictEqual(spaces.accountFor(state, 'E').phoneLayout, true, 'and the phone layout can still be chosen');

  // Moving a space between the two halves of the hub moves its layout with it; choosing another app
  // inside the same half leaves the user's own choice alone.
  assert.strictEqual(spaces.accountFor(spaces.selectApp(state, 'D', 'prolific'), 'D').phoneLayout, true);
  const sameHalf = spaces.selectApp(spaces.selectApp(state, 'D', 'prolific'), 'D', 'usertesting');
  assert.strictEqual(spaces.accountFor(sameHalf, 'D').phoneLayout, true);

  const chosen = spaces.setPhoneLayout(state, 'C', false);
  assert.strictEqual(spaces.accountFor(chosen, 'C').phoneLayout, false);
  assert.strictEqual(spaces.accountFor(spaces.setPhoneLayout(chosen, 'B', 'yes'), 'B').phoneLayout, false,
    'only the real boolean true switches it on');

  // A file from 0.1.2 recorded version 1, where every space was written with the phone layout default,
  // so a social space reading true there is that default rather than a choice: it is moved once on read.
  const old = spaces.normalize({
    version: 1,
    spaces: [
      { id: 'C', appId: 'tiktok', kind: 'social', phoneLayout: true },
      { id: 'D', appId: 'prolific', kind: 'tasks', phoneLayout: true },
      { id: 'E', appId: 'telegram', kind: 'social', phoneLayout: false },
    ],
  });
  assert.strictEqual(spaces.accountFor(old, 'C').phoneLayout, false, 'the old default does not survive');
  assert.strictEqual(spaces.accountFor(old, 'D').phoneLayout, true, 'a task panel keeps its layout');
  assert.strictEqual(spaces.accountFor(old, 'E').phoneLayout, false);
  assert.strictEqual(old.version, spaces.STATE_VERSION);

  // From the current version on, the stored value is what the user chose, in both directions.
  const current = spaces.normalize({ version: spaces.STATE_VERSION,
    spaces: [{ id: 'C', appId: 'tiktok', kind: 'social', phoneLayout: true }] });
  assert.strictEqual(spaces.accountFor(current, 'C').phoneLayout, true);

  // An entry without the field at all follows its kind instead of guessing.
  const padded = spaces.normalize({ version: spaces.STATE_VERSION, spaces: [
    { id: 'C', appId: 'tiktok', kind: 'social' }, { id: 'D', appId: 'prolific', kind: 'tasks' }] });
  assert.strictEqual(spaces.accountFor(padded, 'C').phoneLayout, false);
  assert.strictEqual(spaces.accountFor(padded, 'D').phoneLayout, true);

  // Hiding a space keeps its choice but must not silently reconfigure it.
  const hidden = spaces.disableSlot(state, 'C');
  assert.strictEqual(spaces.setPhoneLayout(hidden, 'C', true), hidden);
  assert.strictEqual(spaces.accountFor(hidden, 'C').phoneLayout, true);
});

test('only explicitly opened enabled spaces are restored after relaunch', () => {
  let state = spaces.defaultState();
  assert.deepStrictEqual(state.loadedSlots, []);
  state = spaces.rememberLoaded(state, 'B');
  state = spaces.rememberLoaded(state, 'B');
  state = spaces.rememberLoaded(state, 'ZZ');
  assert.deepStrictEqual(state.loadedSlots, ['B']);
  state = spaces.enableSlot(state, 'C');
  state = spaces.rememberLoaded(state, 'C');
  state = spaces.disableSlot(state, 'C');
  assert.deepStrictEqual(state.loadedSlots, ['B']);
  const restored = spaces.normalize({ ...state, loadedSlots: ['B', 'B', 'C', null, 'ZZ'] });
  assert.deepStrictEqual(restored.loadedSlots, ['B']);
  assert.deepStrictEqual(spaces.normalize({}).loadedSlots, []);
});

test('remote notification payload cannot choose the owning space or crash alert formatting', () => {
  const b = spaces.accountFor(spaces.defaultState(), 'B');
  for (const payload of [null, undefined, 3, {}, { title: {} }, { title: 'Chat', tag: {} }]) {
    assert.strictEqual(spaces.webAlert(b, payload), null);
  }
  const alert = spaces.webAlert(b, { spaceId: 'A', title: 'Chat', tag: 'same', body: 'Hi' });
  assert.strictEqual(alert.spaceId, 'B');
  assert.strictEqual(alert.title, 'Account B · Chat');
  assert.strictEqual(alert.tag, 'web:same');
});

test('a fresh profile is already a monitor: bubble on, starts with the machine, keeps its pages alive', () => {
  const fresh = spaces.defaultState();
  assert.strictEqual(fresh.bubble, true);
  assert.strictEqual(fresh.startAtLogin, true);
  assert.strictEqual(fresh.keepPagesAlive, true);
  assert.strictEqual(spaces.normalize({ version: spaces.STATE_VERSION }).bubble, true, 'a file with no bubble field starts one');
  assert.strictEqual(spaces.normalize({ version: spaces.STATE_VERSION }).startAtLogin, true);

  // From version 3 on the stored value is the user's own choice, in both directions.
  const off = spaces.normalize({ version: spaces.STATE_VERSION, bubble: false, startAtLogin: false, keepPagesAlive: false });
  assert.strictEqual(off.bubble, false);
  assert.strictEqual(off.startAtLogin, false);
  assert.strictEqual(off.keepPagesAlive, false);

  // A file written before version 3 says `bubble: false` whether the user stopped the bubble or never
  // started one — the old default was off — so the bubble is switched on exactly once.
  assert.strictEqual(spaces.normalize({ version: 2, bubble: false }).bubble, true);
  assert.strictEqual(spaces.normalize({ version: 2, bubble: true }).bubble, true);
  assert.strictEqual(spaces.normalize({ version: spaces.LAYOUT_VERSION, bubble: false }).bubble, true);
});

test('alerts group by space and a repeated tag replaces its older card', () => {
  let alerts = [];
  alerts = spaces.addAlert(alerts, { spaceId: 'C', tag: 'list', title: 'New study', at: 1 });
  alerts = spaces.addAlert(alerts, { spaceId: 'C', tag: 'list', title: 'New study', at: 2 });
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].at, 2);
  alerts = spaces.addAlert(alerts, { spaceId: 'D', tag: 'list', title: 'Other', at: 3 });
  assert.strictEqual(alerts.length, 2);
  assert.strictEqual(spaces.pendingFor(alerts, 'C'), 1);
  alerts = alerts.map((alert) => (alert.spaceId === 'C' ? { ...alert, acknowledged: true } : alert));
  assert.strictEqual(spaces.pendingFor(alerts, 'C'), 0);
  assert.strictEqual(spaces.pendingFor(alerts, 'D'), 1);
});

test('a space is never served with an agent that names the app itself', () => {
  // Measured on 0.1.5: app.usercrowd.com answered `unsupported_browser` — "Sorry, you can't use
  // UserCrowd on this version of Electron" — for the agent this app used to hand every space, and its
  // sign-in page for the same engine asked as Chrome. The Electron token is the whole difference.
  const chrome = '140.0.7339.80';
  const desktop = spaces.userAgentFor({ phoneLayout: false }, { chrome, platform: 'win32' });
  assert.ok(desktop.startsWith('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), desktop);
  assert.ok(desktop.includes(`Chrome/${chrome}`), desktop);
  assert.ok(!/Mobile/.test(desktop));
  assert.ok(spaces.userAgentFor({ phoneLayout: false }, { chrome, platform: 'darwin' }).includes('Macintosh'));
  assert.ok(spaces.userAgentFor({ phoneLayout: false }, { chrome, platform: 'linux' }).includes('X11; Linux x86_64'));
  const phone = spaces.userAgentFor({ phoneLayout: true }, { chrome, platform: 'win32' });
  assert.ok(/Android 14/.test(phone) && /Mobile/.test(phone), phone);
  assert.ok(phone.includes(`Chrome/${chrome}`), phone);
  for (const agent of [phone, desktop]) assert.ok(!/electron|bop/i.test(agent), agent);
  // No space at all still resolves to the layout that fits, never to undefined.
  assert.strictEqual(spaces.userAgentFor(null, { chrome, platform: 'win32' }), phone);
});

test('a page that refused the browser is recognised, and an ordinary page is not', () => {
  assert.ok(spaces.browserRefusal('https://app.usercrowd.com/unsupported_browser', 'UserCrowd'));
  assert.ok(spaces.browserRefusal('https://panel.test/unsupported-browser', ''));
  assert.ok(spaces.browserRefusal('https://panel.test/', "Sorry, you can't use UserCrowd on this version of Electron"));
  assert.ok(spaces.browserRefusal('https://panel.test/', 'Please update your browser'));
  assert.ok(!spaces.browserRefusal('https://www.messenger.com/', 'Messenger'));
  assert.ok(!spaces.browserRefusal('https://panel.test/', 'Supported browsers and their features — docs'));
  assert.ok(!spaces.browserRefusal('https://panel.test/browsers', 'Browsers we test with'));
  assert.ok(!spaces.browserRefusal('', ''));
});
