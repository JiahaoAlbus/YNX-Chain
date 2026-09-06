import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const bundledCatalog = fileURLToPath(new URL('./i18n/catalog.json', import.meta.url));
const developmentCatalog = fileURLToPath(new URL('../video/i18n/catalog.json', import.meta.url));
const walletCallback = fileURLToPath(new URL('./wallet-callback.html', import.meta.url));
const walletAuth = fileURLToPath(new URL('./wallet-auth.js', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const apiOrigin = new URL(process.env.YNX_VIDEO_API_ORIGIN || 'http://127.0.0.1:8423');
if (apiOrigin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(apiOrigin.hostname) ||
    apiOrigin.username || apiOrigin.password || apiOrigin.pathname !== '/' || apiOrigin.search || apiOrigin.hash) {
  throw new Error('YNX_VIDEO_API_ORIGIN must be a loopback HTTP origin');
}
function proxyHeaders(headers) {
  const omit = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);
  for (const name of String(headers.connection || '').split(',')) omit.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !omit.has(name.toLowerCase())));
}
function proxyAPI(req, res, url) {
  const target = new URL(apiOrigin);
  target.pathname = url.pathname.slice('/video/api'.length);
  target.search = url.search;
  const outgoing = request(target, {method: req.method, headers: proxyHeaders(req.headers)}, incoming => {
    res.writeHead(incoming.statusCode, proxyHeaders(incoming.headers));
    incoming.on('error', () => res.destroy());
    incoming.pipe(res);
  });
  outgoing.setTimeout(target.pathname === '/v1/uploads' ? 300000 : 15000, () => outgoing.destroy(new Error('API timeout')));
  outgoing.on('error', () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(503, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify({error: 'VIDEO_API_UNAVAILABLE'}));
  });
  req.on('aborted', () => outgoing.destroy());
  res.on('close', () => { if (!res.writableEnded) outgoing.destroy(); });
  req.pipe(outgoing);
}

createServer(async (req, res) => {
  let url, pathname;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Invalid request path');
    return;
  }
  if (url.pathname.startsWith('/video/api/')) {
    proxyAPI(req, res, url);
    return;
  }
  if (pathname === '/video/studio') {
    res.writeHead(308, {Location: `/video/studio/${url.search}`}).end();
    return;
  }
  if (pathname.startsWith('/video/studio/')) pathname = pathname.slice(13);
  const path = pathname === '/' ? 'index.html' : pathname.slice(1);

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
        data = await readFile(bundledCatalog).catch(() => readFile(developmentCatalog));
      } else {
        const shared = path === 'wallet-auth.js' ? walletAuth : null;
        data = await readFile(shared || join(root, path));
      }
    }

    res.writeHead(200, {
      'Content-Type': types[extname(path)] || 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self' https://wallet-auth.ynxweb4.com; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(Number(process.env.PORT || 4174), '127.0.0.1', () => {
  console.log('Creator Studio ready');
});
