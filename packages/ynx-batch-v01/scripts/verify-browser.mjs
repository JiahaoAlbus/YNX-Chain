import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {access, lstat, mkdtemp, open, readFile, realpath, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as nodeAPI from '../src/index.mjs';
import {RUNTIME as requiredNativeRuntime} from '../src/native.mjs';
import * as browser from '../src/browser.mjs';
import {makePublicFixture, publicSigVerRows, runOfficialSigVerVectors, runVerificationVectors} from '../test/browser-vectors.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const importMap = {imports: {'@noble/post-quantum/': '/vendor/post-quantum/',
  '@noble/hashes/': '/vendor/hashes/', '@noble/curves/': '/vendor/curves/'}};
const fixtureLimit = 2 * 1024 * 1024, outputLimit = 2 * 1024 * 1024;
const deadlineMilliseconds = 120000;

function runChrome(binary, args) {
  return new Promise((resolve, reject) => {
    // Exactly one browser invocation. No binary discovery, download or retry.
    // The detached child owns a fresh POSIX process group. Cleanup never targets
    // another browser session or a system-wide process name.
    const child = spawn(binary, args, {stdio: ['ignore', 'pipe', 'pipe'], detached: true});
    const stdout = [], stderr = []; let size = 0, overflow = false, timedOut = false, cleanupRequested = false;
    let spawnError, cleanupError;
    const killOwnedGroup = () => {
      if (cleanupRequested || !child.pid) return;
      cleanupRequested = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') cleanupError = error; }
    };
    const deadline = setTimeout(() => { timedOut = true; killOwnedGroup(); }, deadlineMilliseconds);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => {
      size += chunk.length;
      if (size > outputLimit) { overflow = true; killOwnedGroup(); } else chunks.push(chunk);
    });
    child.once('error', error => { spawnError = error; killOwnedGroup(); });
    child.once('close', (code, signal) => {
      clearTimeout(deadline); killOwnedGroup();
      const result = {code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8')};
      if (cleanupError) reject(Error('Could not clean up owned Chrome process group: ' + cleanupError.message));
      else if (spawnError) reject(spawnError);
      else if (timedOut) reject(Error('Chrome exceeded bounded deadline: ' + JSON.stringify(result)));
      else if (overflow) reject(Error('Chrome output exceeded bounded capture: ' + JSON.stringify(result)));
      else if (code !== 0 || signal) reject(Error('Chrome failed: ' + JSON.stringify(result)));
      else resolve(result);
    });
  });
}

export async function runHeadlessBrowser(fixture, {binary = process.env.BROWSER_BINARY, sigVer} = {}) {
  assert.ok(process.platform === 'linux' || process.platform === 'darwin', 'headless runner requires owned POSIX process-group cleanup');
  assert.equal(typeof binary, 'string', 'BROWSER_BINARY must explicitly name an absolute Chrome/Chromium executable');
  assert.ok(path.isAbsolute(binary), 'BROWSER_BINARY must be absolute');
  const binaryPath = await realpath(binary);
  assert.ok((await lstat(binaryPath)).isFile(), 'BROWSER_BINARY must resolve to a regular executable');
  await access(binaryPath, fsConstants.X_OK);
  const fixtureJSON = JSON.stringify(fixture);
  assert.ok(Buffer.byteLength(fixtureJSON) <= fixtureLimit, 'public fixture size bound');
  const fixtureSHA256 = createHash('sha256').update(fixtureJSON).digest('hex');
  const sigVerJSON = JSON.stringify(publicSigVerRows({sigVer}));
  assert.ok(Buffer.byteLength(sigVerJSON) <= fixtureLimit, 'separate official public sigVer request retains the original 2 MiB bound');
  const sigVerSHA256 = createHash('sha256').update(sigVerJSON).digest('hex');
  const nonce = randomBytes(18).toString('hex'), requests = [], failures = [];
  const mounts = [['/src/', path.join(root, 'src')], ['/vendor/post-quantum/', path.join(root, 'node_modules/@noble/post-quantum')],
    ['/vendor/hashes/', path.join(root, 'node_modules/@noble/hashes')], ['/vendor/curves/', path.join(root, 'node_modules/@noble/curves')]];
  const page = `<!doctype html><meta charset="utf-8"><title>YNX browser verification</title><pre id="result" data-status="pending"></pre>
<script type="importmap" nonce="${nonce}">${JSON.stringify(importMap)}</script>
<script type="module" nonce="${nonce}">
const output = document.getElementById('result');
try {
  for (const name of ['Buffer', 'process', 'require']) if (name in globalThis) throw Error('unexpected runtime shim: ' + name);
  if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') throw Error('shared-memory rejection case unavailable');
  const api = await import('/src/browser.mjs');
  const {publicSigVerRows, runOfficialSigVerVectors, runVerificationVectors} = await import('/test/browser-vectors.mjs');
  const response = await fetch('/public-fixture.json', {cache: 'no-store'});
  if (!response.ok) throw Error('public fixture HTTP ' + response.status);
  const fixture = await response.json();
  const fixtureDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fixture))));
  const fixtureSHA256 = Array.from(fixtureDigest, b => b.toString(16).padStart(2, '0')).join('');
  const officialResponse = await fetch('/public-sigver.json', {cache: 'no-store'});
  if (!officialResponse.ok) throw Error('official public sigVer HTTP ' + officialResponse.status);
  const sigVer = publicSigVerRows({sigVer: await officialResponse.json()});
  const officialDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sigVer))));
  const officialSigVerSHA256 = Array.from(officialDigest, b => b.toString(16).padStart(2, '0')).join('');
  // Verification must not request randomness. This guard throws; it never
  // supplies replacement entropy or replaces either signature implementation.
  let randomnessCalls = 0, vectors, officialSigVer;
  const randomnessGuard = () => { randomnessCalls++; throw Error('verification requested randomness'); };
  const saved = ['getRandomValues', 'randomUUID'].map(name => [name, Object.getOwnPropertyDescriptor(crypto, name)]);
  const oldMathRandom = Math.random;
  try {
    for (const [name] of saved) Object.defineProperty(crypto, name, {configurable: true, value: randomnessGuard});
    Math.random = randomnessGuard;
    vectors = runVerificationVectors(api, fixture, {publicBoundary: true});
    officialSigVer = runOfficialSigVerVectors(sigVer);
  } finally {
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(crypto, name, descriptor); else delete crypto[name]; }
    Math.random = oldMathRandom;
  }
  if (randomnessCalls !== 0) throw Error('verification attempted randomness');
  for (const name of ['Buffer', 'process', 'require']) if (name in globalThis) throw Error('runtime shim introduced: ' + name);
  output.textContent = JSON.stringify({nonce: '${nonce}', ok: true, userAgent: navigator.userAgent,
    crossOriginIsolated, sharedArrayBufferTested: true, noRuntimeShims: true, randomnessCalls, fixtureSHA256, officialSigVerSHA256,
    vectors, officialSigVer, provider: api.browserProviderInfo()});
  output.dataset.status = 'pass';
} catch (error) {
  output.textContent = JSON.stringify({nonce: '${nonce}', ok: false, error: String(error?.stack || error)});
  output.dataset.status = 'fail';
}
</script>`;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'`);
    try {
      assert.equal(request.method, 'GET', 'GET only');
      const target = request.url;
      assert.equal(typeof target, 'string'); assert.ok(!target.includes('?') && !target.includes('%') && !target.includes('\\'), 'plain fixed static paths only');
      requests.push(target);
      let body, type;
      if (target === '/') { body = page; type = 'text/html; charset=utf-8'; }
      else if (target === '/public-fixture.json') { body = fixtureJSON; type = 'application/json'; }
      else if (target === '/public-sigver.json') { body = sigVerJSON; type = 'application/json'; }
      else {
        let filename;
        if (target === '/test/browser-vectors.mjs') filename = path.join(root, 'test/browser-vectors.mjs');
        else {
          const mount = mounts.find(([prefix]) => target.startsWith(prefix));
          assert.ok(mount, 'unlisted static mount');
          const relative = target.slice(mount[0].length);
          assert.ok(/^[a-zA-Z0-9_./-]+\.(?:mjs|js)$/.test(relative) && !relative.split('/').includes('..'), 'ESM source only');
          filename = path.join(mount[1], relative);
          const resolved = await realpath(filename), base = await realpath(mount[1]);
          assert.ok(resolved.startsWith(base + path.sep), 'static file escaped its mount');
        }
        assert.ok((await lstat(filename)).isFile(), 'regular ESM file required');
        body = await readFile(filename); assert.ok(body.length <= fixtureLimit, 'ESM source size bound');
        type = 'text/javascript; charset=utf-8';
      }
      response.writeHead(200, {'Content-Type': type}); response.end(body);
    } catch (error) {
      if (request.url !== '/favicon.ico') failures.push({path: request.url, error: error.message});
      response.writeHead(404, {'Content-Type': 'text/plain'}); response.end('not found');
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  const profile = await mkdtemp(path.join(tmpdir(), 'ynx-browser-verification-'));
  let listen;
  try {
    listen = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address())); });
    const url = 'http://127.0.0.1:' + listen.port + '/';
    // Chrome's sandbox cannot start as uid 0 in a Linux CI container. Only that
    // explicit environment uses --no-sandbox; ordinary hosts retain the sandbox.
    const rootLinuxContainer = process.platform === 'linux' && process.getuid?.() === 0;
    const args = ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--user-data-dir=' + profile,
      '--dump-dom', '--timeout=90000', '--virtual-time-budget=90000', ...(rootLinuxContainer ? ['--no-sandbox'] : []), url];
    const capture = await runChrome(binaryPath, args);
    const match = capture.stdout.match(/<pre id="result" data-status="(pass|fail)">([\s\S]*?)<\/pre>/);
    assert.ok(match, 'Chrome did not return a completed browser result; stdout=' + capture.stdout + '\nstderr=' + capture.stderr);
    const encoded = match[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const result = JSON.parse(encoded);
    assert.equal(result.nonce, nonce, 'result belongs to this one browser invocation');
    assert.equal(match[1], 'pass', JSON.stringify(result)); assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.userAgent, /(?:HeadlessChrome|Chrome|Chromium)\//, 'real Chrome/Chromium user agent');
    assert.equal(result.crossOriginIsolated, true); assert.equal(result.sharedArrayBufferTested, true); assert.equal(result.noRuntimeShims, true);
    assert.equal(result.randomnessCalls, 0, 'real browser verification requested no randomness');
    assert.equal(result.fixtureSHA256, fixtureSHA256, 'browser received the exact portable public fixture');
    assert.equal(result.officialSigVerSHA256, sigVerSHA256, 'browser received the exact eight-field official sigVer rows');
    for (const required of ['/', '/src/browser.mjs', '/test/browser-vectors.mjs', '/public-fixture.json', '/public-sigver.json']) assert.ok(requests.includes(required), 'browser loaded ' + required);
    for (const prefix of ['/vendor/post-quantum/', '/vendor/hashes/', '/vendor/curves/']) assert.ok(requests.some(p => p.startsWith(prefix)), 'browser loaded actual ' + prefix);
    assert.deepEqual(failures, [], 'no failed ESM requests or unlisted resources');
    return {browserBinary: binaryPath, sandboxDisabled: rootLinuxContainer,
      sandboxReason: rootLinuxContainer ? 'Linux uid 0 CI container' : null, requests, result,
      dom: capture.stdout, domSHA256: createHash('sha256').update(capture.stdout).digest('hex'), stderr: capture.stderr};
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(profile, {recursive: true, force: true});
  }
}

async function main() {
  assert.ok(typeof process.env.BROWSER_BINARY === 'string' && path.isAbsolute(process.env.BROWSER_BINARY),
    'BROWSER_BINARY must explicitly name an absolute Chrome/Chromium executable');
  const fixture = makePublicFixture(nodeAPI, value => Buffer.from(value));
  const portableNodeAPI = Object.freeze({...nodeAPI, createVerifier: options => nodeAPI.createVerifier({...options, provider: 'portable'})});
  const portableResult = runVerificationVectors(portableNodeAPI, fixture, {fromBytes: value => Buffer.from(value),
    sharedBytes: size => Buffer.from(new SharedArrayBuffer(size))});
  const uint8Result = runVerificationVectors(browser, fixture, {publicBoundary: true});
  const officialSourceBytes = await readFile(new URL('../test/vectors/nist-acvp.json', import.meta.url));
  const officialSource = JSON.parse(officialSourceBytes.toString('utf8'));
  const sigVer = publicSigVerRows(officialSource), officialSigVer = runOfficialSigVerVectors(sigVer);
  const headless = await runHeadlessBrowser(fixture, {sigVer});
  assert.deepEqual(headless.result.vectors, uint8Result, 'actual browser runs exactly the same public Uint8Array vector suite');
  assert.deepEqual(headless.result.officialSigVer, officialSigVer, 'Node and real browser execute all 29 original official sigVer vectors identically');
  assert.deepEqual(uint8Result.cases.slice(0, portableResult.cases.length), portableResult.cases, 'explicit portable Node and browser share all verification cases');
  const actualRuntime = {node: process.versions.node, openssl: process.versions.openssl};
  const receipt = {schema: 'ynx-batch-real-browser-verification/v1', qualification: 'public-portable-browser-only', runtime: actualRuntime,
    nativeNodeQualified: false, nativeTestsExecuted: false,
    nativeRuntimeRequirementUnavailable: actualRuntime.node !== requiredNativeRuntime.node || actualRuntime.openssl !== requiredNativeRuntime.openssl,
    nativeRuntimeRequirement: {required: requiredNativeRuntime, actual: actualRuntime},
    portableNode: portableResult, uint8: uint8Result, officialSigVer,
    officialSigVerSource: {path: 'test/vectors/nist-acvp.json', sourceRevision: officialSource.sourceRevision,
      sourceFileSHA256: createHash('sha256').update(officialSourceBytes).digest('hex'),
      publicRowsBytes: Buffer.byteLength(JSON.stringify(sigVer)), publicRowsSHA256: headless.result.officialSigVerSHA256}, browser: headless};
  const receiptBytes = JSON.stringify(receipt, null, 2) + '\n';
  const receiptOut = process.env.YNX_BROWSER_VERIFICATION_RECEIPT_OUT;
  if (receiptOut !== undefined) {
    assert.ok(path.isAbsolute(receiptOut), 'YNX_BROWSER_VERIFICATION_RECEIPT_OUT must be an absolute new file');
    const file = await open(receiptOut, 'wx', 0o600);
    try { await file.writeFile(receiptBytes, 'utf8'); await file.sync(); } finally { await file.close(); }
  }
  process.stdout.write(receiptBytes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error); process.exitCode = 1; });
