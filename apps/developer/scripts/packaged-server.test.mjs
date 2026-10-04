import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, cp, appendFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

test('actual bundled desktop service starts with isolated state and refuses unauthenticated private operations', async t => {
  if (!process.env.YNX_QA_NATIVE_PACKAGE) return t.skip('Supply an existing owned native candidate.');
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const candidate = await realpath(process.env.YNX_QA_NATIVE_PACKAGE);
  assert.ok(candidate.startsWith(join(appRoot, '.ynx-developer-candidates') + '/'));
  const resources = join(candidate, 'YNX Developer Testnet Preview.app/Contents/Resources');
  const provenance = JSON.parse(await readFile(join(resources, 'build-provenance.json'), 'utf8'));
  const qa = await mkdtemp('/private/tmp/ynx-packaged-server-');
  await mkdir(join(qa, 'support')); await mkdir(join(qa, 'tmp'));
  const reservation = createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const child = spawn(join(resources, 'runtime/node'), [join(resources, 'server.mjs')], {
    cwd: qa, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', PORT: String(port), TMPDIR: join(qa, 'tmp'), YNX_CODE_DESKTOP_SUPPORT_DIR: join(qa, 'support') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const ended = new Promise(r => child.once('exit', (code, signal) => r({ code, signal })));
  const checks = [], responses = []; let exit;
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 5000);
    exit = await ended; clearTimeout(timer);
    await writeFile(join(qa, 'startup.log'), output);
    await writeFile(join(qa, 'receipt.json'), JSON.stringify({ candidate, qa, pid: child.pid, provenance, checks, responses, exit,
      scope: 'Actual packaged Node/server only, own new support state. No Cocoa app launch, installed user state, canonical identity or operator adapter.' }, null, 2));
    t.diagnostic(`Preserved actual packaged service proof: ${qa}/receipt.json`);
    assert.equal(exit.code, 0); assert.equal(exit.signal, null);
  });
  for (let attempt = 0; attempt < 150 && !output.includes('YNX Code Gateway'); attempt++) {
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.match(output, /YNX Code Gateway/); checks.push('Actual packaged service starts.');
  const base = `http://127.0.0.1:${port}`;
  const health = await (await fetch(base + '/healthz')).json();
  assert.equal(health.sourceCommit, provenance.sourceCommit); assert.equal(health.sourceTree, provenance.sourceTree);
  checks.push('Live health source identity matches embedded provenance.');
  const page = await fetch(base + '/native-tools', { headers: { accept: 'text/html' } }); assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/); checks.push('Packaged frontend serves the Tools route.');
  const sessionId = '00000000-0000-4000-8000-000000000001';
  const wrongHost = await fetch(base + `/runtime/native-tools/context?sessionId=${sessionId}`);
  assert.equal(wrongHost.status, 403); assert.equal((await wrongHost.json()).code, 'tools_origin');
  checks.push('Loopback host cannot acquire a private Tools context.');
  for (const [path, method, body] of [
    [`/runtime/native-tools/context?sessionId=${sessionId}`, 'GET'],
    [`/runtime/native-tools/chain/compile?sessionId=${sessionId}`, 'POST', { csrf: 'fake', name: 'Forged', source: 'pragma solidity 0.8.24; contract Forged {}' }],
    ['/runtime/codeoss', 'GET'],
  ]) {
    // Node fetch replaces a caller Host header. Use HTTP directly so this
    // negative control reaches the canonical identity gate after host checks.
    const response = await new Promise((resolve, reject) => {
      const request = httpRequest(base + path, { method, headers: { host: 'developer.ynxweb4.com', 'content-type': 'application/json', 'x-ynx-owner': 'forged', 'x-ynx-account': 'forged', cookie: 'ynx-fake=forged' } }, result => {
        let text = ''; result.on('data', b => text += b); result.on('error', reject);
        result.on('end', () => { try { resolve({ status: result.statusCode, value: JSON.parse(text) }); } catch (error) { reject(error); } });
      });
      request.on('error', reject); request.setTimeout(5000, () => request.destroy(Error('Private request timeout.')));
      request.end(body ? JSON.stringify(body) : undefined);
    });
    const value = response.value; responses.push({ path, status: response.status, value });
    assert.ok([401, 503].includes(response.status)); assert.match(value.code, /^core_identity_(?:required|unavailable)$/);
    for (const key of ['csrf', 'bytecode', 'artifactHash', 'sessions', 'launchURL']) assert.equal(value[key], undefined);
  }
  checks.push('Forged caller identity cannot receive context, compile artifact or runtime admission.');
  if (process.env.YNX_QA_PLAYWRIGHT_MODULE) {
    const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/projects');
      await page.getByRole('heading', { name: 'Your development workspace', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Sign in with YNX Wallet', exact: true }).waitFor();
      await page.screenshot({ path: join(qa, 'projects.png') });
      await page.goto(base + '/native-tools');
      await page.getByRole('heading', { name: 'YNX Tools', exact: true }).waitFor();
      await page.getByText('Open these tools from an active Wallet project.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Refresh workspace connection', exact: true }).click();
      await page.getByRole('link', { name: 'Sign in with YNX Wallet', exact: true }).waitFor();
      assert.equal(await page.locator('#native-ai-prompt').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Compile', exact: true }).count(), 0);
      await page.screenshot({ path: join(qa, 'tools-no-admission.png') });
      assert.deepEqual(errors, []);
      checks.push('Actual packaged React renders projects and Tools; unauthenticated users see sign-in and cannot access private AI/compile controls, pageerrors[].');
    } finally { await browser.close(); }
  }
});

test('actual desktop bootstrap refuses altered bundled compiler before creating user state', async t => {
  if (!process.env.YNX_QA_NATIVE_PACKAGE) return t.skip('Supply an existing owned native candidate.');
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const candidate = await realpath(process.env.YNX_QA_NATIVE_PACKAGE);
  assert.ok(candidate.startsWith(join(appRoot, '.ynx-developer-candidates') + '/'));
  const resources = join(candidate, 'YNX Developer Testnet Preview.app/Contents/Resources');
  const qa = await mkdtemp('/private/tmp/ynx-packaged-bootstrap-');
  const code = join(qa, 'code/apps/developer');
  await mkdir(join(code, 'scripts'), { recursive: true });
  await cp(join(resources, 'server.mjs'), join(qa, 'server.mjs'));
  await cp(join(resources, 'build-provenance.json'), join(qa, 'build-provenance.json'));
  await cp(join(resources, 'code/apps/developer/scripts/compiler-pin.mjs'), join(code, 'scripts/compiler-pin.mjs'));
  await cp(join(resources, 'code/apps/developer/compiler-runtime'), join(code, 'compiler-runtime'), { recursive: true });
  await appendFile(join(code, 'compiler-runtime/node_modules/js-sha3/src/sha3.js'), '\n// altered runtime input\n');
  const support = join(qa, 'support-must-remain-absent');
  const child = spawn(join(resources, 'runtime/node'), [join(qa, 'server.mjs')], {
    cwd: qa, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', YNX_CODE_DESKTOP_SUPPORT_DIR: support }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  const exit = await new Promise(r => child.once('exit', (code, signal) => r({ code, signal }))); clearTimeout(timer);
  await writeFile(join(qa, 'startup.log'), output);
  assert.equal(exit.code, 1); assert.equal(exit.signal, null);
  assert.match(output, /Desktop bundled compiler input is invalid/);
  await assert.rejects(access(support), { code: 'ENOENT' });
  await writeFile(join(qa, 'receipt.json'), JSON.stringify({ candidate, qa, exit, compilerTamperRefused: true, supportCreated: false }, null, 2));
  t.diagnostic(`Preserved actual bootstrap refusal: ${qa}/receipt.json`);
});
