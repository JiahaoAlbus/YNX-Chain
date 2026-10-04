import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/user-extension-uninstall-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
const before = await readFile(`${runtime.workspace}/main.js`, 'utf8');
const errors = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', error => errors.push(error.message));
async function ready() { await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' }); }
async function installed() {
  await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill('>Extensions: Show Installed Extensions');
  await page.locator('.quick-input-list').getByText('Extensions: Show Installed Extensions', { exact: true }).click();
}
const label = /^(TypeScript and JavaScript Language Features \(built-in\)|vscode\.typescript-language-features)$/;
try {
  await page.goto(runtime.url); await ready(); await installed();
  await page.getByText(label).filter({ visible: true }).first().dblclick();
  await page.getByRole('button', { name: 'Uninstall', exact: true }).last().click();
  const reload = page.getByRole('button', { name: 'Reload Window', exact: true }).last();
  await reload.waitFor();
  await Promise.all([page.waitForEvent('domcontentloaded'), reload.click()]);
  await ready(); await installed();
  await page.locator('[id="vsx-extensions:installed"]').waitFor();
  assert.equal(await page.locator('[id="vsx-extensions:installed"]').getByText(label).filter({ visible: true }).count(), 0);
  assert.equal(await readFile(`${runtime.workspace}/main.js`, 'utf8'), before);
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('main.js');
  await page.locator('.quick-input-list').getByText('main.js', { exact: true }).first().click();
  await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().waitFor();
  assert.deepEqual(errors, []);
  const receipt = { runtime, runnerSha256: createHash('sha256').update(bytes).digest('hex'), fileSha256: createHash('sha256').update(before).digest('hex'), checks: ['Actual user extension uninstall and recommended window reload remove the installed language service while preserving and reopening the saved project file.'], errors, scope: 'Independent uninstall after the preserved failed enable/reload semantic journey. Does not turn that failure green.' };
  await writeFile(`${runtime.qa}/user-extension-uninstall-browser.json`, JSON.stringify(receipt, null, 2));
  await page.screenshot({ path: `${runtime.qa}/user-extension-uninstall-final.png` });
  console.log(JSON.stringify(receipt));
} catch (error) {
  await writeFile(`${runtime.qa}/user-extension-uninstall-failure.json`, JSON.stringify({ errors, failure: String(error), text: await page.locator('body').innerText() }, null, 2));
  await page.screenshot({ path: `${runtime.qa}/user-extension-uninstall-failure.png` });
  throw error;
} finally { await browser.close(); }
