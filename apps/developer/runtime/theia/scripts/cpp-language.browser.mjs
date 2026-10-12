import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
const prefix = process.argv[3] || 'cpp-language'; assert.match(prefix, /^[a-z-]+$/);
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/${prefix}-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
async function retainOrCreate(path, text) {
  try { await writeFile(path, text, { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; assert.equal(await readFile(path, 'utf8'), text, 'Preserve existing changed fixtures.'); }
}
const header = 'struct WalletBalance { int confirmedBalance; int pendingBalance; };\ninline int totalBalance(const WalletBalance &wallet) { return wallet.confirmedBalance + wallet.pendingBalance; }\n';
await retainOrCreate(`${runtime.workspace}/wallet.hpp`, header);
await retainOrCreate(`${runtime.workspace}/wallet-main.cpp`, '#include "wallet.hpp"\nint main() {\n  WalletBalance wallet;\n  wallet.\n}\n');
await retainOrCreate(`${runtime.workspace}/.clang-format`, 'BasedOnStyle: LLVM\nIndentWidth: 2\n');
const browser = await chromium.launch({ headless: true }), context = await browser.newContext(), checks = [], errors = [];
await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
const lines = () => page.locator('.monaco-editor .view-lines').filter({ visible: true }).last();
async function command(name) { await page.keyboard.press('Escape'); await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill(`>${name}`); await page.locator('.quick-input-list').getByText(name, { exact: true }).first().click(); }
async function open(name) { await page.keyboard.press('Escape'); await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill(name); await page.locator('.quick-input-list').getByText(name, { exact: true }).first().click(); await lines().waitFor(); }
async function saved(name, predicate) { for (let i = 0; i < 120; i++) { const text = await readFile(`${runtime.workspace}/${name}`, 'utf8'); if (predicate(text)) return text; await page.waitForTimeout(50); } throw Error(`Save did not complete: ${name}`); }
async function edit(text) { await lines().click(); await page.keyboard.press('Meta+a'); await page.keyboard.insertText(text); await page.keyboard.press('Meta+s'); await saved('wallet-main.cpp', t => t === text); }
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true });
  if (await trust.count()) { assert.ok((await page.locator('body').innerText()).includes(runtime.workspace)); await trust.click(); }
  await open('wallet-main.cpp');
  await page.locator('#theia-statusBar').filter({ hasText: 'C++' }).waitFor();
  checks.push('Real .cpp files select C++ language mode and the installed upstream syntax contribution.');
  await lines().locator('.view-line').nth(3).click(); await page.keyboard.press('Meta+ArrowRight');
  let suggestions = '', deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+Space'); await page.waitForTimeout(350);
    const widget = page.locator('.suggest-widget.visible'); suggestions = await widget.count() ? await widget.innerText() : '';
    if (suggestions.includes('confirmedBalance') && suggestions.includes('pendingBalance')) break;
  }
  assert.match(suggestions, /confirmedBalance/); assert.match(suggestions, /pendingBalance/);
  assert.ok(!(await readFile(`${runtime.workspace}/wallet-main.cpp`, 'utf8')).includes('confirmedBalance'));
  checks.push('Actual installed Clangd and standard VS Code language client complete fields from an unopened header, absent from the active file.');
  await page.keyboard.press('Escape');
  const valid = '#include "wallet.hpp"\nint main(){WalletBalance wallet{2,3};return totalBalance(wallet);}\n';
  await edit(valid);
  await lines().locator('.view-line').nth(1).click(); await page.keyboard.press('Meta+ArrowLeft');
  for (let i = 0; i < valid.split('\n')[1].indexOf('totalBalance') + 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('F12');
  await lines().filter({ hasText: /inline.*totalBalance/ }).waitFor();
  checks.push('F12 resolves the call to its actual definition in wallet.hpp through Clangd.');
  await lines().locator('.view-line').nth(1).click(); await page.keyboard.press('Meta+ArrowLeft');
  for (let i = 0; i < header.split('\n')[1].indexOf('totalBalance') + 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('F2'); const rename = page.locator('.rename-box input'); await rename.waitFor(); await rename.fill('sumBalance'); await rename.press('Enter');
  await command('File: Save All');
  await saved('wallet.hpp', t => t.includes('sumBalance') && !t.includes('totalBalance'));
  await saved('wallet-main.cpp', t => t.includes('sumBalance') && !t.includes('totalBalance'));
  checks.push('F2 and Save All apply the real cross-file semantic rename to both the header definition and source reference.');
  await open('wallet-main.cpp'); await page.keyboard.press('Shift+Alt+f');
  await lines().filter({ hasText: /int\s+main\(\)\s+\{/ }).waitFor(); await page.keyboard.press('Meta+s');
  const formatted = await saved('wallet-main.cpp', t => /int main\(\) \{\n/.test(t)); assert.match(formatted, /  WalletBalance wallet/);
  checks.push('Normal Format Document uses Clangd and the project .clang-format, then saves the real source bytes.');
  await edit('int main() { return YNX_UNDECLARED_CPP; }\n');
  const marker = page.locator('.monaco-editor .squiggly-error').filter({ visible: true }).first(); await marker.waitFor();
  const box = await marker.boundingBox(); assert.ok(box); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByText(/undeclared identifier.*YNX_UNDECLARED_CPP/i).filter({ visible: true }).first().waitFor();
  checks.push('Real language-server diagnostics mark the saved C++ error and show its exact identifier, without executing a build task.');
  await page.screenshot({ path: `${runtime.qa}/${prefix}-diagnostic.png` });
  await page.keyboard.press('Escape'); await edit(valid.replace('totalBalance', 'sumBalance'));
  await page.keyboard.press('Shift+Alt+f');
  await lines().filter({ hasText: /int\s+main\(\)\s+\{/ }).waitFor(); await page.keyboard.press('Meta+s');
  await saved('wallet-main.cpp', t => /int main\(\) \{\n/.test(t) && t.includes('sumBalance') && !t.includes('YNX_UNDECLARED_CPP'));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${runtime.qa}/${prefix}.png` });
} catch (e) { checks.push({ failure: String(e), text: await page.locator('body').innerText() }); process.exitCode = 1; }
finally { const result = { runtime, runnerSha256: createHash('sha256').update(bytes).digest('hex'), checks, errors, scope: 'Actual isolated Theia editor, standard MIT VS Code language client and installed Apple Clangd. Synthetic own project; not canonical identity, all languages, C++ debugger or other-platform acceptance.' }; await writeFile(`${runtime.qa}/${prefix}-browser.json`, JSON.stringify(result, null, 2)); await browser.close(); console.log(JSON.stringify(result)); }
