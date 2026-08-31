import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const bundledCatalog = fileURLToPath(new URL('./i18n/catalog.json', import.meta.url));
const developmentCatalog = fileURLToPath(new URL('../video/i18n/catalog.json', import.meta.url));
const walletCallback = fileURLToPath(new URL('./wallet-callback.html', import.meta.url));
const walletAuth = fileURLToPath(new URL('./wallet-auth.js', import.meta.url));
const studioPrefix = 'video/studio/';
const approvedCatalogRef = '7a89550d4964ea38b854cbd03f18775494c2f513:apps/video/i18n/catalog.json';
const run = promisify(execFile);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function readCatalog() {
  try {
    return await readFile(bundledCatalog);
  } catch {
    try {
      return await readFile(developmentCatalog);
    } catch {
      // The source server deliberately reads only the build-pinned catalog; release
      // artifacts always carry the same file beside this server.
      return (await run('git', ['show', approvedCatalogRef], { cwd: root })).stdout;
    }
  }
}

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  const requestedPath = pathname.replace(/^\/+/, '');
  const path = requestedPath === '' || requestedPath === 'video/studio' || requestedPath === studioPrefix
    ? 'index.html'
    : requestedPath.startsWith(studioPrefix)
      ? requestedPath.slice(studioPrefix.length)
      : requestedPath;

  if (path.includes('..')) {
    res.writeHead(400).end();
    return;
  }

  try {
    let data;
    if (path === 'wallet-auth/callback' || path === 'wallet-callback.html') {
      data = await readFile(walletCallback);
    } else {
      if (path === 'i18n/catalog.json') {
        data = await readCatalog();
      } else {
        const shared = path === 'wallet-auth.js' ? walletAuth : null;
        data = await readFile(shared || join(root, path));
      }
    }

    res.writeHead(200, {
      'Content-Type': types[extname(path)] || 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self' http://127.0.0.1:8423; style-src 'self'; script-src 'self'",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(Number(process.env.PORT || 4174), '127.0.0.1', () => {
  console.log('Creator Studio ready');
});
