import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.profile, runtime.qa + '/profile'); assert.equal(runtime.workspace, runtime.qa + '/project');
const runner = await readFile(fileURLToPath(import.meta.url));
await writeFile(runtime.qa + '/user-keybindings-runner.mjs', runner, { flag: 'wx', mode: 0o600 });
await writeFile(runtime.workspace + '/keymap-target.js', 'const alpha = 41;\nconsole.log(alpha);\n', { flag: 'wx', mode: 0o600 });
await assert.rejects(readFile(runtime.profile + '/keybindings.json'), { code: 'ENOENT' });
const browser = await chromium.launch({ headless: true }), page = await browser.newPage(), checks = [], errors = [];
await page.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(30000);
async function command(label) { await page.keyboard.press('Escape'); await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill('>' + label); await page.locator('.quick-input-list').getByText(label, { exact: true }).first().click(); }
async function target() {
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('keymap-target.js'); await page.locator('.quick-input-list').getByText('keymap-target.js', { exact: true }).first().click();
  const lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last(); await lines.waitFor(); await lines.locator('.view-line').first().click(); await page.keyboard.press('Meta+ArrowLeft'); for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
}
async function editKeys(text) {
  await command('Preferences: Open Keyboard Shortcuts (JSON)');
  const lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last(); await lines.click(); await page.keyboard.press('Meta+a'); await page.keyboard.insertText(text); await page.keyboard.press('Meta+s');
  for (let i = 0; i < 200; i++) { try { if (await readFile(runtime.profile + '/keybindings.json', 'utf8') === text) return; } catch {} await page.waitForTimeout(50); }
  assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), text);
}
async function customPicker() { await target(); await page.keyboard.press('F6'); await page.waitForFunction(() => document.querySelector('.quick-input-box input')?.value === 'debug '); await page.locator('.quick-input-list').getByText('YNX JavaScript reference', { exact: true }).waitFor(); await page.keyboard.press('Escape'); }
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) { assert.ok((await page.locator('body').innerText()).includes(runtime.workspace)); await trust.click(); }
  const keys = '// JSONC user shortcuts\n' + JSON.stringify([
    { key: 'f6', command: 'workbench.action.debug.selectandstart', when: 'editorTextFocus' },
    { key: 'cmd+k cmd+y', command: 'workbench.action.quickOpen' },
    { key: 'f2', command: '-editor.action.rename' },
    { key: 'f7', command: 'editor.action.rename', when: 'editorTextFocus' },
  ]) .replace(/]$/, ',]');
  await editKeys(keys); await page.waitForTimeout(500); await customPicker();
  checks.push('Normal JSON shortcuts command creates the own profile file; saved JSONC comments/trailing commas hot-apply F6 with editorTextFocus and invoke the real debug selection command.');
  await target(); await page.keyboard.press('Meta+k'); await page.keyboard.press('Meta+y'); await page.locator('input[placeholder^="Search files by name"]').waitFor(); await page.keyboard.press('Escape');
  checks.push('A saved VS Code style cmd+k cmd+y chord opens real Quick Open.');
  await target(); await page.keyboard.press('F2'); await page.waitForTimeout(300); assert.equal(await page.locator('.rename-input').filter({ visible: true }).count(), 0);
  await page.keyboard.press('F7'); await page.locator('.rename-input').filter({ visible: true }).waitFor(); await page.keyboard.press('Escape');
  checks.push('Negative command removes the default F2 rename binding while the custom F7 binding opens the actual rename editor.');
  await editKeys('invalid keyboard shortcuts'); await page.getByText(/Keyboard shortcuts could not be loaded:/).first().waitFor(); await customPicker();
  assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), 'invalid keyboard shortcuts');
  checks.push('Invalid saved JSON reports a warning, preserves its bytes for correction, and keeps the last working custom shortcuts active.');
  await editKeys(keys); await page.waitForTimeout(500); await Promise.all([page.waitForEvent('domcontentloaded'), command('Developer: Reload Window')]); await page.locator('.theia-preload').waitFor({ state: 'hidden' }); await page.locator('#theia-app-shell').waitFor(); await customPicker();
  assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), keys);
  checks.push('Valid shortcuts persist in the own profile and activate again after real Reload Window.');
  await assert.rejects(readFile(runtime.workspace + '/debug-proof.txt'), { code: 'ENOENT' }); assert.deepEqual(errors, []);
  await page.screenshot({ path: runtime.qa + '/user-keybindings.png' });
} catch (e) { checks.push({ failure: String(e), text: await page.locator('body').innerText() }); process.exitCode = 1; }
finally { const result = { runtime, runnerSha256: createHash('sha256').update(runner).digest('hex'), checks, errors, scope: 'Actual controlled Mac editor/profile; no global profile, canonical user, other-platform or public admission claim.' }; await writeFile(runtime.qa + '/user-keybindings-browser.json', JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 }); await browser.close(); console.log(JSON.stringify(result)); }
