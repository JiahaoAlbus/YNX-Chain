import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, runtime.qa + '/project');
const runner = await readFile(fileURLToPath(import.meta.url));
await writeFile(runtime.qa + '/json-policy-runner.mjs', runner, { flag: 'wx', mode: 0o600 });
const browser = await chromium.launch({ headless: true }), page = await browser.newPage(), errors = [], logs = [];
let report, failure;
page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
await page.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
try {
  await page.goto(runtime.url); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true });
  if (await trust.count()) { assert.ok((await page.locator('body').innerText()).includes(runtime.workspace)); await trust.click(); }
  await page.keyboard.press('Escape'); await page.keyboard.press('F1');
  await page.locator('.quick-input-box input').fill('>YNX JSON QA: Inspect Schema Policy');
  await page.locator('.quick-input-list').getByText('YNX JSON QA: Inspect Schema Policy', { exact: true }).first().click();
  await page.getByText('YNX JSON QA policy inspection complete', { exact: true }).filter({ visible: true }).first().waitFor();
  report = JSON.parse(await readFile(runtime.workspace + '/json-policy-report.json', 'utf8'));
  assert.equal(report.active, true); assert.equal(report.version, '10.0.0'); assert.equal(report.schemaDownload, false);
  assert.ok(report.diagnostics.some(d => /Downloading schemas is disabled/.test(d.message)));
  assert.deepEqual(errors, []);
} catch (e) { failure = String(e); process.exitCode = 1; }
finally {
  const result = { runtime, runnerSha256: createHash('sha256').update(runner).digest('hex'), report, failure, errors, logs, text: await page.locator('body').innerText(), scope: 'Test-only extension invokes the original stock extension API under the unchanged sandbox; no product profile or formal admission.' };
  await writeFile(runtime.qa + '/json-policy-browser.json', JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  await browser.close(); console.log(JSON.stringify(result));
}
