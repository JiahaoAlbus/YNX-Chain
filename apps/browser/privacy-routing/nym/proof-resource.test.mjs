import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, chmod, symlink, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createProofResource, validateProofResource } from './proof-resource.mjs';

const body = Buffer.from('Owned generated proof fixture bytes\n');
const pin = createHash('sha256').update(body).digest('hex');
const origin = 'https://proof.example.org'; // Syntax fixture only; never resolved or published.
const path = '/ynx-route-probe/01234567-89ab-cdef-0123-456789abcdef/proof';
const config = () => ({ origin, body: Buffer.from(body), responseSHA256: pin, lifetimeSeconds: 5 });
async function fixture(t, input = config(), dependencies) {
  const resource = createProofResource(input, dependencies);
  const server = http.createServer(resource.handler);
  await new Promise(resolve_ => server.listen(0, '127.0.0.1', resolve_));
  t.after(async () => { resource.close(); server.closeAllConnections(); await new Promise(resolve_ => server.close(resolve_)); });
  const request = (target = path, method = 'GET', headers = {}) => new Promise((resolve_, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: target, method,
      headers: { Host: 'proof.example.org', ...headers }, agent: false }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve_({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.setTimeout(2000, () => request.destroy(new Error('Owned request deadline')));
    request.on('error', reject); request.end();
  });
  return { resource, request };
}

test('fixed reviewed bytes satisfy fresh run paths without byte mutation', async t => {
  const input = config(), { resource, request } = await fixture(t, input);
  input.body.fill(0); // Mutating the supplier buffer cannot alter the installed handler pin.
  for (const target of [path, '/ynx-route-probe/another-fresh-run/proof']) {
    const response = await request(target);
    assert.equal(response.status, 200); assert.deepEqual(response.body, body);
    assert.equal(createHash('sha256').update(response.body).digest('hex'), pin);
    assert.equal(response.headers['content-length'], String(body.length));
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers.location, undefined);
  }
  const receipt = resource.receipt();
  assert.equal(receipt.normalTLSValidated, false); assert.equal(receipt.platformIsolationAdmitted, false);
  assert.equal(receipt.records.length, 2); assert.equal(receipt.records[0].runID, '01234567-89ab-cdef-0123-456789abcdef');
});

test('HEAD advertises the same representation but sends no bytes', async t => {
  const { resource, request } = await fixture(t);
  const response = await request(path, 'HEAD');
  assert.equal(response.status, 200); assert.equal(response.body.length, 0);
  assert.equal(response.headers['content-length'], String(body.length));
  assert.equal(resource.receipt().records[0].responseBytes, 0);
});

test('reject ambiguous, encoded, out of scope, queried and absolute request targets', async t => {
  const { resource, request } = await fixture(t);
  for (const target of ['/etc/passwd', path + '?probe=baseline-https', path + '?x=1', path + '#x',
    path.replace('proof', '%70roof'), path.replace('/proof', '/../proof'),
    '/ynx-route-probe/' + 'a'.repeat(41) + '/proof', 'https://proof.example.org' + path]) {
    assert.equal((await request(target)).status, 404, target);
  }
  assert.deepEqual(resource.receipt().records, []);
});

test('reject foreign Host, auth, cookies, request bodies and mutation methods', async t => {
  const { resource, request } = await fixture(t);
  for (const host of ['127.0.0.1', 'proof.example.org.evil', 'proof.example.org:443', 'other.example.org']) {
    assert.equal((await request(path, 'GET', { Host: host })).status, 404);
  }
  for (const headers of [{ Authorization: 'synthetic-not-a-secret' }, { Cookie: 'synthetic=1' }, { 'Content-Length': '1' }]) {
    assert.equal((await request(path, 'GET', headers)).status, 400);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal((await request(path, method)).status, 405);
  assert.deepEqual(resource.receipt().records, []);
});

test('expiry and explicit close withdraw only this handler', async t => {
  let now = 100;
  const { resource, request } = await fixture(t, config(), { now: () => now });
  assert.equal((await request()).status, 200);
  now += 5000; assert.equal((await request()).status, 410);
  resource.close(); now = 100; assert.equal((await request()).status, 410);
  assert.equal(resource.receipt().records.length, 1);
});

test('bounded request budget includes rejected traffic, and receipts omit arbitrary input', async t => {
  const { resource, request } = await fixture(t, { ...config(), maximumRequests: 2 });
  assert.equal((await request('/untrusted-sensitive-text')).status, 404);
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 429);
  assert.equal((await request()).status, 410);
  const receipt = resource.receipt(); assert.equal(receipt.records.length, 1);
  assert.equal(JSON.stringify(receipt).includes('untrusted-sensitive-text'), false);
});

test('no default body, incorrect hash, unsafe origins or unbounded options are accepted', () => {
  for (const patch of [{ body: undefined }, { body: Buffer.alloc(0) }, { body: Buffer.alloc(4097) },
    { responseSHA256: '0'.repeat(64) }, { responseSHA256: pin.toUpperCase() },
    { lifetimeSeconds: 0 }, { lifetimeSeconds: 601 }, { maximumRequests: 513 }]) {
    assert.throws(() => validateProofResource({ ...config(), ...patch }));
  }
  for (const value of ['http://proof.example.org', 'https://proof.example.org/', 'https://user@proof.example.org',
    'https://proof.example.org:443', 'https://proof.example.org/path', 'https://proof.example.org?x=1',
    'https://127.0.0.1', 'https://proof.local', 'https://proof.test', 'https://proof.invalid', 'https://proof.onion']) {
    assert.throws(() => validateProofResource({ ...config(), origin: value }), value);
  }
});

test('explicit CLI binds only loopback and SIGINT writes a final bounded receipt before exit', async t => {
  const output = process.env.YNX_NYM_RESOURCE_TEST_OUTPUT ?? process.env.RUNNER_TEMP ?? tmpdir();
  assert.ok(output.startsWith('/'), 'Absolute test-output directory required');
  const directory = await mkdtemp(join(output, 'proof-cli-')); await chmod(directory, 0o700);
  const bodyFile = join(directory, 'public-body.bin'), receiptFile = join(directory, 'receipt.json');
  await writeFile(bodyFile, body, { mode: 0o600 });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./proof-resource.mjs', import.meta.url)),
    '--origin', origin, '--body-file', bodyFile, '--response-sha256', pin,
    '--receipt', receiptFile, '--lifetime-seconds', '3'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let reaped = false; const exit = once(child, 'exit').then(value => { reaped = true; return value; });
  t.after(async () => { if (!reaped) { child.kill('SIGKILL'); await exit; } });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 6000); t.after(() => clearTimeout(timeout));
  const [data] = await once(child.stdout, 'data'), started = JSON.parse(data.toString());
  assert.equal(started.localEndpoint.address, '127.0.0.1'); assert.equal(started.publicDeploymentStarted, false);
  assert.equal(started.normalTLSValidated, false); child.kill('SIGINT');
  const [code, signal] = await exit; assert.equal(code, 0); assert.equal(signal, null);
  const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
  assert.equal(receipt.childPID, child.pid); assert.equal(receipt.stopped, true);
  assert.equal(receipt.closed, true); assert.deepEqual(receipt.records, []);
  // Existing receipt is preserved, and refusal occurs before another listener is created.
  const duplicate = spawn(process.execPath, [fileURLToPath(new URL('./proof-resource.mjs', import.meta.url)),
    '--origin', origin, '--body-file', bodyFile, '--response-sha256', pin,
    '--receipt', receiptFile, '--lifetime-seconds', '1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; duplicate.stdout.on('data', data => { stdout += data; }); duplicate.stderr.resume();
  const [rejected] = await once(duplicate, 'exit'); assert.equal(rejected, 1); assert.equal(stdout, '');
  assert.deepEqual(JSON.parse(await readFile(receiptFile, 'utf8')), receipt);
});

test('CLI rejects changed pins, symlinks, hardlinks and oversized files before listening', async () => {
  const output = process.env.YNX_NYM_RESOURCE_TEST_OUTPUT ?? process.env.RUNNER_TEMP ?? tmpdir();
  const directory = await mkdtemp(join(output, 'proof-file-reject-')); await chmod(directory, 0o700);
  const files = {};
  for (const [name, bytes] of [['correct', body], ['oversized', Buffer.alloc(4097)], ['empty', Buffer.alloc(0)]]) {
    files[name] = join(directory, name); await writeFile(files[name], bytes, { mode: 0o600 });
  }
  files.symlink = join(directory, 'symlink'); await symlink(files.correct, files.symlink);
  files.hardlink = join(directory, 'hardlink'); await link(files.correct, files.hardlink);
  // correct also has nlink2 now; each candidate must fail closed, before creating a listener.
  for (const file of Object.values(files)) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./proof-resource.mjs', import.meta.url)),
      '--origin', origin, '--body-file', file, '--response-sha256', pin,
      '--receipt', join(directory, 'fresh-receipt.json'), '--lifetime-seconds', '1'], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 1, file); assert.equal(result.stdout, '', file);
  }
  const mismatch = join(directory, 'mismatched'); await writeFile(mismatch, Buffer.from('Different generated bytes'));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./proof-resource.mjs', import.meta.url)),
    '--origin', origin, '--body-file', mismatch, '--response-sha256', pin,
    '--receipt', join(directory, 'fresh-receipt.json'), '--lifetime-seconds', '1'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
});
