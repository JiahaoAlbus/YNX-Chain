import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { registerDefaultKeybindings } = require('../../ynx-workbench/lib/default-keybindings.js');
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
const original = await readFile(runtime.workspace + '/debug.js', 'utf8');
const checks = [], errors = [];
const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
page.setDefaultTimeout(15000);
await page.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
page.on('pageerror', error => errors.push(error.message));
let passed = false, baseline;
async function command(label) {
  await page.keyboard.press('F1');
  await page.locator('.quick-input-box input').fill('>' + label);
  await page.locator('.quick-input-list').getByText(label, { exact: true }).filter({ visible: true }).first().click();
  await page.locator('.quick-input-box input').waitFor({ state: 'hidden' });
}
async function focus() {
  await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().locator('.view-line').first().click();
}
async function toggle(key, visible) {
  await focus(); await page.keyboard.press(key);
  await page.locator('#problems').waitFor({ state: visible ? 'visible' : 'hidden' });
}
try {
  await page.goto(runtime.url); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && typeof id.prototype.reachedState === 'function' && typeof id.prototype.doSetState === 'function');
    await c.get(id).reachedState('ready');
  });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) await trust.click();
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('debug.js');
  await page.locator('.quick-input-list').getByText('debug.js', { exact: true }).filter({ visible: true }).first().click();
  await page.locator('.quick-input-box input').waitFor({ state: 'hidden' }); await focus();
  baseline = await page.evaluate(() => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && typeof id.prototype.getKeybindingsForCommand === 'function');
    window.__ynxKeybindingRegistry = c.get(id);
    return window.__ynxKeybindingRegistry.getKeybindingsForCommand('problemsView:toggle');
  });
  assert.equal(baseline.length, 0);
  await toggle('Meta+Shift+M', false);
  checks.push('Pinned compiled runtime has no Problems toggle binding; real focused-editor shortcut cannot open it.');
  // Resource-bounded source integration fixture: run the exact owned function
  // against the real default registry. This is not a rebuilt runtime claim.
  await page.evaluate(source => {
    const register = (0, eval)('(' + source + ')');
    register(window.__ynxKeybindingRegistry, 'core.close.tab');
  }, registerDefaultKeybindings.toString());
  await toggle('Meta+Shift+M', true); await toggle('Meta+Shift+M', false);
  await toggle('Meta+Shift+m', true);
  checks.push('Exact owned default registration opens, closes and reopens actual Problems from the real editor with both simulated key spellings.');
  await command('View: Toggle Problems'); await page.locator('#problems').waitFor({ state: 'hidden' });
  await command('View: Toggle Problems'); await page.locator('#problems').waitFor({ state: 'visible' });
  await command('View: Toggle Problems'); await page.locator('#problems').waitFor({ state: 'hidden' });
  checks.push('The ordinary View command and keyboard toggle share the actual Problems widget.');
  const shortcuts = '// retained project-profile comment\n[\n {"key":"cmd+shift+m","command":"-problemsView:toggle"},\n {"key":"cmd+alt+m","command":"problemsView:toggle"}\n]\n';
  await writeFile(runtime.profile + '/keybindings.json', shortcuts, { flag: 'wx' });
  await page.waitForFunction(() => window.__ynxKeybindingRegistry.getKeybindingsForCommand('problemsView:toggle').some(b => b.keybinding === 'cmd+alt+m'));
  await toggle('Meta+Shift+M', false); await toggle('Meta+Alt+m', true); await toggle('Meta+Alt+m', false);
  assert.equal(await readFile(runtime.profile + '/keybindings.json', 'utf8'), shortcuts);
  checks.push('Actual profile watcher loads JSONC user removal and replacement; original key stops toggling, replacement opens/closes, and comments remain.');
  await writeFile(runtime.qa + '/problems-keybinding-user-before-reset.json', shortcuts, { flag: 'wx' });
  await writeFile(runtime.profile + '/keybindings.json', '// retained project-profile comment\n[]\n');
  await page.waitForFunction(() => !window.__ynxKeybindingRegistry.getKeybindingsForCommand('problemsView:toggle').some(b => b.keybinding === 'cmd+alt+m'));
  await toggle('Meta+Shift+M', true);
  assert.equal(await readFile(runtime.workspace + '/debug.js', 'utf8'), original); assert.deepEqual(errors, []);
  await page.screenshot({ path: runtime.qa + '/problems-keybinding-source-pass.png' });
  checks.push('Resetting the user override restores the normal default; ordinary source file is unchanged and browser errors are empty.');
  passed = true;
} catch (error) {
  errors.push({ message: error.message, stack: error.stack });
  await page.screenshot({ path: runtime.qa + '/problems-keybinding-source-error.png' }).catch(() => {});
} finally {
  await browser.close();
  const source = await readFile(new URL('../../ynx-workbench/lib/default-keybindings.js', import.meta.url));
  await writeFile(runtime.qa + '/problems-keybinding-source-ui.json', JSON.stringify({ passed, checks, errors, baseline, sourceSha256: createHash('sha256').update(source).digest('hex'), actualRegistry: true, actualEditorAndProblems: true, sourceFunctionFixture: true, rebuiltRuntime: false, canonical: false, public: false }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ passed, checks: checks.length, errors }));
  if (!passed) process.exitCode = 1;
}
