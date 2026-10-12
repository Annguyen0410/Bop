'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

// AUTOMATED LOCAL FIXTURE. This is not proof of Messenger/WhatsApp/etc delivery or audible OS sound.
module.exports = async function monitorSmoke(api) {
  const { app, shellWindow, uiView, spaceViews, monitors, retryTimers, SMOKE_OUT } = api;
  const streams = new Map();
  const counts = new Map([['A', 5], ['B', 5], ['C', 5]]);
  let requests = 0;
  const steps = [];
  const report = { kind: 'local SSE integration fixture (not live-service messaging)', ok: false, steps };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, label, timeout = 8000) => {
    process.stdout.write(`CHECK ${label}\n`);
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
      await wait(25);
    }
  };
  const sample = () => {
    const metrics = app.getAppMetrics();
    return { processes: metrics.length,
      workingSetMiB: +(metrics.reduce((sum, value) => sum + value.memory.workingSetSize, 0) / 1024).toFixed(2),
      cpuPercent: +metrics.reduce((sum, value) => sum + value.cpu.percentCPUUsage, 0).toFixed(3),
      views: spaceViews.size, monitors: monitors.size, retries: retryTimers.size, requests };
  };
  const server = http.createServer((request, response) => {
    requests += 1;
    const id = /fixture-account=([ABC])/.exec(request.headers.cookie || '')?.[1] || 'unknown';
    if (request.url === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      response.write(`data: ${JSON.stringify({ unread: counts.get(id) || 0 })}\n\n`);
      streams.set(id, response);
      request.on('close', () => { if (streams.get(id) === response) streams.delete(id); });
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><title>(5) Local chat</title><body>Local SSE account ${id}
      <script>
      window.events = new EventSource('/events');
      window.events.onmessage = event => {
        const reading = JSON.parse(event.data);
        document.title = '(' + reading.unread + ') Local chat';
        if (reading.eventId && window.mirrorFixtureNotification) {
          new Notification('Local chat', {tag: 'thread', body: reading.eventId});
        }
      };
      </script></body>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (id, eventId) => {
    const unread = counts.get(id) + 1;
    counts.set(id, unread);
    assert.ok(streams.has(id), `${id} has a live fixture stream`);
    streams.get(id).write(`data: ${JSON.stringify({ unread, eventId })}\n\n`);
  };
  try {
    await until(() => !uiView.webContents.isLoading(), 'dashboard ready');
    for (const id of ['A', 'B', 'C']) {
      api.configure(id, `${origin}/chat`);
      // Set up a session-bound fixture identity, never copy cookies from real user profiles.
      process.stdout.write(`LOAD ${id}\n`);
      api.loadSpaceInBackground(id);
      const view = spaceViews.get(id);
      await view.webContents.session.cookies.set({ url: origin, name: 'fixture-account', value: id });
      await Promise.race([view.webContents.loadURL(`${origin}/chat`), wait(10_000).then(() => { throw new Error(`load ${id} timeout`); })]);
    }
    await until(() => ['A', 'B', 'C'].every(id => streams.has(id) && monitors.get(id)?.unread === 5), 'three baselines');
    assert.equal(api.notificationAttempts(), 0, 'historical unread must not notify');
    for (const id of ['A', 'B', 'C']) {
      const cookies = await spaceViews.get(id).webContents.session.cookies.get({ name: 'fixture-account' });
      assert.deepEqual(cookies.map(cookie => cookie.value), [id]);
    }
    const clicked = await uiView.webContents.executeJavaScript(`(() => { const button = document.querySelector('[data-open="A"]'); if (!button) return false; button.click(); return true; })()`);
    assert.ok(clicked);
    await until(() => api.snapshot().enabled.find(space => space.id === 'A')?.open, 'A selected through UI');
    // Deny website notifications. The independent native title source still has to work.
    for (const id of ['A', 'B', 'C']) {
      spaceViews.get(id).webContents.session.setPermissionCheckHandler(() => false);
      spaceViews.get(id).webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    }
    send('B', 'b-1');
    await until(() => monitors.get('B').unread === 6 && api.notificationAttempts() === 1, 'nonselected B without website notification');
    send('C', 'c-1');
    await until(() => monitors.get('C').unread === 6 && api.notificationAttempts() === 2, 'nonselected C');
    assert.equal(api.snapshot().enabled.find(space => space.id === 'A').open, true);
    steps.push({ name: 'three-isolated-same-origin-sessions; B/C detect while A selected; source notifications denied', passed: true });

    shellWindow.show(); shellWindow.minimize();
    send('B', 'b-2');
    await until(() => api.notificationAttempts() === 3, 'minimized');
    shellWindow.restore(); shellWindow.close();
    assert.equal(shellWindow.isVisible(), false, 'close-to-tray preserves session views');
    send('C', 'c-2');
    await until(() => api.notificationAttempts() === 4, 'hidden');
    steps.push({ name: 'minimized and closed-to-tray continue receiving fixture stream events', passed: true });

    // Repeated state event, no new message: route through the same network path, not a mock monitor.
    streams.get('C').write(`data: ${JSON.stringify({ unread: counts.get('C') })}\n\n`);
    await wait(150);
    assert.equal(api.notificationAttempts(), 4);
    const b = spaceViews.get('B');
    b.webContents.session.setPermissionCheckHandler(() => true);
    b.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(true));
    await b.webContents.executeJavaScript('window.mirrorFixtureNotification = true');
    send('B', 'b-3');
    await until(() => api.notificationAttempts() === 5, 'paired title and Notification');
    await wait(150);
    assert.equal(api.notificationAttempts(), 5);
    send('B', 'b-4');
    send('C', 'c-3');
    await until(() => api.notificationAttempts() === 7, 'distinct consecutive accounts');
    steps.push({ name: 'unchanged state is quiet; title plus website signal requests one OS notice; consecutive accounts request separate notices', passed: true,
      limitation: 'OS audible playback is not asserted; title changes expose no original message IDs' });

    const a = spaceViews.get('A');
    await a.webContents.loadURL(`${origin}/login`);
    await until(() => monitors.get('A').status === 'reauthentication-required', 'login route status hint');
    send('C', 'c-4');
    await until(() => api.notificationAttempts() === 8, 'peer account survives login failure');
    await a.webContents.loadURL(`${origin}/chat`);
    await until(() => monitors.get('A').status === 'observing-auth-unknown', 'login resumed');
    steps.push({ name: 'login-path hint and account independence', passed: true, limitation: 'not an actual provider token expiration' });

    // Renderer crash exercises the real lifecycle callback and the production 30-second first retry.
    b.webContents.forcefullyCrashRenderer();
    await until(() => monitors.get('B').status === 'temporarily-unavailable' && retryTimers.has('B'), 'crash backoff');
    counts.set('B', counts.get('B') + 1); // Authoritative fixture state changed while renderer was down.
    await until(() => monitors.get('B').status === 'observing-auth-unknown' && monitors.get('B').unread === counts.get('B'), 'renderer recovery and unread delta', 45_000);
    assert.equal(api.notificationAttempts(), 9);
    steps.push({ name: 'renderer crash retries with real backoff, preserves profile and reconciles exposed unread delta', passed: true });

    // Offline network on C: live EventSource cannot receive, but remains a single site-owned connection.
    const c = spaceViews.get('C');
    await c.webContents.session.enableNetworkEmulation({ offline: true });
    for (const response of streams.values()) response.destroy();
    await wait(300);
    counts.set('C', counts.get('C') + 1);
    await c.webContents.session.enableNetworkEmulation({ offline: false });
    await until(() => monitors.get('C').unread === counts.get('C'), 'site EventSource reconnect', 12_000);
    await until(() => api.notificationAttempts() === 10, 'post-network unread delta');
    steps.push({ name: 'fixture site reconnects its own EventSource and exposes missed unread after network restore', passed: true,
      limitation: 'no provider sync API/cursor; same-count or read messages are not recoverable' });

    api.mute(true);
    send('C', 'muted-message');
    await until(() => api.notificationAttempts() === 11, 'Bop mute keeps monitoring but requests silent OS notice');
    assert.equal(api.notificationDiagnostics().lastSilent, true);
    api.mute(false);
    steps.push({ name: 'Bop sound mute leaves detection operational and requests silent OS notification', passed: true });

    api.saveSettings();
    const restored = api.loadSettings();
    assert.deepEqual(restored.loadedSlots.sort(), ['A', 'B', 'C']);
    assert.equal(restored.monitorState.C.unread, counts.get('C'));
    steps.push({ name: 'real encrypted settings restore loaded ids/unread metadata', passed: true,
      limitation: 'settings roundtrip, not a full process-restart/live login test' });

    await wait(1200);
    sample();
    const beforeRequests = requests;
    await wait(4000);
    report.idle = sample();
    report.idle.requestsDuringWindow = requests - beforeRequests;
    sample();
    for (let i = 0; i < 6; i++) { send(i % 2 ? 'B' : 'C', `active-${i}`); await wait(1200); }
    report.active = sample();
    for (const id of ['A', 'B', 'C']) {
      await uiView.webContents.executeJavaScript(`window.bop.stopSpace(${JSON.stringify(id)})`);
    }
    await until(() => spaceViews.size === 0 && monitors.size === 0 && retryTimers.size === 0 && streams.size === 0, 'stop releases all views/streams');
    assert.deepEqual(api.loadSettings().loadedSlots, []);
    sample(); await wait(3000);
    report.stopped = sample();
    steps.push({ name: 'stop-monitoring via actual IPC closes all views/listeners/streams and cancels retries', passed: true });
    shellWindow.show();
    fs.writeFileSync(path.join(SMOKE_OUT, 'monitor-dashboard.png'), (await uiView.webContents.capturePage()).toPNG());
    report.notificationAttempts = api.notificationAttempts();
    report.osNotificationDiagnostics = api.notificationDiagnostics();
    report.audibleSoundVerified = false;
    report.ok = true;
  } catch (failure) {
    report.error = String(failure.stack || failure);
    process.stdout.write(`MONITOR FAILED ${report.error}\n`);
    throw failure;
  } finally {
    fs.writeFileSync(path.join(SMOKE_OUT, 'monitor-smoke.json'), JSON.stringify(report, null, 2));
    for (const response of streams.values()) response.destroy();
    server.closeAllConnections();
    server.close();
  }
};
