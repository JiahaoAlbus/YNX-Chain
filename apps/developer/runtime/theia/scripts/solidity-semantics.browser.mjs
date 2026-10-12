import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
const tag = process.argv[3] || 'solidity-semantics'; assert.match(tag, /^[a-z0-9-]{1,40}$/);
const coldStart = process.argv[4] === '--cold-start';
if (process.argv[4] && !coldStart) throw Error('Unknown startup mode.');
const source = '// SPDX-License-Identifier: MIT\n// 中文😀\npragma solidity 0.8.24;\nimport "./lib/Math.sol";\ncontract Use { function ping() public pure returns(uint256) { return Math.value(); } function pong() public pure returns(uint256) { return Math.value(); } }\n';
const library = '// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\nlibrary Math { function value() internal pure returns(uint256) { return 3; } function value(uint256 n) internal pure returns(uint256) { return n; } }\n';
await mkdir(runtime.workspace + '/contracts/lib', { recursive: true });
async function fixture(file, content) {
  try { await writeFile(file, content, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await readFile(file, 'utf8'), content); }
}
await fixture(runtime.workspace + '/contracts/Use.sol', source);
await fixture(runtime.workspace + '/contracts/lib/Math.sol', library);
await writeFile(runtime.qa + '/' + tag + '-runner.mjs', await readFile(new URL(import.meta.url)), { flag: 'wx' });
const browser = await chromium.launch({ headless: true }), page = await browser.newPage(), checks = [], errors = [], observations = [];
let passed = false; page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
async function current(position) {
  return page.evaluate(position => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    const editor = c.get(id).currentEditor.editor, control = editor.getControl();
    if (position) control.setPosition(position); control.focus();
    return { uri: editor.uri.toString(), selection: control.getSelection(), text: control.getModel().getValue(), language: control.getModel().getLanguageId() };
  }, position);
}
async function open(file) {
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill(file);
  await page.locator('.quick-input-list').getByText(file, { exact: true }).filter({ visible: true }).first().click();
  await page.locator('.quick-input-box input').waitFor({ state: 'hidden' });
  await page.waitForFunction(file => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    return c.get(id).currentEditor?.editor.uri.toString().endsWith('/' + file);
  }, file);
  await current();
}
try {
  await page.goto(runtime.url); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && typeof id.prototype.reachedState === 'function' && typeof id.prototype.doSetState === 'function');
    await c.get(id).reachedState('ready');
  });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) await trust.click();
  await open('Use.sol'); const first = await current(); assert.equal(first.language, 'solidity'); assert.equal(first.text, source);
  // Frontend readiness precedes extension-host startup. Observe the actual
  // extension command and its status before testing providers; no injected API.
  if (!coldStart) {
    await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill('>YNX: Solidity Language Status');
    await page.locator('.quick-input-list').getByText('YNX: Solidity Language Status', { exact: true }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes('"registered":true'));
    observations.push({ languageStatus: await page.locator('body').innerText() });
  }
  const lines = source.slice(0, source.indexOf('Math.value') + 5).split('\n');
  const position = { lineNumber: lines.length, column: lines.at(-1).length + 1 };
  await current(position); await page.keyboard.press('F12');
  await page.waitForFunction(() => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    return c.get(id).currentEditor?.editor.uri.toString().endsWith('/contracts/lib/Math.sol');
  });
  const definition = await current(); assert.equal(definition.selection.startLineNumber, 3); assert.equal(definition.selection.startColumn, library.split('\n')[2].indexOf('value()') + 1); observations.push({ definition });
  await page.screenshot({ path: runtime.qa + '/' + tag + '-definition.png' });
  checks.push('Actual F12 invokes the packaged reviewed local compiler and opens the precise cross-file overload declaration through the standard VSCode definition provider.');
  await open('Use.sol'); await current(position); await page.keyboard.press('Meta+k'); await page.keyboard.press('Meta+i');
  await page.locator('.monaco-hover').filter({ visible: true }).filter({ hasText: 'function () pure returns (uint256)' }).first().waitFor();
  await page.screenshot({ path: runtime.qa + '/' + tag + '-hover.png' });
  checks.push('Actual editor Show Hover displays the compiler-authored function type at the correct member token.');
  await page.keyboard.press('Escape'); await current(position); await page.keyboard.press('Shift+F12');
  await page.locator('.peekview-widget').filter({ visible: true }).filter({ hasText: 'Use.sol' }).first().waitFor();
  const text = await page.locator('body').innerText(); assert.ok(text.includes('Use.sol')); observations.push({ referencesUI: text.slice(-4500) });
  checks.push('Actual Find References uses the compiler declaration ID through the standard references provider.');
  assert.ok(text.includes('References (3)')); assert.ok(text.includes('Math.sol'));
  await page.keyboard.press('Escape'); await current();
  await page.keyboard.press('Meta+Shift+o');
  await page.locator('.quick-input-list').getByText('ping', { exact: true }).filter({ visible: true }).first().waitFor();
  await page.locator('.quick-input-list').getByText('pong', { exact: true }).filter({ visible: true }).first().waitFor();
  await page.screenshot({ path: runtime.qa + '/' + tag + '-symbols.png' }); await page.keyboard.press('Escape');
  checks.push('Actual Go to Symbol shows compiler-authored document declarations in the standard editor picker.');
  await open('Math.sol'); await current({ lineNumber: 3, column: library.split('\n')[2].indexOf('value()') + 1 });
  await page.keyboard.press('Control+Shift+ArrowRight'); await page.keyboard.type('fresh');
  assert.ok((await current()).text.includes('function fresh()'));
  await open('Use.sol'); await current(position); await page.keyboard.press('F12');
  await page.getByText("No definition found for 'value'", { exact: true }).filter({ visible: true }).first().waitFor();
  assert.ok((await current()).uri.endsWith('/Use.sol'));
  checks.push('An unsaved dependency that makes the project invalid retires cached definitions and refuses a stale F12 result.');
  await current(); await page.keyboard.press('Meta+a'); await page.keyboard.type(source.replaceAll('Math.value()', 'Math.fresh()'));
  await current(position); await page.keyboard.press('F12');
  await page.waitForFunction(() => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    return c.get(id).currentEditor?.editor.uri.toString().endsWith('/contracts/lib/Math.sol');
  });
  assert.ok((await current()).text.includes('function fresh()'));
  checks.push('Fixing the unsaved caller reanalyzes both current buffers and jumps to the renamed unsaved dependency without saving either file.');
  assert.equal(await readFile(runtime.workspace + '/contracts/Use.sol', 'utf8'), source);
  assert.equal(await readFile(runtime.workspace + '/contracts/lib/Math.sol', 'utf8'), library);
  assert.deepEqual(errors, []); passed = true;
} catch (error) {
  errors.push({ message: error.message, stack: error.stack });
  await page.screenshot({ path: runtime.qa + '/' + tag + '-error.png' }).catch(() => {});
} finally {
  await browser.close();
  await writeFile(runtime.qa + '/' + tag + '-ui.json', JSON.stringify({ passed, checks, errors, observations, coldStart, languageStatusCommandInvoked: !coldStart, actualEditor: true, actualStandardProviders: true, bundledPinnedCompiler: true, workerAssetPathRedirected: false, sourceWrites: 'Exclusive own QA fixtures and actual unsaved keyboard edits; original disk files are checked unchanged.', canonical: false, realWallet: false, public: false, fullRuntimeInput: runtime.plugins === runtime.root + '/plugins' }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ passed, checks: checks.length, errors })); if (!passed) process.exitCode = 1;
}
