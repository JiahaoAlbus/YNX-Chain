import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const catalog = fileURLToPath(new URL('../video/i18n/catalog.json', import.meta.url));
const walletCallback = fileURLToPath(new URL('./wallet-callback.html', import.meta.url));
const walletAuth = fileURLToPath(new URL('./wallet-auth.js', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  const path = pathname === '/' ? 'index.html' : pathname.slice(1);

  if (path.includes('..')) {
    res.writeHead(400).end();
    return;
  }

  try {
    let data;
    if (path === 'video/studio/wallet-auth/callback' || path === 'wallet-callback.html') {
      data = await readFile(walletCallback);
    } else {
      const shared =
        path === 'i18n/catalog.json'
          ? catalog
          : path === 'wallet-auth.js'
            ? walletAuth
            : null;
      data = await readFile(shared || join(root, path));
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
