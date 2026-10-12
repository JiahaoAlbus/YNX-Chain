import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
const prefix = process.argv[3] || 'language-recovery';
assert.match(prefix, /^[a-z-]+$/);
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/${prefix}-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
await writeFile(`${runtime.qa}/${prefix}-original-main.js`, await readFile(`${runtime.workspace}/main.js`), { flag: 'wx', mode: 0o600 });
const phases = [], errors = [], consoleErrors = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
const page = await context.newPage(); page.setDefaultTimeout(30000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
async function ready() { await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' }); }
async function command(name) {
  await page.keyboard.press('Escape'); await page.keyboard.press('F1');
  await page.locator('.quick-input-box input').fill(`>${name}`);
  await page.locator('.quick-input-list').getByText(name, { exact: true }).first().click();
}
async function detail() {
  await command('Extensions: Show Installed Extensions');
  await page.getByText(/^(TypeScript and JavaScript Language Features \(built-in\)|vscode\.typescript-language-features)$/).filter({ visible: true }).first().dblclick();
}
async function menu(name) {
  await page.locator('.codicon-settings-gear').filter({ visible: true }).last().click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
async function probe(label) {
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('main.js');
  await page.locator('.quick-input-list').getByText('main.js', { exact: true }).first().click();
  await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().click();
  await page.keyboard.press('Meta+a'); await page.keyboard.insertText('import { wallet } from "./wallet-model.js";\nwallet.');
  let suggestions = '';
  for (let attempt = 0; attempt < 60; attempt++) {
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+Space'); await page.waitForTimeout(500);
    const widget = page.locator('.suggest-widget.visible'); suggestions = await widget.count() ? await widget.innerText() : '';
    if (suggestions.includes('address') && suggestions.includes('balance')) break;
  }
  const phase = { label, at: new Date().toISOString(), suggestions, semantic: suggestions.includes('address') && suggestions.includes('balance') };
  phases.push(phase); console.log(JSON.stringify(phase)); await page.keyboard.press('Escape');
  await page.screenshot({ path: `${runtime.qa}/${prefix}-${label}.png` });
}
try {
  await page.goto(runtime.url); await ready(); await probe('initial');
  await page.keyboard.press('Meta+a'); await page.keyboard.insertText('const languageRecoveryMarker = "YNX trace";\n'); await page.keyboard.press('Meta+s');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await readFile(`${runtime.workspace}/main.js`, 'utf8') === 'const languageRecoveryMarker = "YNX trace";\n') break;
    await page.waitForTimeout(50);
  }
  assert.equal(await readFile(`${runtime.workspace}/main.js`, 'utf8'), 'const languageRecoveryMarker = "YNX trace";\n');
  await detail(); await menu('Disable');
  const reload = page.getByRole('button', { name: 'Reload Window', exact: true }).last(); await reload.waitFor();
  await Promise.all([page.waitForEvent('domcontentloaded'), reload.click()]); await ready(); await detail(); await menu('Enable');
  await page.getByText('Disabled', { exact: true }).filter({ visible: true }).waitFor({ state: 'hidden' });
  await page.reload(); await ready(); await probe('reenabled');
  if (!phases.at(-1).semantic) { await command('TypeScript: Restart TS Server'); await probe('server-restarted'); }
} catch (error) { phases.push({ failure: String(error), text: await page.locator('body').innerText() }); }
finally {
  const receipt = { runtime, runnerSha256: createHash('sha256').update(bytes).digest('hex'), phases, errors, consoleErrors, scope: 'Diagnostic only: actual cached installed language extension, trace settings on controlled synthetic profile. Failed phases remain failed; an explicit TS server restart is not a complete extension recovery fix.' };
  await writeFile(`${runtime.qa}/${prefix}-browser.json`, JSON.stringify(receipt, null, 2));
  await browser.close(); console.log(JSON.stringify(receipt));
}
