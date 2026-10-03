import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const [runtime, xs, encoder, head, data] = process.argv.slice(2);
assert.ok(runtime && xs && encoder && head && data, 'Provide the isolated runtime and four pinned model paths');
const runtimeRoot = join(resolve(runtime), 'node_modules/onnxruntime-web/dist');
const assets = new Map();
for (const [route, path, sha] of [
  ['/assets/xs', resolve(xs), '8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689'],
  ['/assets/encoder', resolve(encoder), '712064dae0cce3fb4c94497c7dfd65d11f4ad34eadafe09442208474068cf777'],
  ['/assets/head', resolve(head), '268b8702e8e373ab0fea4de55250f506650ff87be532d1809ba70513bd5fa5b4'],
  ['/assets/head-data', resolve(data), '433df42d2b884d598a65f41d1cb16e2c44b60000f0f46da6b7c380f3851ce2ef'],
  ['/assets/wasm', join(runtimeRoot, 'ort-wasm-simd-threaded.wasm'), '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2'],
  ['/ort.mjs', join(runtimeRoot, 'ort.wasm.bundle.min.mjs'), '11e64bd8ffe11bd1a2a2f0d6275fdfbbba7262f0b76b99b53d228a8a22ef3d90'],
  ['/ort-wasm-simd-threaded.mjs', join(runtimeRoot, 'ort-wasm-simd-threaded.mjs'), 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b'],
]) {
  const bytes = await readFile(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, 'Asset SHA mismatch: ' + route);
  assets.set(route, bytes);
}
for (const [route, file] of [['/', 'index.html'], ['/main.mjs', 'main.mjs'], ['/worker.mjs', 'worker.mjs'], ['/styles.css', 'styles.css']]) {
  assets.set(route, await readFile(new URL(file, import.meta.url)));
}
const logo = await readFile(new URL('../../assets/ynx-original-logo.png', import.meta.url));
assert.equal(createHash('sha256').update(logo).digest('hex'), 'df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d');
assets.set('/logo.png', logo);
let probeRequests = 0;
const workerPolicy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; base-uri 'none'";
const parentPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', request.url === '/worker.mjs' ? workerPolicy : parentPolicy);
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
  if (request.url === '/network-probe') { probeRequests++; response.writeHead(403); response.end(); return; }
  if (request.url === '/qa-status') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ probeRequests, publicContentOnly: true, workerPolicy })); return;
  }
  const bytes = assets.get(request.url);
  if (!bytes) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', request.url === '/' ? 'text/html; charset=utf-8' :
    request.url.endsWith('.mjs') ? 'text/javascript; charset=utf-8' :
      request.url.endsWith('.css') ? 'text/css; charset=utf-8' :
        request.url.endsWith('.png') ? 'image/png' : 'application/octet-stream');
  response.setHeader('Content-Length', bytes.byteLength); response.end(bytes);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(JSON.stringify({ origin: 'http://127.0.0.1:' + server.address().port, status: 'ENGINE_QA_NOT_PRODUCT', workerPolicy }));
