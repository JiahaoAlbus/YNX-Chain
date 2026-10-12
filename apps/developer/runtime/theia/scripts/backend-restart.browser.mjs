import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const receiptPath = process.argv[2];
const runtime = JSON.parse(await readFile(receiptPath, 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(receiptPath, `${runtime.qa}/runtime.json`);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
assert.equal(runtime.profile, `${runtime.qa}/profile`);
const commandLine = execFileSync('/bin/ps', ['-p', String(runtime.pid), '-o', 'command='], { encoding: 'utf8' });
assert.ok(commandLine.includes(`${runtime.root}/lib/backend/main.js ${runtime.workspace} --hostname 127.0.0.1 --port ${runtime.port}`));
assert.ok(commandLine.trim().endsWith(`--plugins local-dir:${runtime.plugins}`));
await writeFile(`${runtime.qa}/runtime-before-backend-restart.json`, JSON.stringify(runtime, null, 2), { flag: 'wx', mode: 0o600 });
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/backend-restart-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
const checks = [], errors = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
async function ready() {
  await page.locator('#theia-app-shell').waitFor();
  await page.locator('.theia-preload').waitFor({ state: 'hidden' });
}
async function command(name) {
  await page.keyboard.press('Escape'); await page.keyboard.press('F1');
  await page.locator('.quick-input-box input').fill(`>${name}`);
  await page.locator('.quick-input-list').getByText(name, { exact: true }).first().click();
}
async function tools() {
  await command('Extensions: Show Built-in Extensions');
  await page.getByText(/^(YNX Tools|ynx\.ynx-tools)$/).filter({ visible: true }).first().dblclick();
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let resumed;
try {
  await page.goto(runtime.url); await ready(); await tools();
  await page.locator('.codicon-settings-gear').filter({ visible: true }).last().click();
  await page.getByRole('menuitem', { name: 'Disable', exact: true }).click();
  await Promise.all([page.waitForEvent('domcontentloaded'), page.getByRole('button', { name: 'Reload Window', exact: true }).last().click()]);
  await ready();
  const paths = [`${runtime.profile}/settings.json`, `${runtime.profile}/backend-settings.json`, `${runtime.workspace}/main.js`, `${runtime.workspace}/开发文件/合约.ynxnotes`];
  const before = Object.fromEntries(await Promise.all(paths.map(async path => [path, digest(await readFile(path))])));
  const preferences = JSON.parse(await readFile(paths[0], 'utf8'));
  assert.equal(preferences['editor.fontSize'], 17);
  assert.equal(preferences['[javascript]']['editor.tabSize'], 2);
  // Match the exact owned group as well as its command before terminating it.
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const descendants = new Set([runtime.pid]);
  for (;;) {
    const before = descendants.size;
    for (const [pid, parent] of rows) if (descendants.has(parent)) descendants.add(pid);
    if (descendants.size === before) break;
  }
  const group = rows.filter(([, , pgid]) => pgid === runtime.pid).map(([pid]) => pid);
  assert.ok(group.includes(runtime.pid) && group.every(pid => descendants.has(pid)));
  process.kill(-runtime.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 200; attempt++) {
    try { process.kill(runtime.pid, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; }
    await new Promise(ok => setTimeout(ok, 50));
  }
  assert.throws(() => process.kill(runtime.pid, 0), { code: 'ESRCH' });
  resumed = spawn(process.execPath, [fileURLToPath(new URL('./start-isolated-qa.mjs', import.meta.url)), runtime.plugins, runtime.dapRoot || '', runtime.root, receiptPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  resumed.stdout.pipe(process.stdout); resumed.stderr.pipe(process.stderr);
  let launchError;
  resumed.once('error', error => { launchError = error; });
  let next;
  for (let attempt = 0; attempt < 600; attempt++) {
    if (launchError) throw launchError;
    if (resumed.exitCode !== null) throw Error(`Resume launcher exited ${resumed.exitCode}`);
    next = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (next.pid !== runtime.pid) {
      try { if ((await fetch(runtime.url)).ok) break; } catch {}
    }
    await new Promise(ok => setTimeout(ok, 100));
  }
  assert.notEqual(next.pid, runtime.pid);
  assert.equal(next.previousPid, runtime.pid);
  await page.reload(); await ready();
  const after = Object.fromEntries(await Promise.all(paths.map(async path => [path, digest(await readFile(path))])));
  assert.deepEqual(after, before);
  await page.keyboard.press('Meta+p');
  await page.locator('input[placeholder^="Search files by name"]').fill('main.js');
  await page.locator('.quick-input-list').getByText('main.js', { exact: true }).first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.monaco-editor .view-line')].some(node => getComputedStyle(node).fontSize === '17px'));
  await page.locator('#theia-statusBar').filter({ hasText: 'Spaces: 2' }).waitFor();
  checks.push('Actual backend SIGTERM and new PID preserve the same project files, user/language settings and rendered editor preferences.');
  await tools();
  await page.getByText('Disabled', { exact: true }).filter({ visible: true }).first().waitFor();
  await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill('>YNX: Create Read-only Testnet SDK Starter');
  await page.locator('.quick-input-widget').filter({ hasText: '0 Results' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.codicon-settings-gear').filter({ visible: true }).last().click();
  await page.getByRole('menuitem', { name: 'Enable', exact: true }).click();
  await page.reload(); await ready(); await command('YNX: Create Read-only Testnet SDK Starter');
  if (next.fixtureSessionId) {
    await page.getByText(/^Create the read-only YNX Testnet SDK starter at /).filter({ visible: true }).waitFor();
    await page.keyboard.press('Escape');
  } else {
    await page.waitForFunction(() => document.body.innerText.includes('Create this starter from an active YNX project runtime.'));
  }
  await assert.rejects(readFile(`${runtime.workspace}/ynx-testnet-readonly.mjs`), { code: 'ENOENT' });
  checks.push('Actual disabled extension state survives backend replacement; enable and reload reactivate its real command without bypassing session admission.');
  assert.deepEqual(errors, []);
  const receipt = { runtime: next, previousPid: runtime.pid, runnerSha256: digest(bytes), before, after, checks, errors, scope: 'Controlled macOS backend graceful restart of the same QA profile. Not crash recovery, public identity, user-extension installation or production capacity.' };
  await writeFile(`${runtime.qa}/backend-restart-browser.json`, JSON.stringify(receipt, null, 2));
  await page.screenshot({ path: `${runtime.qa}/backend-restart-final.png` });
  console.log(JSON.stringify(receipt));
} catch (error) {
  await writeFile(`${runtime.qa}/backend-restart-failure.json`, JSON.stringify({ checks, errors, failure: String(error), text: await page.locator('body').innerText() }, null, 2));
  await page.screenshot({ path: `${runtime.qa}/backend-restart-failure.png` });
  throw error;
} finally {
  await browser.close();
  if (resumed) resumed.kill('SIGTERM');
}
