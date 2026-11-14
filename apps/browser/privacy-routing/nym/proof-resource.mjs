import { createHash } from 'node:crypto';
import http from 'node:http';
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runPattern = '[a-z0-9-]{1,40}';
const proofPath = new RegExp(`^/ynx-route-probe/(${runPattern})/proof$`);

// Syntax and exact public bytes only. This cannot supply domain ownership, TLS, NE or release
// authority. The caller must have reviewed this exact origin/body before publishing it.
export function validateProofResource({ origin, body, responseSHA256, lifetimeSeconds = 300, maximumRequests = 128 }) {
  if (typeof origin !== 'string' || origin.length > 2048 || !/^https:\/\/[a-z0-9.-]+$/.test(origin)) throw new Error('Exact canonical HTTPS DNS origin required');
  const url = new URL(origin), host = url.hostname;
  if (url.origin !== origin || host.length > 253 || !/\.[a-z]{2,63}$/.test(host)
      || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || /\.(?:localhost|local|test|invalid|example|onion)$/.test(host)) throw new Error('Public DNS origin required; no local or reserved origin');
  if (!Buffer.isBuffer(body) || body.length < 1 || body.length > 4096
      || typeof responseSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(responseSHA256)
      || hash(body) !== responseSHA256) throw new Error('Explicit nonempty public bytes and matching lowercase SHA-256 required');
  if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 600
      || !Number.isInteger(maximumRequests) || maximumRequests < 1 || maximumRequests > 512) throw new Error('Bounded lifetime and request budget required');
  return Object.freeze({ origin, host, body: Buffer.from(body), responseSHA256, lifetimeSeconds, maximumRequests });
}

export function createProofResource(input, { now = () => performance.now() } = {}) {
  const cfg = validateProofResource(input), deadline = now() + cfg.lifetimeSeconds * 1000;
  const records = [];
  let closed = false, requests = 0;
  function handler(request, response) {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'connection': 'close' };
    const finish = (status, bytes = Buffer.alloc(0)) => {
      response.writeHead(status, { ...headers, 'content-type': 'application/octet-stream', 'content-length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    };
    if (closed || now() >= deadline) { finish(410); return; }
    // Budget all requests, not merely successful proofs. Do not retain arbitrary URLs, headers,
    // addresses or payloads from rejected requests; diagnostics contain synthetic correlation only.
    if (++requests > cfg.maximumRequests) { closed = true; finish(429); return; }
    const match = typeof request.url === 'string' && request.url.length <= 128 ? proofPath.exec(request.url) : null;
    if (request.headers.host !== cfg.host || !match) { finish(404); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { finish(405); return; }
    if (request.headers.authorization !== undefined || request.headers.cookie !== undefined
        || request.headers['transfer-encoding'] !== undefined
        || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) { finish(400); return; }
    records.push(Object.freeze({ sequence: records.length + 1, runID: match[1], method: request.method,
      status: 200, responseBytes: request.method === 'HEAD' ? 0 : cfg.body.length,
      representationBytes: cfg.body.length, responseSHA256: cfg.responseSHA256 }));
    finish(200, cfg.body);
  }
  return Object.freeze({ handler, close: () => { closed = true; },
    receipt: () => ({ origin: cfg.origin, responseSHA256: cfg.responseSHA256, representationBytes: cfg.body.length,
      lifetimeSeconds: cfg.lifetimeSeconds, maximumRequests: cfg.maximumRequests, requests,
      closed, records: [...records], normalTLSValidated: false, platformIsolationAdmitted: false }) });
}

async function readPublicBody(path, expectedSHA256) {
  if (typeof path !== 'string' || !path.startsWith('/') || resolve(path) !== path) throw new Error('Absolute canonical public-body file required');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > 4096 || info.uid !== process.getuid()) throw new Error('Owned bounded regular public-body file required');
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const after = await file.stat(), bytes = buffer.subarray(0, bytesRead);
    if (bytesRead !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs
        || after.ctimeMs !== info.ctimeMs || hash(bytes) !== expectedSHA256) throw new Error('Public-body file differs from reviewed hash');
    return bytes;
  } finally { await file.close(); }
}

export async function runProofResource(args) {
  const names = new Set(['--origin', '--body-file', '--response-sha256', '--receipt', '--lifetime-seconds']);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!names.has(key) || options[key] !== undefined || typeof value !== 'string' || value.startsWith('--')) throw new Error('Exact explicit proof-resource arguments required');
    options[key] = value;
  }
  if ([...names].some(key => options[key] === undefined) || !/^[1-9][0-9]{0,2}$/.test(options['--lifetime-seconds'])) throw new Error('Origin, body file/hash, fresh receipt and bounded lifetime required');
  const receiptPath = options['--receipt'];
  if (!receiptPath.startsWith('/') || resolve(receiptPath) !== receiptPath) throw new Error('Absolute fresh receipt path required');
  const parent = await lstat(resolve(receiptPath, '..'));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700) throw new Error('Owned private0700 receipt directory required');
  const body = await readPublicBody(options['--body-file'], options['--response-sha256']);
  const resource = createProofResource({ origin: options['--origin'], body, responseSHA256: options['--response-sha256'], lifetimeSeconds: Number(options['--lifetime-seconds']) });
  const receiptFile = await open(receiptPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const server = http.createServer(resource.handler);
  server.headersTimeout = 5000; server.requestTimeout = 5000; server.maxConnections = 8;
  server.on('clientError', (_error, socket) => socket.destroy());
  let timer, stopPromise;
  const stop = () => {
    if (stopPromise) return stopPromise;
    resource.close();
    stopPromise = (async () => {
      clearTimeout(timer); process.off('SIGINT', stop); process.off('SIGTERM', stop);
      const stopped = new Promise(resolve_ => server.close(resolve_));
      server.closeAllConnections(); await stopped;
      await receiptFile.writeFile(JSON.stringify({ ...resource.receipt(), localEndpoint: serverEndpoint, childPID: process.pid, stopped: true }) + '\n');
      await receiptFile.close();
    })();
    return stopPromise;
  };
  let serverEndpoint;
  try {
    await new Promise((resolve_, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve_); });
    serverEndpoint = server.address();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    timer = setTimeout(stop, Number(options['--lifetime-seconds']) * 1000);
    process.stdout.write(JSON.stringify({ pid: process.pid, localEndpoint: serverEndpoint, origin: options['--origin'],
      responseSHA256: options['--response-sha256'], receiptPath, normalTLSValidated: false, publicDeploymentStarted: false }) + '\n');
    return { stop };
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProofResource(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
