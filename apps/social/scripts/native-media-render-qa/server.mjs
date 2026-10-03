import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url));
const social = resolve(here, '../..');
const stage = (await readFile('/tmp/social-native-media-render-stage-20261003.txt', 'utf8')).trim();
const require = createRequire(resolve(social, 'package.json'));
const { build } = require('esbuild');
const output = await mkdtemp(resolve(tmpdir(), 'social-media-render-bundle-'));
await build({ entryPoints: [resolve(here, 'main.jsx')], outfile: resolve(output, 'main.js'),
  bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  alias: { 'react-native': resolve(stage, 'node_modules/react-native-web/dist/index.js'),
    react: resolve(stage, 'node_modules/react'), 'react-dom': resolve(stage, 'node_modules/react-dom') } });
const html = Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YNX Social real component public-fixture QA</title><div id="root"></div><script src="/main.js"></script></html>');
const bundle = await readFile(resolve(output, 'main.js'));
const logo = await readFile(resolve(social, 'assets/ynx-original-logo.png'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = {};
for (const path of ['src/NativeMatrixMediaViewer.tsx', 'src/nativeMatrixMedia.ts', 'src/nativeMediaPresentation.ts',
  'scripts/native-media-render-qa/main.jsx', 'scripts/native-media-render-qa/server.mjs']) {
  const bytes = await readFile(resolve(social, path)); files[path] = { bytes: bytes.length, sha256: sha(bytes) };
}
const status = { mode: 'actual-viewer-public-fixture-only', files, bundle: { bytes: bundle.length, sha256: sha(bundle) },
  publicLogoSHA256: sha(logo), react: '19.2.3', reactDom: '19.2.3', reactNativeWeb: '0.21.2',
  noProductDependencyWrites: true, nativeOrMatrixAuthorization: false };
await writeFile(resolve(output, 'source-status.json'), JSON.stringify(status, null, 2) + '\n');
const assets = new Map([['/', [html, 'text/html; charset=utf-8']], ['/main.js', [bundle, 'text/javascript; charset=utf-8']],
  ['/logo.png', [logo, 'image/png']], ['/source-status', [Buffer.from(JSON.stringify(status)), 'application/json']]]);
const server = createServer((request, response) => {
  const route = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const asset = assets.get(route);
  if (request.method !== 'GET' || !asset) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  response.end(asset[0]);
});
server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ port: server.address().port, output, status }) + '\n'));
