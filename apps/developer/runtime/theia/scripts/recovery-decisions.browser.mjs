import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const prefix = process.argv[3] || 'recovery-decisions';
assert.match(prefix, /^[a-z-]+$/);
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/${prefix}-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
const checks = [], errors = [];
const context = await chromium.launchPersistentContext(`${runtime.qa}/crash-cold-confirmed-browser-profile`, { headless: true });
await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
const page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(30000);
page.on('pageerror', error => errors.push(error.message));
async function open(name) {
  await page.keyboard.press('Escape'); await page.keyboard.press('Meta+p');
  const input = page.locator('input[placeholder^="Search files by name"]'); await input.fill(name);
  await page.locator('.quick-input-list').getByText(name, { exact: true }).first().click();
  const lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last(); await lines.click(); return lines;
}
async function checkpoint(uri, present) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const snapshots = [];
    for (const slot of ['a', 'b']) {
      try {
        const envelope = JSON.parse(await readFile(`${runtime.profile}/ynx-draft-recovery-v1/${slot}.json`, 'utf8'));
        assert.equal(envelope.sha256, createHash('sha256').update(JSON.stringify(envelope.data)).digest('hex'));
        snapshots.push(envelope.data);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    snapshots.sort((a, b) => b.generation - a.generation);
    if (snapshots.length && snapshots[0].entries.some(entry => entry.uri === uri) === present) return;
    await page.waitForTimeout(50);
  }
  throw Error(`Checkpoint ${present ? 'retained' : 'retired'} state missing for ${uri}`);
}
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const previous = JSON.parse(await readFile(`${runtime.qa}/crash-cold-confirmed-browser.json`, 'utf8'));
  const main = `${runtime.workspace}/main.js`, uri = pathToFileURL(main).href;
  const lines = await open('main.js');
  assert.match((await lines.innerText()).replaceAll('\u00a0', ' '), /YNX_CRASH_UNSAVED_DRAFT_20261004/);
  await page.keyboard.press('Meta+s');
  for (let i = 0; i < 100 && await readFile(main, 'utf8') !== previous.draft; i++) await page.waitForTimeout(50);
  assert.equal(await readFile(main, 'utf8'), previous.draft); await checkpoint(uri, false);
  checks.push('Saving the genuinely recovered dirty draft writes its exact contents and retires its recovery record.');
  await lines.click(); await page.keyboard.press('Meta+a');
  await page.keyboard.insertText(previous.draft + '\n// YNX_DISCARD_RECOVERY_DECISION\n');
  await checkpoint(uri, true); await page.keyboard.press('Meta+w');
  await page.getByRole('button', { name: /Don.t Save|Do not Save/i }).click();
  await checkpoint(uri, false); assert.equal(await readFile(main, 'utf8'), previous.draft);
  checks.push('Actual dirty-close Don\u2019t Save preserves saved disk contents and retires the discarded checkpoint.');
  await page.reload(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const reopened = await open('main.js');
  assert.ok(!(await reopened.innerText()).includes('YNX_DISCARD_RECOVERY_DECISION'));
  assert.equal(await page.locator('.lm-TabBar-tab.theia-mod-dirty').filter({ hasText: 'main.js' }).count(), 0);
  checks.push('Reload and Quick Open do not resurrect the explicitly discarded draft.');
  await page.screenshot({ path: `${runtime.qa}/${prefix}.png` });
} catch (error) { checks.push({ failure: String(error), text: await page.locator('body').innerText() }); process.exitCode = 1; }
finally {
  const receipt = { runtime, runnerSha256: createHash('sha256').update(bytes).digest('hex'), checks, errors, scope: 'Same existing synthetic project, immutable candidate and persistent browser/profile after hard-crash recovery. Exact saved bytes and genuine user discard; no reseeding or authenticated/native-release claim.' };
  await writeFile(`${runtime.qa}/${prefix}-browser.json`, JSON.stringify(receipt, null, 2));
  await context.close(); console.log(JSON.stringify(receipt));
}
