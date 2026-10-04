import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/c-language-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
await writeFile(`${runtime.workspace}/account-c.h`, 'struct AccountBalance { int availableAmount; int reservedAmount; };\n', { flag: 'wx', mode: 0o600 });
await writeFile(`${runtime.workspace}/account-main.c`, '#include "account-c.h"\nint main() { struct AccountBalance account; account. }\n', { flag: 'wx', mode: 0o600 });
const browser = await chromium.launch({ headless: true }), context = await browser.newContext(), checks = [], errors = [];
await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
const lines = () => page.locator('.monaco-editor .view-lines').filter({ visible: true }).last();
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) { assert.ok((await page.locator('body').innerText()).includes(runtime.workspace)); await trust.click(); }
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('account-main.c'); await page.locator('.quick-input-list').getByText('account-main.c', { exact: true }).first().click();
  await page.locator('#theia-statusBar').getByText('C', { exact: true }).waitFor();
  await lines().locator('.view-line').nth(1).click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  let suggestions = '', deadline = Date.now() + 30000;
  while (Date.now() < deadline) { await page.keyboard.press('Escape'); await page.keyboard.press('Control+Space'); await page.waitForTimeout(350); const widget = page.locator('.suggest-widget.visible'); suggestions = await widget.count() ? await widget.innerText() : ''; if (suggestions.includes('availableAmount') && suggestions.includes('reservedAmount')) break; }
  assert.match(suggestions, /availableAmount/); assert.match(suggestions, /reservedAmount/);
  assert.ok(!(await readFile(`${runtime.workspace}/account-main.c`, 'utf8')).includes('availableAmount'));
  checks.push('A real C file uses C mode and Clangd completes struct fields defined only in an unopened header, with no invalid C++ standard flag.');
  await page.keyboard.press('Escape'); await lines().click(); await page.keyboard.press('Meta+a');
  const valid = '#include "account-c.h"\nint main() { struct AccountBalance account; return account.availableAmount; }\n';
  await page.keyboard.insertText(valid); await page.keyboard.press('Meta+s');
  for (let i = 0; i < 120; i++) { if (await readFile(`${runtime.workspace}/account-main.c`, 'utf8') === valid) break; await page.waitForTimeout(50); }
  assert.equal(await readFile(`${runtime.workspace}/account-main.c`, 'utf8'), valid);
  await lines().locator('.view-line').nth(1).click(); await page.keyboard.press('Meta+ArrowLeft');
  for (let i = 0; i < valid.split('\n')[1].indexOf('availableAmount') + 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('F12'); await lines().filter({ hasText: /struct.*AccountBalance.*reservedAmount/ }).waitFor();
  checks.push('F12 on a C member expression opens the real field declaration in its header.');
  assert.deepEqual(errors, []); await page.screenshot({ path: `${runtime.qa}/c-language.png` });
} catch (e) { checks.push({ failure: String(e), text: await page.locator('body').innerText() }); process.exitCode = 1; }
finally { const receipt = { runtime, runnerSha256: createHash('sha256').update(bytes).digest('hex'), checks, errors, scope: 'Actual installed Clangd, standard VS Code language client and real isolated editor. Own C project fixture; not canonical identity, debugger, all-platform or all-language acceptance.' }; await writeFile(`${runtime.qa}/c-language-browser.json`, JSON.stringify(receipt, null, 2)); await browser.close(); console.log(JSON.stringify(receipt)); }
