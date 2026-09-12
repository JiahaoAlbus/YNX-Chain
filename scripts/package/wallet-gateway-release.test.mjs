import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { buildWalletGatewayRelease } from './wallet-gateway-release.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('committed runtime artifact starts, preserves state, pins identity, and refuses missing state or overwrite', { timeout: 60_000 }, async () => {
  const root = process.cwd();
  const sourceCommit = process.env.WALLET_GATEWAY_RELEASE_TEST_SOURCE ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-gateway-package-test-'));
  const children = new Set();
  try {
    const outputDir = path.join(tmp, 'artifact');
    assert.throws(() => buildWalletGatewayRelease({ rootDir: root, sourceCommit: 'HEAD', outputDir }), /full lowercase/);
    const receipt = buildWalletGatewayRelease({ rootDir: root, sourceCommit, outputDir });
    const archive = path.join(outputDir, receipt.archive);
    assert.equal(sha(fs.readFileSync(archive)), receipt.sha256);
    assert.throws(() => buildWalletGatewayRelease({ rootDir: root, sourceCommit, outputDir }), /already exists/);
    assert.equal(sha(fs.readFileSync(archive)), receipt.sha256);
    const release = path.join(tmp, 'extracted');
    fs.mkdirSync(release);
    execFileSync('tar', ['-xzf', archive, '-C', release]);
    const manifest = JSON.parse(fs.readFileSync(path.join(release, 'release-manifest.json')));
    assert.equal(manifest.identity.sourceCommit, sourceCommit);
    for (const file of manifest.files) {
      const bytes = fs.readFileSync(path.join(release, file.path));
      assert.equal(bytes.length, file.bytes, file.path);
      assert.equal(sha(bytes), file.sha256, file.path);
    }
    assert.equal(sha(execFileSync('git', ['show', `${sourceCommit}:packages/wallet-auth/product-session-registry.json`])), manifest.registrySha256);
    const stateDir = path.join(tmp, 'private-state');
    fs.mkdirSync(stateDir, { mode: 0o700 });
    const legacyState = path.join(stateDir, 'legacy.json'), productState = path.join(stateDir, 'product.json');
    const port = await freePort();
    const env = { ...process.env, YNX_WALLET_GATEWAY_STATE_PATH: legacyState, YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH: productState,
      YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION: '2', YNX_WALLET_GATEWAY_HTTP_ADDR: '127.0.0.1', YNX_WALLET_GATEWAY_HTTP_PORT: String(port) };
    for (const key of ['YNX_WALLET_GATEWAY_REGISTRY_PATH', 'YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH', 'YNX_WALLET_GATEWAY_SOURCE_COMMIT', 'YNX_WALLET_GATEWAY_RELEASE', 'YNX_WALLET_GATEWAY_BUILD_TIME', 'YNX_WALLET_GATEWAY_REMOTE_DEPLOYED']) delete env[key];
    const refused = spawnSync(process.execPath, [path.join(release, 'run.mjs')], { env, encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /existing durable state/);
    assert.equal(fs.existsSync(legacyState), false);
    assert.equal(fs.existsSync(productState), false);
    // Initialize only this disposable test state with the SDK's normal host.
    const seed = await start(path.join(release, 'packages/wallet-auth/scripts/ynx-wallet-gatewayd.mjs'), env, children);
    await stop(seed, children);
    const before = [legacyState, productState].map(file => sha(fs.readFileSync(file)));
    // Stale operator registry and identity settings must not override the artifact.
    const running = await start(path.join(release, 'run.mjs'), { ...env, YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH: '/does-not-exist', YNX_WALLET_GATEWAY_SOURCE_COMMIT: 'f'.repeat(40) }, children);
    const version = await fetch(`http://127.0.0.1:${port}/version`, { signal: AbortSignal.timeout(5000) });
    assert.equal(version.status, 200);
    assert.equal((await version.json()).build.sourceCommit, sourceCommit);
    const registry = JSON.parse(fs.readFileSync(path.join(release, 'packages/wallet-auth/product-session-registry.json')));
    for (const origin of new Set(registry.products.map(item => item.webOrigin))) {
      const response = await fetch(`http://127.0.0.1:${port}/v2/product-sessions/time`, { headers: { Origin: origin, 'X-Request-Id': 'req_release_smoke_000001' }, signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, origin);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.json()).schemaVersion, 2);
    }
    const denied = await fetch(`http://127.0.0.1:${port}/v2/product-sessions/time`, { headers: { Origin: 'https://unregistered.invalid', 'X-Request-Id': 'req_release_smoke_000001' }, signal: AbortSignal.timeout(5000) });
    assert.equal(denied.status, 403);
    await stop(running, children);
    assert.deepEqual([legacyState, productState].map(file => sha(fs.readFileSync(file))), before);
  } finally {
    for (const child of children) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  socket.close();
  await once(socket, 'close');
  return port;
}

async function start(script, env, children) {
  const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.once('exit', () => children.delete(child));
  let stdout = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Gateway startup timeout')), 10_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Gateway exited ${code}: ${stderr}`)); });
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.includes('"event":"listening"')) { clearTimeout(timer); resolve(); }
    });
  });
  return child;
}

async function stop(child, children) {
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const [code] = await exited;
  children.delete(child);
  assert.equal(code, 0);
}
