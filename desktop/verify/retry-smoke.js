'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

/**
 * Waits out the *real* retry ladder.
 *
 * The monitor integration harness proves the state machine, but it cannot afford to sit through
 * 30 + 60 + 120 + 240 + 480 seconds of production backoff, so "the sixth failure finally tells the user"
 * was only ever unit-tested. This run points one space at a port nothing listens on, records every status
 * transition with its own timestamp, and then loads a working page to prove the card clears. It takes
 * about sixteen minutes and it is the only end-to-end evidence for that promise.
 *
 * This is a local connection refusal, not a provider outage. Nothing here proves what Messenger does.
 */
module.exports = async function retrySmoke(api) {
  const { monitors, retryTimers, spaceViews, SMOKE_OUT } = api;
  const startedAt = Date.now();
  const steps = [];
  const observations = [];
  const report = { kind: 'real navigation failure through the production retry ladder', ok: false, steps, observations };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const elapsed = () => Date.now() - startedAt;
  const record = (note) => observations.push({
    atMs: elapsed(), status: monitors.get('A')?.status ?? 'none', failures: monitors.get('A')?.failures ?? null,
    retryPending: retryTimers.has('A'), ...note,
  });
  const healthCard = () => api.snapshot().alerts.find((alert) => alert.spaceId === 'A' && alert.tag === 'health');

  let working = null;
  try {
    // A working page for the recovery half: proves the card clears on a successful load, not by itself.
    working = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><title>Recovered</title><body>Recovered</body>');
    });
    await new Promise((resolve) => working.listen(0, '127.0.0.1', resolve));
    const recovered = `http://127.0.0.1:${working.address().port}/chat`;

    // Port 1 on loopback: connection refused immediately, so every retry is a real failed navigation.
    api.configure('A', 'http://127.0.0.1:1/chat');
    api.loadSpaceInBackground('A');
    steps.push({ name: 'space A loads a URL nothing listens on', passed: true, atMs: elapsed() });

    let lastStatus = null;
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      const monitor = monitors.get('A');
      if (!monitor) throw new Error('space A has no monitor');
      if (monitor.status !== lastStatus) {
        lastStatus = monitor.status;
        record();
        process.stdout.write(`RETRY STATUS ${monitor.status} failures=${monitor.failures} at ${Math.round(elapsed() / 1000)}s\n`);
      }
      if (monitor.status === 'monitoring-stopped') break;
      await wait(250);
    }

    const monitor = monitors.get('A');
    assert.equal(monitor.status, 'monitoring-stopped', `expected the ladder to stop monitoring, saw ${monitor.status}`);
    assert.equal(retryTimers.has('A'), false, 'no retry may be scheduled once the budget is spent');
    const card = healthCard();
    assert.ok(card, 'the exhausted ladder must leave one user-visible card');
    // Snapshot alerts carry `title` and `body`; the dashboard renders both.
    assert.match(`${card.title || ''} ${card.body || ''}`, /stopped/i, 'the card has to say monitoring stopped');
    assert.equal(api.snapshot().enabled.find((space) => space.id === 'A')?.monitoringStopped, true,
      'the dashboard must show the space as stopped');
    assert.ok(api.notificationAttempts() >= 1, 'the card must also reach the operating system');
    report.exhaustedAtMs = elapsed();
    report.failures = monitor.failures;
    report.alertTitle = card.title;
    report.alertBody = card.body;
    report.notificationAttempts = api.notificationAttempts();
    steps.push({ name: 'the sixth failure stops monitoring, raises one card and requests one OS notification', passed: true,
      limitation: 'a refused local connection, not a provider outage' });

    // Recovery: a page that loads clears the card silently.
    const before = api.notificationAttempts();
    await spaceViews.get('A').webContents.loadURL(recovered);
    const until = Date.now() + 15_000;
    while (Date.now() < until && monitors.get('A')?.status === 'monitoring-stopped') await wait(100);
    assert.notEqual(monitors.get('A')?.status, 'monitoring-stopped', 'a working load must end the stopped state');
    const clearedUntil = Date.now() + 8_000;
    while (Date.now() < clearedUntil && healthCard()) await wait(100);
    assert.equal(healthCard(), undefined, 'the card has to clear once the space works again');
    assert.equal(api.notificationAttempts(), before, 'recovery is silent');
    record({ note: 'recovered' });
    steps.push({ name: 'a working load restores monitoring and clears the card without a new notification', passed: true });
    report.ok = true;
  } catch (failure) {
    report.error = String((failure && failure.stack) || failure);
    process.stdout.write(`RETRY FAILED ${report.error}\n`);
    throw failure;
  } finally {
    fs.writeFileSync(path.join(SMOKE_OUT, 'retry-smoke.json'), JSON.stringify(report, null, 2));
    if (working) { working.closeAllConnections(); working.close(); }
  }
};
