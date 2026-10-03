import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const stage = process.argv[2];
const modelPath = process.argv[3];
if (!stage || !modelPath) throw new Error('Specify the isolated runtime stage and pinned QA model');
const runtime = join(resolve(stage), 'node_modules/onnxruntime-web/dist');
const files = new Map([
  ['/', [join(here, 'index.html'), 'text/html']],
  ['/main.mjs', [join(here, 'main.mjs'), 'text/javascript']],
  ['/worker.mjs', [join(here, 'worker.mjs'), 'text/javascript']],
  ['/styles.css', [join(here, 'styles.css'), 'text/css']],
  ['/logo.png', [resolve(here, '../../assets/ynx-original-logo.png'), 'image/png']],
  ['/model.onnx', [resolve(modelPath), 'application/octet-stream']],
  ['/runtime/ort.wasm.bundle.min.mjs', [join(runtime, 'ort.wasm.bundle.min.mjs'), 'text/javascript']],
  ['/runtime/ort-wasm-simd-threaded.mjs', [join(runtime, 'ort-wasm-simd-threaded.mjs'), 'text/javascript']],
  ['/runtime/ort-wasm-simd-threaded.wasm', [join(runtime, 'ort-wasm-simd-threaded.wasm'), 'application/wasm']],
]);
const pins = new Map([
  ['/model.onnx', '03e61be280fb24114facd87a1e1e6b2b654aad49845686da2f930c72740914aa'],
  ['/runtime/ort.wasm.bundle.min.mjs', '11e64bd8ffe11bd1a2a2f0d6275fdfbbba7262f0b76b99b53d228a8a22ef3d90'],
  ['/runtime/ort-wasm-simd-threaded.mjs', 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b'],
  ['/runtime/ort-wasm-simd-threaded.wasm', '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2'],
]);
let probeRequests = 0;
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const worker = path === '/worker.mjs';
  response.setHeader('Content-Security-Policy', worker
    ? "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'"
    : "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'");
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
  if (path === '/network-probe') { ++probeRequests; response.writeHead(204); response.end(); return; }
  if (path === '/probe-count') {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ probeRequests })); return;
  }
  const entry = files.get(path);
  if (!entry) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const bytes = await readFile(entry[0]);
    const pin = pins.get(path);
    if (pin && createHash('sha256').update(bytes).digest('hex') !== pin) throw new Error('Asset integrity mismatch');
    response.setHeader('Content-Type', entry[1]); response.end(bytes);
  } catch { response.writeHead(503); response.end('QA asset unavailable or invalid'); }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(JSON.stringify({ purpose: 'SYNTHETIC_LOCAL_WORKER_QA_ONLY', url: `http://127.0.0.1:${address.port}` }) + '\n');
});
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
