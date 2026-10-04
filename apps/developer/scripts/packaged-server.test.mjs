import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, cp, appendFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

test('packaged project preparer stages exact owned extensions and preserves user state', async t => {
  if (!process.env.YNX_QA_NATIVE_PACKAGE) return t.skip('Supply an existing owned native candidate.');
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const candidate = await realpath(process.env.YNX_QA_NATIVE_PACKAGE);
  assert.ok(candidate.startsWith(join(appRoot, '.ynx-developer-candidates') + '/'));
  const code = join(candidate, 'YNX Developer Testnet Preview.app/Contents/Resources/code/apps/developer');
  const qa = await mkdtemp('/private/tmp/ynx-packaged-project-inputs-');
  const projectDirectory = join(qa, 'project-state');
  const settings = join(projectDirectory, 'user-data/User/settings.json');
  await mkdir(dirname(settings), { recursive: true });
  const originalSettings = '{"editor.fontSize":19}\n';
  await writeFile(settings, originalSettings, { flag: 'wx' });
  const checks = []; let failure;
  t.after(async () => {
    await writeFile(join(qa, 'receipt.json'), JSON.stringify({ candidate, qa, checks, failure,
      scope: 'Actual packaged filesystem preparer only, synthetic project state. No process driver, network, canonical admission or user profile.' }, null, 2), { flag: 'wx' });
    t.diagnostic(`Preserved packaged owned-input proof: ${qa}/receipt.json`);
  });
  try {
    const { prepareCoreProject } = await import(pathToFileURL(join(code, 'services/codeoss-service/src/runtime-files.mjs')));
    await prepareCoreProject({ projectDirectory });
    const inputs = {
      'ynx-brand': ['package.json', 'klein-light.json', 'ynx-logo.png', 'LICENSE.txt'],
      'ynx-tools': ['package.json', 'activity.svg', 'ynx-logo.png', 'LICENSE.txt', 'src/extension.cjs', 'src/guards.cjs', 'src/template.cjs', 'src/solidity-project.cjs', 'src/review-preview.cjs', 'src/solidity-language.cjs', 'src/solidity-diagnostics.cjs'],
    };
    let toolsTarget;
    for (const [name, files] of Object.entries(inputs)) {
      const source = join(appRoot, 'native', name), packaged = join(code, 'native', name);
      const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
      const target = join(projectDirectory, 'extensions', `${manifest.publisher}.${manifest.name}-${manifest.version}`);
      for (const file of files) {
        const expected = await readFile(join(source, file));
        assert.deepEqual(await readFile(join(packaged, file)), expected);
        assert.deepEqual(await readFile(join(target, file)), expected);
      }
      if (name === 'ynx-tools') toolsTarget = target;
    }
    checks.push('Exact packaged brand and Tools including immutable preview helper stage from the standalone package.');
    assert.equal(await readFile(settings, 'utf8'), originalSettings);
    checks.push('Existing synthetic user settings remain byte-identical.');
    const changed = join(toolsTarget, 'src/review-preview.cjs');
    const changedBytes = (await readFile(changed, 'utf8')) + '\n// preserve a locally changed extension\n';
    await writeFile(changed, changedBytes);
    await assert.rejects(prepareCoreProject({ projectDirectory }), error => error.code === 'core_tools_review_required');
    assert.equal(await readFile(changed, 'utf8'), changedBytes);
    assert.equal(await readFile(settings, 'utf8'), originalSettings);
    checks.push('Changed extension input refuses preparation without overwriting its bytes or user settings.');
  } catch (error) { failure = { code: error.code, message: error.message }; throw error; }
});

test('actual packaged preparer rejects changes to language and compiler inputs without replacing user files', async t => {
  if (!process.env.YNX_QA_NATIVE_PACKAGE) return t.skip('Supply an existing owned native candidate.');
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'), candidate = await realpath(process.env.YNX_QA_NATIVE_PACKAGE);
  assert.ok(candidate.startsWith(join(appRoot, '.ynx-developer-candidates') + '/'));
  const code = join(candidate, 'YNX Developer Testnet Preview.app/Contents/Resources/code/apps/developer');
  const { prepareCoreProject } = await import(pathToFileURL(join(code, 'services/codeoss-service/src/runtime-files.mjs')));
  const manifest = JSON.parse(await readFile(join(code, 'native/ynx-tools/package.json')));
  const qa = await mkdtemp('/private/tmp/ynx-packaged-language-input-review-'), checks = []; let failure;
  t.after(async () => {
    await writeFile(join(qa, 'receipt.json'), JSON.stringify({ candidate, qa, checks, failure, scope: 'Actual immutable packaged preparer; own synthetic project settings/extensions. No driver activation, identity, user install or network.' }, null, 2), { flag: 'wx' });
    t.diagnostic(`Preserved packaged language-input review: ${qa}/receipt.json`);
  });
  try {
    for (const [index, file] of ['src/solidity-language.cjs', 'src/solidity-diagnostics.cjs', 'compiler/compiler-worker.mjs', 'compiler/node_modules/solc/soljson.js', 'compiler/node_modules/js-sha3/src/sha3.js'].entries()) {
      const projectDirectory = join(qa, `project-${index}`), settings = join(projectDirectory, 'user-data/User/settings.json');
      await mkdir(dirname(settings), { recursive: true }); await writeFile(settings, '{"editor.fontSize":19}\n', { flag: 'wx' });
      await prepareCoreProject({ projectDirectory }); await prepareCoreProject({ projectDirectory });
      const target = join(projectDirectory, 'extensions', `ynx.ynx-tools-${manifest.version}`, file);
      assert.deepEqual(await readFile(target), await readFile(join(code, 'native/ynx-tools', file)));
      await appendFile(target, '\n// preserve user mutation\n'); const mutation = await readFile(target);
      await assert.rejects(prepareCoreProject({ projectDirectory }), { code: 'core_tools_review_required' });
      assert.deepEqual(await readFile(target), mutation); assert.equal(await readFile(settings, 'utf8'), '{"editor.fontSize":19}\n');
      checks.push(`Packaged ${file} stages byte-identically, then changed bytes refuse and survive with settings unchanged.`);
    }
  } catch (error) { failure = { code: error.code, message: error.message }; throw error; }
});
