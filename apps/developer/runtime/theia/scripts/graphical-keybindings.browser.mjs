import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.profile, runtime.qa + '/profile'); assert.equal(runtime.workspace, runtime.qa + '/project');
const runner = await readFile(fileURLToPath(import.meta.url));
await writeFile(runtime.qa + '/graphical-keybindings-runner.mjs', runner, { flag: 'wx', mode: 0o600 });
await writeFile(runtime.workspace + '/keymap-target.js', 'const alpha = 41;\nconsole.log(alpha);\n', { flag: 'wx', mode: 0o600 });
const initial = '// retained user comment\n[\n  // unrelated command\n  { "key": "f6", "command": "workbench.action.debug.selectandstart", "when": "editorTextFocus", "args": {"keep": true} },\n]\n';
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
  await shortcuts('editor.action.rename');
  await row('editor.action.rename', 'f2', 'Default').getByRole('button', { name: 'Edit', exact: true }).click();
  let dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: 'Shortcut', exact: true }).fill('f8');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await saved();
  let text = await readFile(runtime.profile + '/keybindings.json', 'utf8');
  assert.ok(text.includes('// retained user comment')); assert.ok(text.includes('// unrelated command')); assert.ok(text.includes('"keep": true'));
  assert.ok(text.includes('"-editor.action.rename"')); assert.ok(text.includes('"f8"'));
  // Extensions may contribute a second F2 default with a different When.
  // Editing one row preserves that independent condition; remove it explicitly.
  while (await widget.locator('tbody tr[data-command="editor.action.rename"][data-source="Default"]').filter({ has: page.locator('kbd', { hasText: /^f2$/ }) }).count()) {
    await row('editor.action.rename', 'f2', 'Default').getByRole('button', { name: 'Remove', exact: true }).click();
    await widget.getByRole('status').filter({ hasText: 'Keyboard shortcuts saved.' }).waitFor();
  }
  await rename('F2', false); await rename('F8', true);
  checks.push('Graphical edit replaces one F2 default with F8, explicit Remove handles a separate extension F2 condition, and JSONC comments/arguments remain; F2 is removed and F8 opens real Rename.');
  await shortcuts('editor.action.rename'); await row('editor.action.rename', 'f8', 'User').getByRole('button', { name: 'Reset', exact: true }).click();
  await widget.getByRole('status').filter({ hasText: 'Keyboard shortcuts saved.' }).waitFor(); await rename('F2', true); await rename('F8', false);
  text = await readFile(runtime.profile + '/keybindings.json', 'utf8'); assert.ok(!text.includes('editor.action.rename')); assert.ok(text.includes('// retained user comment'));
  checks.push('Reset removes the user override and removal entry and restores the actual F2 default, retaining unrelated shortcuts.');
  await shortcuts('workbench.action.quickOpen'); await row('workbench.action.quickOpen').getByRole('button', { name: 'Add', exact: true }).click();
  dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Record keys', exact: true }).click();
  await page.keyboard.press('Meta+k'); await page.keyboard.press('Meta+y');
  assert.match(await dialog.getByRole('textbox', { name: 'Shortcut', exact: true }).inputValue(), /k .*y$/);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await saved();
  await target(); await page.keyboard.press('Meta+k'); await page.keyboard.press('Meta+y'); await page.locator('input[placeholder^="Search files by name"]').waitFor(); await page.keyboard.press('Escape');
  checks.push('Recording a two-stroke cmd+k cmd+y chord adds an actual Quick Open shortcut without firing the global command while recording.');
  await shortcuts('editor.action.rename'); await row('editor.action.rename', 'f2', 'Default').getByRole('button', { name: 'Edit', exact: true }).click();
  dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: 'Shortcut', exact: true }).fill('f9');
  const beforeExternal = await readFile(runtime.profile + '/keybindings.json', 'utf8'); const external = beforeExternal + '// external edit retained\n';
  await writeFile(runtime.profile + '/keybindings.json', external); await page.waitForTimeout(300);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await dialog.getByRole('alert').filter({ hasText: /changed on disk/ }).waitFor();
  assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), external); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  checks.push('A configuration change on disk while the edit dialog is open refuses the stale save and preserves the exact external bytes.');
  await command('Preferences: Open Keyboard Shortcuts (JSON)');
  await page.waitForFunction(() => {
    const editor = document.activeElement?.closest('.monaco-editor');
    return editor?.querySelector('.view-lines')?.textContent.replace(/\u00a0/g, ' ').includes('// retained user comment');
  });
  let lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last(); await lines.click(); await page.keyboard.press('Meta+a'); await page.keyboard.insertText('// unsaved draft\n[]');
  await shortcuts('editor.action.rename'); await row('editor.action.rename', 'f2', 'Default').getByRole('button', { name: 'Edit', exact: true }).click();
  dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: 'Shortcut', exact: true }).fill('f9');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await dialog.getByRole('alert').filter({ hasText: /unsaved changes/ }).waitFor();
  assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), external); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  checks.push('An unsaved real JSON editor draft blocks graphical writes and preserves both the disk configuration and draft.');
  await command('Preferences: Open Keyboard Shortcuts (JSON)'); lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last();
  await page.waitForFunction(() => document.activeElement?.closest('.monaco-editor')?.querySelector('.view-lines')?.textContent.replace(/\u00a0/g, ' ').includes('// unsaved draft'));
  assert.ok((await lines.innerText()).replace(/\u00a0/g, ' ').includes('// unsaved draft'));
  await lines.click(); await page.keyboard.press('Meta+a'); await page.keyboard.insertText('invalid shortcuts'); await page.keyboard.press('Meta+s');
  for (let i = 0; i < 100 && await readFile(runtime.profile + '/keybindings.json', 'utf8') !== 'invalid shortcuts'; i++) await page.waitForTimeout(50);
  await command('Preferences: Open Keyboard Shortcuts'); await widget.getByRole('button', { name: 'Refresh', exact: true }).click();
  await widget.getByRole('status').filter({ hasText: /valid keyboard shortcuts array/ }).waitFor(); assert.equal(await widget.locator('tbody tr').count(), 0);
  assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), 'invalid shortcuts'); await rename('F2', true);
  checks.push('Malformed saved JSON disables graphical mutation, retains its exact bytes and keeps the last valid runtime keymap active.');
  await writeFile(runtime.profile + '/keybindings.json', external); await page.waitForTimeout(300);
  await Promise.all([page.waitForEvent('domcontentloaded'), command('Developer: Reload Window')]); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  await target(); await page.keyboard.press('Meta+k'); await page.keyboard.press('Meta+y'); await page.locator('input[placeholder^="Search files by name"]').waitFor(); await page.keyboard.press('Escape');
  await shortcuts('workbench.action.quickOpen'); await row('workbench.action.quickOpen', undefined, 'User').waitFor();
  await widget.getByRole('combobox', { name: 'Shortcut source', exact: true }).selectOption('User');
  assert.equal(await widget.locator('tbody tr[data-source="User"]').count(), 1);
  await widget.getByRole('combobox', { name: 'Shortcut source', exact: true }).selectOption('All');
  await target(); await page.keyboard.press('Meta+k'); await page.keyboard.press('Meta+s'); await widget.waitFor({ state: 'visible' });
  await widget.getByRole('searchbox').fill('');
  assert.equal(await widget.locator('tbody tr[data-command^="_"][data-source="Unassigned"]').count(), 0);
  await widget.getByRole('searchbox').fill('@command:_executeCodeActionProvider');
  await widget.locator('tbody tr[data-command="_executeCodeActionProvider"]').waitFor();
  await widget.getByRole('searchbox').fill('@command:editor.action.rename');
  assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), external);
  checks.push('Recorded shortcuts persist and execute after real Reload Window; source filtering and standard cmd+k cmd+s work; unassigned private commands are hidden by default but remain available through exact command lookup.');
  assert.deepEqual(errors, []); await page.screenshot({ path: runtime.qa + '/graphical-keybindings.png' });
} catch (error) { checks.push({ failure: String(error), text: await page.locator('body').innerText() }); await page.screenshot({ path: runtime.qa + '/graphical-keybindings-failure.png' }); process.exitCode = 1; }
finally {
  const result = { runtime, runnerSha256: createHash('sha256').update(runner).digest('hex'), checks, errors, scope: 'Actual controlled Mac workbench/profile; no canonical user or cross-platform release claim.' };
  await writeFile(runtime.qa + '/graphical-keybindings-browser.json', JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 }); await browser.close(); console.log(JSON.stringify(result));
}
