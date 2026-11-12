'use strict';

/*
 * Dev-only: the same three fixture pages the acceptance run serves, kept up after the run so a kept-alive
 * instance can be measured with every page loaded. Not part of the app or the test suite.
 *
 *   node tools/fixture-server.js [port]
 */

const http = require('node:http');

const port = Number(process.argv[2] || 8791);
const board = '<!doctype html><html><head><meta charset="utf-8"/><title>Live board</title></head><body><h1>Studies</h1><div id="list">2 studies available</div></body></html>';
const chat = '<!doctype html><html><head><meta charset="utf-8"/><title>Live chat</title></head><body><h1>Live chat</h1><p>Fixture for title and notification events.</p></body></html>';

http.createServer((request, response) => {
  const page = request.url.startsWith('/board') ? board : request.url.startsWith('/chat') ? chat : null;
  if (!page) { response.writeHead(404); response.end('not found'); return; }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
}).listen(port, '127.0.0.1', () => process.stdout.write(`fixtures on http://127.0.0.1:${port}\n`));
