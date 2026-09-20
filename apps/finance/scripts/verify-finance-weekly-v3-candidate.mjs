#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const value = name => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`missing ${name}`);
  return args[index + 1];
};
const archive = value('--archive');
const sourceCommit = value('--source');
const evidencePath = value('--evidence');
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('source must be lowercase 40-hex');

const sha256 = body => createHash('sha256').update(body).digest('hex');
const archiveBody = readFileSync(archive);
const archiveReceipt = { path: archive, bytes: archiveBody.length, sha256: sha256(archiveBody) };
const sidecar = JSON.parse(readFileSync(`${archive}.manifest.json`, 'utf8'));
assert.equal(sidecar.sourceCommit, sourceCommit);
assert.equal(sidecar.archive.bytes, archiveReceipt.bytes);
assert.equal(sidecar.archive.sha256, archiveReceipt.sha256);
assert.equal(sidecar.repeatedBuildByteExact, true);

const root = mkdtempSync(join(tmpdir(), 'ynx-finance-weekly-v3-verify-'));
const stateRoot = join(root, 'state');
const extractRoot = join(root, 'candidate');
execFileSync('mkdir', ['-m', '0700', stateRoot, extractRoot]);
const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
assert.ok(listed.length > 0);
assert.equal(new Set(listed).size, listed.length);
for (const name of listed) {
  assert.equal(name.startsWith('/'), false);
  assert.equal(name.split('/').includes('..'), false);
  assert.equal(name.endsWith('/'), false);
}
execFileSync('tar', ['-xzf', archive, '-C', extractRoot]);

const manifest = JSON.parse(readFileSync(join(extractRoot, 'manifest.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 'ynx.finance.weekly-v3-candidate.v1');
assert.equal(manifest.sourceCommit, sourceCommit);
assert.equal(manifest.sourceTree, sidecar.sourceTree);
assert.equal(manifest.release, sidecar.release);
assert.deepEqual(manifest.platform, { os: 'linux', arch: 'amd64', cgoEnabled: false, executableFormat: 'ELF64', machine: 'x86-64' });
assert.deepEqual(manifest.safetyDefaults, {
  tradingEnvironment: 'sandbox', tradingEnabled: false, liveEnabled: false,
  sandboxWritesEnabled: false, credentialsBundled: false,
  providerReadAttempted: false, providerWriteAttempted: false,
});
const expectedMembers = [...manifest.files.map(file => file.path), 'manifest.json'].sort();
assert.deepEqual([...listed].sort(), expectedMembers);
for (const file of manifest.files) {
  const body = readFileSync(join(extractRoot, file.path));
  assert.equal(body.length, file.bytes, file.path);
  assert.equal(sha256(body), file.sha256, file.path);
}

const binaries = ['ynx-finance', 'ynx-finance-admin', 'ynx-finance-broker-tools', 'ynx-finance-broker-worker'];
for (const name of binaries) {
  const header = readFileSync(join(extractRoot, name)).subarray(0, 20);
  assert.equal(header.subarray(0, 5).toString('hex'), '7f454c4602', name);
  assert.equal(header.subarray(18, 20).toString('hex'), '3e00', name);
}
const example = readFileSync(join(extractRoot, '.env.example'), 'utf8');
for (const exact of [
  'YNX_CHAIN_ENV=testnet', 'FINANCE_TRADING_ENV=sandbox', 'FINANCE_TRADING_ENABLED=false',
  'FINANCE_LIVE_ENABLED=false', 'FINANCE_SANDBOX_WRITES_ENABLED=false',
  'ALPACA_BROKER_CLIENT_ID=', 'ALPACA_BROKER_CLIENT_SECRET=',
]) assert.equal(example.split(/\r?\n/).filter(line => line === exact).length, 1, exact);
assert.equal(/^FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256=[^\s#]+$/m.test(example), false);

const image = 'ubuntu:24.04';
const inspectImage = JSON.parse(execFileSync('docker', ['image', 'inspect', image], { encoding: 'utf8' }))[0];
const container = `ynx-finance-candidate-${randomUUID()}`;
const legacyContainer = `ynx-finance-candidate-legacy-${randomUUID()}`;
const env = [
  'YNX_FINANCE_LISTEN=0.0.0.0:6436',
  'YNX_FINANCE_STATE_PATH=/state/state.json',
  'YNX_FINANCE_WEB_DIR=/candidate/web',
  'YNX_FINANCE_AUTH_MODE=product-session-v2',
  'YNX_FINANCE_ALLOWED_ORIGINS=http://127.0.0.1',
  'YNX_EXPLORER_URL=https://invalid.local',
  'YNX_FINANCE_DISPUTE_URL=https://invalid.local/disputes',
  'YNX_FINANCE_HELP_URL=https://invalid.local/help',
  'YNX_FINANCE_PRIVACY_URL=https://invalid.local/privacy',
  'YNX_FINANCE_CURSOR_SIGNING_KEY=local-candidate-read-only-cursor-key-0001',
  'YNX_FINANCE_OPERATIONS_KEY=local-candidate-read-only-operations-key-0001',
  'YNX_CHAIN_ENV=testnet',
  'FINANCE_TRADING_ENV=sandbox',
  'FINANCE_TRADING_ENABLED=false',
  'FINANCE_LIVE_ENABLED=false',
  'FINANCE_SANDBOX_WRITES_ENABLED=false',
];
const dockerBase = ['--platform', 'linux/amd64', '-v', `${extractRoot}:/candidate:ro`, '-v', `${stateRoot}:/state:rw`];
const envArgs = env.flatMap(item => ['-e', item]);
let endpoints = [];
let diagnostic;
let absentStateColdStart;
let legacyStateReadOnlyColdStart;
try {
  execFileSync('docker', ['create', '--name', container, ...dockerBase, ...envArgs, '-p', '127.0.0.1::6436', image, '/candidate/ynx-finance'], { stdio: 'ignore' });
  execFileSync('docker', ['start', container], { stdio: 'ignore' });
  const portOutput = execFileSync('docker', ['port', container, '6436/tcp'], { encoding: 'utf8' }).trim();
  const port = Number(portOutput.slice(portOutput.lastIndexOf(':') + 1));
  assert.ok(Number.isInteger(port) && port > 0);
  const routes = ['/health', '/version', '/ready', '/api/broker/status', '/', '/app.js', '/wallet-auth.js'];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      endpoints = [];
      for (const route of routes) {
        const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { 'cache-control': 'no-cache' } });
        const body = Buffer.from(await response.arrayBuffer());
        assert.equal(response.status, 200, route);
        endpoints.push({ route, status: response.status, bytes: body.length, sha256: sha256(body), contentType: response.headers.get('content-type') });
        if (route === '/version') assert.equal(JSON.parse(body).commit, sourceCommit);
        if (route === '/api/broker/status') {
          const responseBody = JSON.parse(body);
          assert.equal(responseBody.status.officialSandboxVerified, false);
          assert.equal(responseBody.status.productionApproved, false);
          assert.equal(responseBody.status.submissionEnabled, false);
        }
      }
      break;
    } catch (error) {
      endpoints = [];
      if (attempt === 49) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const doctor = spawnSync('docker', ['run', '--rm', ...dockerBase, ...envArgs, image, '/candidate/ynx-finance-broker-tools', 'doctor'], { encoding: 'utf8' });
  assert.ok(doctor.status === 0 || doctor.status === 2);
  diagnostic = JSON.parse(doctor.stdout);
  assert.equal(diagnostic.result, 'CONFIGURATION_ONLY_NO_NETWORK');
  assert.equal(diagnostic.configuration.submissionEnabled, false);
  assert.equal(diagnostic.configuration.officialSandboxVerified, false);
  assert.equal(diagnostic.configuration.productionApproved, false);
  assert.equal(diagnostic.networkAttempted, false);
  assert.equal(diagnostic.writeAttempted, false);
  assert.equal(diagnostic.officialSandboxVerified, false);
  assert.equal(diagnostic.productionApproved, false);
  assert.deepEqual(readdirSync(stateRoot), []);
  absentStateColdStart = true;
  execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });

  const legacyState = Buffer.from('{"version":1,"accounts":{"ynx1legacy":{"categories":[],"budgets":[],"reminders":[],"notes":[],"privacy":{"includePayInStatements":true,"allowAiActivityContext":false,"alertsEnabled":true,"updatedAt":"0001-01-01T00:00:00Z"},"classifications":{},"aiJobs":[],"idempotency":{}}},"audit":[],"usedWalletNonces":{}}');
  const legacyStatePath = join(stateRoot, 'state.json');
  writeFileSync(legacyStatePath, legacyState, { mode: 0o600 });
  const beforeLegacySha256 = sha256(readFileSync(legacyStatePath));
  execFileSync('docker', ['create', '--name', legacyContainer, ...dockerBase, ...envArgs, '-p', '127.0.0.1::6436', image, '/candidate/ynx-finance'], { stdio: 'ignore' });
  execFileSync('docker', ['start', legacyContainer], { stdio: 'ignore' });
  const legacyPortOutput = execFileSync('docker', ['port', legacyContainer, '6436/tcp'], { encoding: 'utf8' }).trim();
  const legacyPort = Number(legacyPortOutput.slice(legacyPortOutput.lastIndexOf(':') + 1));
  let legacyEndpoints = [];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      legacyEndpoints = [];
      for (const route of ['/health', '/version', '/ready']) {
        const response = await fetch(`http://127.0.0.1:${legacyPort}${route}`, { headers: { 'cache-control': 'no-cache' } });
        const body = Buffer.from(await response.arrayBuffer());
        assert.equal(response.status, 200, route);
        if (route === '/version') assert.equal(JSON.parse(body).commit, sourceCommit);
        legacyEndpoints.push({ route, status: response.status, bytes: body.length, sha256: sha256(body) });
      }
      break;
    } catch (error) {
      legacyEndpoints = [];
      if (attempt === 49) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  execFileSync('docker', ['rm', '-f', legacyContainer], { stdio: 'ignore' });
  const afterLegacyBody = readFileSync(legacyStatePath);
  assert.equal(sha256(afterLegacyBody), beforeLegacySha256);
  assert.equal(JSON.parse(afterLegacyBody).version, 1);
  legacyStateReadOnlyColdStart = {
    performed: true,
    sourceVersion: 1,
    acceptedByCandidate: true,
    diskStateUnchanged: true,
    beforeSha256: beforeLegacySha256,
    afterSha256: sha256(afterLegacyBody),
    endpoints: legacyEndpoints,
  };
} finally {
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  spawnSync('docker', ['rm', '-f', legacyContainer], { stdio: 'ignore' });
}

const evidence = {
  schemaVersion: 'ynx.finance.weekly-v3-candidate-verification.v1',
  capturedAt: new Date().toISOString(),
  source: { commit: sourceCommit, tree: manifest.sourceTree, toolingCommit: manifest.toolingCommit },
  candidate: {
    release: manifest.release,
    archive: archiveReceipt,
    repeatBuildByteExact: sidecar.repeatedBuildByteExact,
    manifestSha256: sha256(readFileSync(join(extractRoot, 'manifest.json'))),
    files: manifest.files,
  },
  safetyDefaults: manifest.safetyDefaults,
  localLinuxColdStart: {
    performed: true,
    containerImage: image,
    containerImageId: inspectImage.Id,
    requestedPlatform: 'linux/amd64',
    endpoints,
    stateAbsentBeforeAndAfter: absentStateColdStart,
    diagnostic,
  },
  legacyStateReadOnlyColdStart,
  providerReadAttempted: false,
  providerWriteAttempted: false,
  officialSandboxVerified: false,
  publicDeploymentPerformed: false,
  liveEnabled: false,
  mainnetEnabled: false,
};
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ evidence: evidencePath, archive: archiveReceipt, endpoints: endpoints.length })}\n`);
rmSync(root, { recursive: true, force: true });
