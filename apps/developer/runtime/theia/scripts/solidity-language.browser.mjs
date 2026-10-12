import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
const tag = process.argv[3] || 'solidity-language'; assert.match(tag, /^[a-z0-9-]{1,40}$/);
const filename = '合约-Editing-' + tag + '.sol', path = runtime.workspace + '/contracts/' + filename;
const source = '// SPDX-License-Identifier: MIT\n// 中文😀\npragma solidity ^0.8.24;\ncontract Editing {\n    string public title = unicode"中文😀";\n    function value() public pure returns (uint256) { return 3; }\n}\n';
await mkdir(runtime.workspace + '/contracts', { recursive: true }); await writeFile(path, source, { flag: 'wx' });
await writeFile(runtime.qa + '/' + tag + '-runner.mjs', await readFile(new URL(import.meta.url)), { flag: 'wx' });
const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
const checks = [], errors = [], observations = []; let passed = false;
page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
async function open() {
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill(filename);
  await page.locator('.quick-input-list').getByText(filename, { exact: true }).filter({ visible: true }).first().click();
  await page.locator('.quick-input-box input').waitFor({ state: 'hidden' });
  await page.waitForFunction(filename => { const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function'); const editor = c.get(id).currentEditor?.editor; return editor?.uri.toString().endsWith('/' + encodeURIComponent(filename)) && !!editor.getControl().getModel(); }, filename);
  await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().click();
}
async function model(text, selection) {
  return page.evaluate(({ text, selection }) => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    const editor = c.get(id).currentEditor.editor, control = editor.getControl(), model = control.getModel();
    if (text !== undefined) { model.setValue(text); control.setPosition({ lineNumber: 1, column: text.length + 1 }); }
    if (selection) control.setSelection(selection);
    control.focus(); return { text: model.getValue(), language: model.getLanguageId(), uri: editor.uri.toString(), selection: control.getSelection() };
  }, { text, selection });
}
try {
  await page.goto(runtime.url); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && typeof id.prototype.reachedState === 'function' && typeof id.prototype.doSetState === 'function');
    await c.get(id).reachedState('ready');
  });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) await trust.click();
  await open(); const initial = await model(); assert.equal(initial.language, 'solidity'); assert.equal(initial.text, source);
  await page.waitForFunction(() => [...document.querySelectorAll('.monaco-editor .view-line span')].some(span => span.textContent === 'contract' && /mtk\d+/.test(span.className)));
  const colors = await page.evaluate(() => [...document.querySelectorAll('.monaco-editor .view-line span')].filter(span => /contract|SPDX|function|uint256/.test(span.textContent)).map(span => ({ text: span.textContent, color: getComputedStyle(span).color, className: span.className })));
  observations.push({ initial, colors }); assert.ok(new Set(colors.map(s => s.color)).size >= 2);
  await page.screenshot({ path: runtime.qa + '/' + tag + '-highlight.png' });
  checks.push('Real Unicode nested .sol file opens as Solidity and actual rendered tokens have distinct syntax colors; comments and source are retained.');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}'], ['"', '"'], ["'", "'"]]) {
    await model(''); await page.keyboard.type(open); assert.equal((await model()).text, open + close);
  }
  await model('value', { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }); await page.keyboard.type('(');
  assert.equal((await model()).text, '(value)');
  checks.push('Actual keyboard input auto-pairs brackets and both quote kinds, and surrounds an existing selection without losing its contents.');
  await model('// notes '); await page.keyboard.type('"'); assert.equal((await model()).text, '// notes "');
  await model('string s = "a";', { startLineNumber: 1, startColumn: 13, endLineNumber: 1, endColumn: 13 });
  await page.keyboard.type('('); assert.equal((await model()).text, 'string s = "(a";');
  checks.push('Quote pairing is suppressed inside actual comments and bracket pairing is suppressed inside actual strings.');
  await model(''); await page.keyboard.type('{'); await page.keyboard.press('Enter');
  const indented = (await model()).text; assert.match(indented, /^\{\n[ \t]+\n\}$/); observations.push({ indented });
  await model('uint256 value = 3;'); await page.keyboard.press('Meta+/');
  assert.match((await model()).text, /^\s*\/\/\s*uint256 value = 3;$/);
  await page.keyboard.press('Meta+/'); assert.equal((await model()).text, 'uint256 value = 3;');
  checks.push('Enter creates an indented block, and the normal comment shortcut comments and uncomments Solidity source.');
  await model('ynx-contract'); await page.keyboard.press('Control+Space');
  await page.locator('.suggest-widget').filter({ visible: true }).locator('.monaco-list-row').filter({ hasText: /^ynx-contra/ }).first().waitFor();
  await page.keyboard.press('Enter'); const expanded = (await model()).text; assert.match(expanded, /pragma solidity \^0\.8\.24;/); assert.match(expanded, /contract ContractName \{/); observations.push({ expanded });
  await page.keyboard.press('Escape');
  checks.push('Standard suggestion UI exposes the owned contract snippet on explicit completion; no semantic completion or compilation is claimed.');
  await model(source + '// saved through the editor\n'); assert.equal(await readFile(path, 'utf8'), source);
  await page.keyboard.press('Meta+s');
  for (let i = 0; i < 100; i++) { if ((await readFile(path, 'utf8')).endsWith('// saved through the editor\n')) break; await page.waitForTimeout(50); }
  assert.equal(await readFile(path, 'utf8'), source + '// saved through the editor\n');
  await page.keyboard.press('Meta+w'); await open(); const reopened = await model(); assert.equal(reopened.language, 'solidity'); assert.equal(reopened.text, source + '// saved through the editor\n');
  observations.push({ reopened }); assert.deepEqual(errors, []);
  checks.push('Scratch editing does not write source implicitly; explicit Save and close/reopen preserve exact Unicode source and Solidity language recognition.'); passed = true;
} catch (error) {
  errors.push({ message: error.message, stack: error.stack }); await page.screenshot({ path: runtime.qa + '/' + tag + '-error.png' }).catch(() => {});
} finally {
  await browser.close(); await writeFile(runtime.qa + '/' + tag + '-ui.json', JSON.stringify({ passed, checks, errors, observations, actualEditor: true, toolsVersion: '0.2.14', inputSha256: createHash('sha256').update(source).digest('hex'), syntaxAndEditingOnly: true, semanticCompletionVerified: false, fullRuntimeRebuilt: false, canonical: false, public: false }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ passed, checks: checks.length, errors })); if (!passed) process.exitCode = 1;
}
