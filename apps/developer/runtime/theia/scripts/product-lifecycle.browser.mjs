import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/product-lifecycle-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
const checks = [], errors = [], stages = [];
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
async function open(name) {
  await page.keyboard.press('Meta+p');
  await page.locator('input[placeholder^="Search files by name"]').fill(name);
  await page.locator('.quick-input-list').getByText(name, { exact: true }).first().click();
}
async function editText(text) {
  await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().click();
  await page.keyboard.press('Meta+a');
  // Exercise real paste rather than typing an entire JSON block with auto-pairs.
  await page.evaluate(text => {
    const container = window.theia.container;
    const token = [...container._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    const control = container.get(token).currentEditor.editor.getControl();
    control.trigger('ynx-qa', 'paste', { text, pasteOnNewLine: false, multicursorText: null });
  }, text);
  await page.keyboard.press('Meta+s');
}
async function disk(path, expected) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if (await readFile(path, 'utf8') === expected) return; } catch {}
    await page.waitForTimeout(50);
  }
  assert.equal(await readFile(path, 'utf8'), expected);
}
function passed(text) { checks.push(text); console.log(text); }
try {
  await page.goto(runtime.url); await ready();
  stages.push('settings');
  await command('Preferences: Open Settings (JSON)');
  await page.locator('.monaco-editor .view-lines').filter({ hasText: 'trustedFolders' }).waitFor();
  const preferences = JSON.parse(await readFile(`${runtime.profile}/settings.json`, 'utf8'));
  preferences['editor.fontSize'] = 17;
  preferences['[javascript]'] = { 'editor.tabSize': 2 };
  const text = JSON.stringify(preferences, null, 2) + '\n';
  await editText(text);
  for (let attempt = 0; attempt < 120; attempt++) {
    if (JSON.parse(await readFile(`${runtime.profile}/settings.json`, 'utf8'))['editor.fontSize'] === 17) break;
    await page.waitForTimeout(50);
  }
  assert.deepEqual(JSON.parse(await readFile(`${runtime.profile}/settings.json`, 'utf8')), preferences);
  await page.keyboard.press('Meta+w'); await open('main.js');
  await page.waitForFunction(() => [...document.querySelectorAll('.monaco-editor .view-line')].some(node => getComputedStyle(node).fontSize === '17px'));
  await page.locator('#theia-statusBar').filter({ hasText: 'Spaces: 2' }).waitFor();
  await page.reload(); await ready(); await open('main.js');
  await page.waitForFunction(() => [...document.querySelectorAll('.monaco-editor .view-line')].some(node => getComputedStyle(node).fontSize === '17px'));
  await page.locator('#theia-statusBar').filter({ hasText: 'Spaces: 2' }).waitFor();
  passed('Actual user font setting and JavaScript-specific tab size save to the isolated profile and survive workbench reload.');
  stages.push('files');
  await command('File: New Folder...');
  await page.getByPlaceholder('Folder Name', { exact: true }).fill('开发文件');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByPlaceholder('Folder Name', { exact: true }).waitFor({ state: 'hidden' });
  assert.ok((await stat(`${runtime.workspace}/开发文件`)).isDirectory());
  await page.keyboard.press('Meta+Shift+e');
  await page.getByText('开发文件', { exact: true }).first().click();
  await open('main.js');
  await command('File: New File...');
  await page.getByPlaceholder('File Name', { exact: true }).fill('开发文件/合约.ynxnotes');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByPlaceholder('File Name', { exact: true }).waitFor({ state: 'hidden' });
  await page.locator('.lm-TabBar-tab.lm-mod-current').filter({ hasText: '合约.ynxnotes' }).waitFor();
  const note = 'YNX_MULTI_FILE_SEARCH_20261004\n用户自己的文件\n';
  await editText(note); await disk(`${runtime.workspace}/开发文件/合约.ynxnotes`, note);
  await open('main.js'); await editText('const marker = "YNX_MULTI_FILE_SEARCH_20261004";\n');
  await disk(`${runtime.workspace}/main.js`, 'const marker = "YNX_MULTI_FILE_SEARCH_20261004";\n');
  await page.keyboard.press('Meta+Shift+f');
  const search = page.locator('#search-input-field');
  await page.locator('.search-field-container.focused').waitFor();
  // The command awaits openView before copying the current editor selection
  // into the field. Let that initial update finish before entering our query.
  await page.waitForTimeout(250);
  await search.fill('YNX_MULTI_FILE_SEARCH_20261004'); await search.press('ArrowRight');
  await page.waitForTimeout(600); // framework's key-up search debounce
  await search.press('Enter');
  console.log('workspace search input', await search.inputValue());
  await page.waitForFunction(() => document.body.innerText.includes('合约.ynxnotes') && /2 results in 2 files/i.test(document.body.innerText));
  await page.screenshot({ path: `${runtime.qa}/product-multifile-search.png` });
  passed('Actual Explorer creates a Unicode folder and arbitrary-suffix file; edits save to disk and workspace search finds both real files.');
  stages.push('extensions');
  await command('Extensions: Show Built-in Extensions');
  await page.getByText(/^(YNX Tools|ynx\.ynx-tools)$/).filter({ visible: true }).first().dblclick();
  await page.locator('.codicon-settings-gear').filter({ visible: true }).last().click();
  await page.getByRole('menuitem', { name: 'Disable', exact: true }).click();
  await Promise.all([page.waitForEvent('domcontentloaded'), page.getByRole('button', { name: 'Reload Window', exact: true }).last().click()]);
  await ready(); await command('Extensions: Show Built-in Extensions');
  await page.getByText(/^(YNX Tools|ynx\.ynx-tools)$/).filter({ visible: true }).first().dblclick();
  await page.getByText('Disabled', { exact: true }).filter({ visible: true }).first().waitFor();
  await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill('>YNX: Create Read-only Testnet SDK Starter');
  await page.locator('.quick-input-widget').filter({ hasText: '0 Results' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.codicon-settings-gear').filter({ visible: true }).last().click();
  await page.getByRole('menuitem', { name: 'Enable', exact: true }).click();
  await page.reload();
  await ready(); await command('YNX: Create Read-only Testnet SDK Starter');
  if (runtime.fixtureSessionId) {
    await page.getByText(/^Create the read-only YNX Testnet SDK starter at /).filter({ visible: true }).waitFor();
    await page.keyboard.press('Escape');
  } else {
    await page.waitForFunction(() => document.body.innerText.includes('Create this starter from an active YNX project runtime.'));
  }
  await assert.rejects(readFile(`${runtime.workspace}/ynx-testnet-readonly.mjs`), { code: 'ENOENT' });
  passed('Actual YNX Tools disables and removes commands after Reload Window, then enables and reactivates after another reload; Chain starter cancellation (controlled locator) or unbound refusal preserves files; no canonical identity is granted.');
  assert.deepEqual(errors, []);
  const receipt = { runtime, runnerSha256: createHash('sha256').update(bytes).digest('hex'), checks, errors, scope: 'Real isolated runtime/profile reload. No canonical Wallet authentication, admitted public driver, user-extension install, backend restart or multi-owner capacity acceptance.' };
  await writeFile(`${runtime.qa}/product-lifecycle-browser.json`, JSON.stringify(receipt, null, 2));
  await page.screenshot({ path: `${runtime.qa}/product-lifecycle-final.png` });
  console.log(JSON.stringify(receipt));
} catch (error) {
  const receipt = { checks, errors, stages, failure: String(error), text: await page.locator('body').innerText() };
  await writeFile(`${runtime.qa}/product-lifecycle-failure.json`, JSON.stringify(receipt, null, 2));
  await page.screenshot({ path: `${runtime.qa}/product-lifecycle-failure.png` });
  console.error(JSON.stringify(receipt)); throw error;
} finally { await browser.close(); }
