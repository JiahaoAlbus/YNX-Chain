import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import storeModule from '../../ynx-workbench/lib/draft-store.js';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const prefix = process.argv[3] || 'recovery-conflict'; assert.match(prefix, /^[a-z-]+$/);
const identity = execFileSync('/bin/ps', ['-p', String(runtime.pid), '-o', 'pgid=,command='], { encoding: 'utf8' }).trim();
assert.ok(identity.startsWith(runtime.pid + ' '));
assert.ok(identity.includes(`${runtime.root}/lib/backend/main.js ${runtime.workspace} --hostname 127.0.0.1 --port ${runtime.port}`));
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/${prefix}-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
const original = await readFile(`${runtime.workspace}/main.js`, 'utf8');
await writeFile(`${runtime.qa}/${prefix}-original-main.js`, original, { flag: 'wx', mode: 0o600 });
const draft = original + '\n// YNX_RECOVERY_CONFLICT_DIRTY\n', newer = original + '\n// YNX_EXTERNAL_NEWER_SAVED_FILE\n';
const untitled = 'YNX_UNTITLED_COLD_RECOVERY\n';
const store = new storeModule.DraftRecoveryStore({ workspace: runtime.workspace, profile: runtime.profile });
const checks = [], errors = []; let context, page, resumed, next;
async function browser() {
  context = await chromium.launchPersistentContext(`${runtime.qa}/crash-cold-confirmed-browser-profile`, { headless: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
  page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
}
async function checkpoint() {
  for (let i = 0; i < 100; i++) {
    const entries = (await store.list()).entries;
    if (entries.some(entry => entry.text === draft) && entries.some(entry => entry.text === untitled)) return;
    await page.waitForTimeout(50);
  }
  throw Error('Both real editor drafts were not checkpointed.');
}
try {
  await browser(); await page.keyboard.press('Meta+p');
  await page.locator('input[placeholder^="Search files by name"]').fill('main.js');
  await page.locator('.quick-input-list').getByText('main.js', { exact: true }).first().click();
  await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().click();
  await page.keyboard.press('Meta+a'); await page.keyboard.insertText(draft);
  await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill('>File: New Untitled Text File');
  await page.locator('.quick-input-list').getByText('File: New Untitled Text File', { exact: true }).first().click();
  await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().click(); await page.keyboard.insertText(untitled);
  await checkpoint(); assert.equal(await readFile(`${runtime.workspace}/main.js`, 'utf8'), original);
  // A competing writer updates only this runner's synthetic saved file. The
  // actual dirty model and its old baseline remain intact for cold recovery.
  await writeFile(`${runtime.workspace}/main.js`, newer); await page.screenshot({ path: `${runtime.qa}/${prefix}-before.png` });
  process.kill(-runtime.pid, 'SIGKILL');
  for (let i = 0; i < 100; i++) { try { process.kill(runtime.pid, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; } await new Promise(ok => setTimeout(ok, 50)); }
  assert.throws(() => process.kill(runtime.pid, 0), { code: 'ESRCH' });
  await context.close(); context = undefined;
  resumed = spawn(process.execPath, [fileURLToPath(new URL('./start-isolated-qa.mjs', import.meta.url)), runtime.plugins, runtime.dapRoot || '', runtime.root, process.argv[2]], { stdio: ['ignore', 'pipe', 'pipe'] });
  resumed.stdout.pipe(process.stdout); resumed.stderr.pipe(process.stderr);
  for (let i = 0; i < 600; i++) {
    if (resumed.exitCode !== null) throw Error(`Resume exited ${resumed.exitCode}`);
    next = JSON.parse(await readFile(process.argv[2], 'utf8'));
    if (next.pid !== runtime.pid) { try { if ((await fetch(runtime.url)).ok) break; } catch {} }
    await new Promise(ok => setTimeout(ok, 100));
  }
  assert.notEqual(next.pid, runtime.pid); await browser();
  await page.locator('.lm-TabBar-tab.theia-mod-dirty').filter({ hasText: 'Recovered-' }).first().waitFor();
  const recovered = page.locator('.lm-TabBar-tab.theia-mod-dirty').filter({ hasText: 'Recovered-' }).first();
  await recovered.click();
  const lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last();
  assert.ok((await lines.innerText()).replaceAll('\u00a0', ' ').includes('YNX_RECOVERY_CONFLICT_DIRTY'));
  assert.equal(await readFile(`${runtime.workspace}/main.js`, 'utf8'), newer);
  checks.push('An externally changed saved file remains byte-exact; the older dirty draft is recovered into a genuine dirty untitled copy.');
  const entries = (await store.list()).entries;
  assert.ok(entries.some(entry => entry.uri.startsWith('untitled:Recovered-') && entry.text === draft));
  assert.ok(entries.some(entry => entry.uri.startsWith('untitled:') && entry.text === untitled));
  const untitledTab = page.locator('.lm-TabBar-tab.theia-mod-dirty').filter({ hasText: /Untitled-/ }).first();
  await untitledTab.click();
  assert.ok((await lines.innerText()).includes('YNX_UNTITLED_COLD_RECOVERY'));
  checks.push('A text file created through the actual New Untitled Text File command survives SIGKILL and cold reopen as dirty unsaved text.');
  await page.screenshot({ path: `${runtime.qa}/${prefix}-after.png` });
} catch (error) { checks.push({ failure: String(error), text: page && !page.isClosed() ? await page.locator('body').innerText() : '' }); process.exitCode = 1; }
finally {
  const receipt = { runtime, resumedRuntime: next, runnerSha256: createHash('sha256').update(bytes).digest('hex'), original, draft, newer, untitled, checks, errors, scope: 'Same owned synthetic project/profile/candidate, real editor and SIGKILL; only this QA saved file receives an intentional competing write. No reseeding, private-account, full-native or release claim.' };
  await writeFile(`${runtime.qa}/${prefix}-browser.json`, JSON.stringify(receipt, null, 2));
  if (context) await context.close(); if (resumed) resumed.kill('SIGTERM'); console.log(JSON.stringify(receipt));
}
