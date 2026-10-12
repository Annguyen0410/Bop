'use strict';

/*
 * Dev-only fixture: a tiny "task panel" page that reports whether a real click reached it. Used while
 * reproducing input problems by hand; the shipped smoke/live checks keep their own fixtures.
 *
 *   node tools/panel-fixture.js [port]
 */

const http = require('node:http');

const port = Number(process.argv[2] || 8790);

const page = `<!doctype html><html><head><meta charset="utf-8" /><title>Panel fixture</title>
<style>body{font:16px sans-serif;margin:0}button{display:block;width:100%;height:120px;font-size:20px}
#log{white-space:pre-wrap;padding:12px}</style></head>
<body>
<h1 id="title">Panel fixture</h1>
<button id="big">Click me</button>
<div id="log">clicks: 0</div>
<script>
  window.clicks = 0;
  window.keys = 0;
  document.addEventListener('click', (event) => {
    window.clicks += 1;
    document.getElementById('log').textContent = 'clicks: ' + window.clicks + ' on ' + (event.target.id || event.target.tagName);
  });
  document.addEventListener('keydown', () => { window.keys += 1; });
</script>
</body></html>`;

http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
}).listen(port, '127.0.0.1', () => process.stdout.write(`panel fixture on http://127.0.0.1:${port}/\n`));
