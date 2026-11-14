import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
};

/**
 * A tiny static server for local development and the browser check. It resolves every request
 * inside `root` (no traversal), serves only GET/HEAD, and never caches.
 */
export function startServer({ root, port = 4173, host = '127.0.0.1' } = {}) {
  const base = path.resolve(root);
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch (error) {
      response.writeHead(400).end('Bad request');
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';

    const target = path.resolve(base, `.${pathname}`);
    if (target !== base && !target.startsWith(base + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const info = await stat(target);
      if (!info.isFile()) throw new Error('not a file');
      response.writeHead(200, {
        'content-type': TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const readFlag = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const dir = path.resolve(process.cwd(), readFlag('dir', 'dist'));
  const port = Number(readFlag('port', process.env.PORT ?? 4173));
  const server = await startServer({ root: dir, port });
  console.log(`Serving ${dir} on http://127.0.0.1:${port}/ (Ctrl+C to stop)`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
