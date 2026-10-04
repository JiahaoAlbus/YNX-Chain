import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
assert.ok(!(await readdir(runtime.plugins)).includes('vscode.typescript-language-features-1.95.3'), 'Language service must be absent from staged built-ins.');
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/user-extension-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
const vsixSha256 = createHash('sha256').update(await readFile(`${runtime.workspace}/language.vsix`)).digest('hex');
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
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true });
  if (await trust.count()) await trust.click();
}
async function command(name) {
  await page.keyboard.press('Escape'); await page.keyboard.press('F1');
  await page.locator('.quick-input-box input').fill(`>${name}`);
  await page.locator('.quick-input-list').getByText(name, { exact: true }).first().click();
}
async function languageDetail() {
  await command('Extensions: Show Installed Extensions');
  await page.getByText(/^(TypeScript and JavaScript Language Features \(built-in\)|vscode\.typescript-language-features)$/).filter({ visible: true }).first().dblclick();
}
async function menu(name) {
  await page.locator('.codicon-settings-gear').filter({ visible: true }).last().click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
async function reloadAfterChange() {
  const reload = page.getByRole('button', { name: 'Reload Window', exact: true }).filter({ visible: true }).last();
  await reload.waitFor();
  await Promise.all([page.waitForEvent('domcontentloaded'), reload.click()]);
  await ready();
}
async function openMain() {
  await page.keyboard.press('Meta+p');
  await page.locator('input[placeholder^="Search files by name"]').fill('main.js');
  await page.locator('.quick-input-list').getByText('main.js', { exact: true }).first().click();
  await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().click();
}
async function completion() {
  await openMain(); await page.keyboard.press('Meta+a');
  await page.keyboard.insertText('import { wallet } from "./wallet-model.js";\nwallet.');
  let suggestions = '';
  for (let attempt = 0; attempt < 60; attempt++) {
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+Space');
    await page.waitForTimeout(500);
    const widget = page.locator('.suggest-widget.visible');
    suggestions = await widget.count() ? await widget.innerText() : '';
    if (suggestions.includes('address') && suggestions.includes('balance')) break;
  }
  assert.match(suggestions, /address/); assert.match(suggestions, /balance/);
  await page.keyboard.press('Escape');
}
async function save(expected) {
  await page.keyboard.press('Meta+s');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await readFile(`${runtime.workspace}/main.js`, 'utf8') === expected) return;
    await page.waitForTimeout(50);
  }
  assert.equal(await readFile(`${runtime.workspace}/main.js`, 'utf8'), expected);
}
function pass(text) { checks.push(text); console.log(text); }
try {
  await page.goto(runtime.url); await ready();
  await command('Extensions: Install from VSIX...');
  await page.getByRole('button', { name: 'Install from VSIX', exact: true }).waitFor();
  await page.getByText('language.vsix', { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Install from VSIX', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Completed installing extension.'));
  await page.reload(); await ready(); await completion();
  pass('Actual local VSIX install of the cached official TypeScript/JavaScript service supplies imported-file semantic completion through the user extension host.');
  await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.keyboard.type('(');
  await save('()'); await page.keyboard.type('"'); await save('("")');
  await page.keyboard.press('Meta+a'); await page.keyboard.insertText('const installedExtensionMarker = "YNX user extension";\n');
  await save('const installedExtensionMarker = "YNX user extension";\n');
  await page.keyboard.press('Meta+w'); await openMain();
  assert.match(await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().innerText(), /installedExtensionMarker/);
  pass('Real typing pairs brackets/quotes, saves disk content and reopens the saved file after local extension installation.');
  await languageDetail(); await menu('Disable'); await reloadAfterChange(); await languageDetail();
  await page.getByText('Disabled', { exact: true }).filter({ visible: true }).first().waitFor();
  const disabled = JSON.parse(await readFile(`${runtime.profile}/backend-settings.json`, 'utf8'));
  assert.match(disabled['installedPlugins.disabledPlugins'], /vscode\.typescript-language-features/);
  await menu('Enable');
  await reloadAfterChange(); await completion();
  pass('Actual installed language extension disables persistently, then enables and restores imported-file completion after reload.');
  await page.keyboard.press('Meta+a'); await page.keyboard.insertText('const retainedAfterUninstall = "YNX project retained";\n');
  await save('const retainedAfterUninstall = "YNX project retained";\n');
  await languageDetail(); await page.getByRole('button', { name: 'Uninstall', exact: true }).last().click();
  await reloadAfterChange(); await command('Extensions: Show Installed Extensions');
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('[id="vsx-extensions:installed"]').getByText(/^(TypeScript and JavaScript Language Features \(built-in\)|vscode\.typescript-language-features)$/).filter({ visible: true }).count(), 0);
  assert.equal(await readFile(`${runtime.workspace}/main.js`, 'utf8'), 'const retainedAfterUninstall = "YNX project retained";\n');
  await openMain();
  assert.match(await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().innerText(), /retainedAfterUninstall/);
  pass('Actual user-extension uninstall removes the installed service after reload and preserves/reopens the project file.');
  assert.deepEqual(errors, []);
  const receipt = { runtime, runnerSha256: createHash('sha256').update(bytes).digest('hex'), vsixSha256, checks, errors, scope: 'Cached official VSIX, staged built-ins excluding this language service, actual local user installation lifecycle. Not online marketplace access or universal extension compatibility.' };
  await writeFile(`${runtime.qa}/user-extension-browser.json`, JSON.stringify(receipt, null, 2));
  await page.screenshot({ path: `${runtime.qa}/user-extension-final.png` });
  console.log(JSON.stringify(receipt));
} catch (error) {
  await writeFile(`${runtime.qa}/user-extension-failure.json`, JSON.stringify({ checks, errors, failure: String(error), text: await page.locator('body').innerText() }, null, 2));
  await page.screenshot({ path: `${runtime.qa}/user-extension-failure.png` });
  throw error;
} finally { await browser.close(); }
