import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.profile, runtime.qa + '/profile'); assert.equal(runtime.workspace, runtime.qa + '/project');
const runner = await readFile(fileURLToPath(import.meta.url));
await writeFile(runtime.qa + '/workspace-keybindings-runner.mjs', runner, { flag: 'wx', mode: 0o600 });
await writeFile(runtime.workspace + '/keymap-target.js', 'const alpha = 41;\nconsole.log(alpha);\n', { flag: 'wx', mode: 0o600 });
const initial = '// retained user comment\n[\n {"key":"f8","command":"editor.action.rename","when":"editorTextFocus"},\n]\n';
await writeFile(runtime.profile + '/keybindings.json', initial, { flag: 'wx', mode: 0o600 });
const browser = await chromium.launch({ headless: true }), page = await browser.newPage(), checks = [], errors = [];
await page.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(30000);
const widget = page.locator('#ynx-keyboard-shortcuts');
async function command(label) {
  await page.keyboard.press('Escape'); await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill('>' + label);
  const exactLabel = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  await page.locator('.quick-input-list .label-name').filter({ hasText: exactLabel }).filter({ visible: true }).first().click();
  await page.locator('.quick-input-box input').waitFor({ state: 'hidden' });
}
async function shortcuts(id) {
  await command('Preferences: Open Keyboard Shortcuts'); await widget.waitFor();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#ynx-keyboard-shortcuts input[type="search"]'));
  await widget.getByRole('searchbox').fill('@command:' + id);
}
function row(id, key, source) {
  let result = widget.locator(`tbody tr[data-command="${id}"]`);
  if (key) result = result.filter({ has: page.locator('kbd', { hasText: new RegExp('^' + key + '$') }) });
  if (source) result = result.filter({ has: page.locator('td', { hasText: new RegExp('^' + source + '$') }) });
  return result.first();
}
async function target() {
  await page.keyboard.press('Escape');
  const existing = page.locator('.monaco-editor .view-lines').filter({ visible: true }); if (await existing.count()) await existing.last().click();
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('keymap-target.js');
  await page.locator('.quick-input-list').getByText('keymap-target.js', { exact: true }).filter({ visible: true }).first().click();
  await page.locator('.quick-input-box input').waitFor({ state: 'hidden' });
  const lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last(); await lines.locator('.view-line').first().click();
  await page.keyboard.press('Meta+ArrowLeft'); for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
}
async function saved() { await page.getByRole('dialog').waitFor({ state: 'hidden' }); await widget.getByRole('status').filter({ hasText: 'Keyboard shortcuts saved.' }).waitFor(); }
async function rename(key, present) {
  await target(); await page.keyboard.press(key);
  if (present) { await page.locator('.rename-input').filter({ visible: true }).waitFor(); await page.keyboard.press('Escape'); }
  else { await page.waitForTimeout(250); assert.equal(await page.locator('.rename-input').filter({ visible: true }).count(), 0); }
}
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) { assert.ok((await page.locator('body').innerText()).includes(runtime.workspace)); await trust.click(); }
  await rename('F8', true);
  await shortcuts('editor.action.rename'); await widget.getByRole('combobox', { name: 'Save shortcuts in', exact: true }).selectOption('Workspace');
  await row('editor.action.rename', 'f8', 'User').getByRole('button', { name: 'Edit', exact: true }).click();
  let dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: 'Shortcut', exact: true }).fill('f9');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await saved();
  const projectFile = runtime.workspace + '/.vscode/keybindings.json';
  assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), initial);
  let projectText = await readFile(projectFile, 'utf8'); assert.ok(projectText.includes('"-editor.action.rename"')); assert.ok(projectText.includes('"f9"'));
  await rename('F8', false); await rename('F9', true);
  checks.push('Selecting This project and editing an existing user shortcut creates .vscode/keybindings.json, removes the lower user binding only in this project, activates F9 and leaves exact user bytes unchanged.');
  await shortcuts('editor.action.rename'); await row('editor.action.rename', 'f9', 'Workspace').getByRole('button', { name: 'Reset', exact: true }).click();
  await widget.getByRole('status').filter({ hasText: 'Keyboard shortcuts saved.' }).waitFor(); await rename('F8', true); await rename('F9', false);
  assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), initial);
  checks.push('Project Reset removes only project overrides/tombstones and restores the real user shortcut, preserving user settings.');
  await shortcuts('workbench.action.quickOpen'); await row('workbench.action.quickOpen').getByRole('button', { name: 'Add', exact: true }).click();
  dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: 'Shortcut', exact: true }).fill('f8'); await dialog.getByRole('textbox', { name: 'When', exact: true }).fill('editorTextFocus');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await saved();
  await target(); await page.keyboard.press('F8'); await page.locator('input[placeholder^="Search files by name"]').waitFor(); assert.equal(await page.locator('.rename-input').filter({ visible: true }).count(), 0); await page.keyboard.press('Escape');
  projectText = await readFile(projectFile, 'utf8');
  await Promise.all([page.waitForEvent('domcontentloaded'), command('Developer: Reload Window')]); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  await target(); await page.keyboard.press('F8'); await page.locator('input[placeholder^="Search files by name"]').waitFor(); await page.keyboard.press('Escape');
  assert.equal(await readFile(projectFile, 'utf8'), projectText); assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), initial);
  checks.push('A project binding wins over the same user key and remains active after a real Reload Window; both exact configuration files persist.');
  await shortcuts('workbench.action.quickOpen'); await widget.getByRole('combobox', { name: 'Save shortcuts in', exact: true }).selectOption('Workspace');
  await row('workbench.action.quickOpen', 'f8', 'Workspace').getByRole('button', { name: 'Edit', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Shortcut', exact: true }).fill('f10'); const external = projectText + '// external project comment\n'; await writeFile(projectFile, external); await page.waitForTimeout(300);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await dialog.getByRole('alert').filter({ hasText: /changed on disk/ }).waitFor(); assert.equal(await readFile(projectFile, 'utf8'), external); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  checks.push('An external project edit while its dialog is open refuses the stale save and retains exact external bytes.');
  await command('Preferences: Open Project Keyboard Shortcuts (JSON)');
  const lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last(); await lines.click(); await page.keyboard.press('Meta+a'); await page.keyboard.insertText('// own unsaved project draft\n[]');
  await shortcuts('workbench.action.quickOpen'); await row('workbench.action.quickOpen', 'f8', 'Workspace').getByRole('button', { name: 'Edit', exact: true }).click(); dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: 'Shortcut', exact: true }).fill('f10');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await dialog.getByRole('alert').filter({ hasText: /unsaved changes/ }).waitFor(); assert.equal(await readFile(projectFile, 'utf8'), external); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  checks.push('An actual unsaved project JSON draft blocks graphical writes without changing the disk configuration.');
  await command('Preferences: Open Project Keyboard Shortcuts (JSON)'); await lines.click(); await page.keyboard.press('Meta+a'); await page.keyboard.insertText('invalid project shortcuts'); await page.keyboard.press('Meta+s');
  for (let i = 0; i < 100 && await readFile(projectFile, 'utf8') !== 'invalid project shortcuts'; i++) await page.waitForTimeout(50);
  await command('Preferences: Open Keyboard Shortcuts'); await widget.getByRole('button', { name: 'Refresh', exact: true }).click(); await widget.getByRole('status').filter({ hasText: /valid keyboard shortcuts array/ }).waitFor();
  await target(); await page.keyboard.press('F8'); await page.locator('input[placeholder^="Search files by name"]').waitFor(); await page.keyboard.press('Escape'); assert.equal(await readFile(projectFile, 'utf8'), 'invalid project shortcuts');
  checks.push('Malformed project JSON remains available for correction and retains the last valid project keymap.');
  await writeFile(projectFile, external); await page.waitForTimeout(300); await shortcuts('workbench.action.quickOpen'); await row('workbench.action.quickOpen', 'f8', 'Workspace').getByRole('button', { name: 'Remove', exact: true }).click(); await widget.getByRole('status').filter({ hasText: 'Keyboard shortcuts saved.' }).waitFor();
  await rename('F8', true); assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), initial);
  checks.push('Removing the project override restores the actual user binding and leaves its original file unchanged.');
  assert.deepEqual(errors, []); await page.screenshot({ path: runtime.qa + '/workspace-keybindings.png' });
} catch (error) { checks.push({ failure: String(error), text: await page.locator('body').innerText() }); await page.screenshot({ path: runtime.qa + '/workspace-keybindings-failure.png' }); process.exitCode = 1; }
finally {
  const result = { runtime, runnerSha256: createHash('sha256').update(runner).digest('hex'), checks, errors, scope: 'Actual project/user/default precedence, GUI, keyboard and saved files in one controlled local Mac project; not canonical or other-platform acceptance.' };
  await writeFile(runtime.qa + '/workspace-keybindings-browser.json', JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 }); await browser.close(); console.log(JSON.stringify(result));
}
