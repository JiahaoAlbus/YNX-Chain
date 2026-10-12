import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, runtime.qa + '/project');
const runner = await readFile(fileURLToPath(import.meta.url));
await writeFile(runtime.qa + '/selection-typing-runner.mjs', runner, { flag: 'wx', mode: 0o600 });
await writeFile(runtime.workspace + '/selection-target.json', '{}\n', { flag: 'wx', mode: 0o600 });
await writeFile(runtime.workspace + '/selection-schema.json', JSON.stringify({ type: 'object', properties: { ecosystemBuildName: { type: 'string' }, networkMode: { enum: ['testnet'] } }, additionalProperties: false }), { flag: 'wx', mode: 0o600 });
await writeFile(runtime.workspace + '/.vscode/settings.json', JSON.stringify({ 'json.schemas': [{ fileMatch: ['selection-target.json'], url: './selection-schema.json' }] }), { flag: 'wx', mode: 0o600 });
const browser = await chromium.launch({ headless: true }), page = await browser.newPage(), checks = [], observations = [], errors = [], consoleErrors = [];
let stage = 'startup';
await page.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
page.on('pageerror', error => errors.push({ stage, message: error.message, stack: error.stack }));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ stage, text: message.text() }); });
page.setDefaultTimeout(30000);
const lines = () => page.locator('.monaco-editor .view-lines').filter({ visible: true }).last();
async function state() {
  return page.evaluate(() => {
    const container = window.theia.container;
    const identifier = [...container._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    const widget = container.get(identifier).currentEditor, control = widget.editor.getControl();
    const model = control.getModel(), selection = control.getSelection();
    const renderedText = [...control.getDomNode().querySelectorAll('.view-lines .view-line')].map(node => node.textContent.replace(/\u00a0/g, ' ')).join('\n');
    return { uri: model.uri.toString(), language: model.getLanguageId(), text: model.getValue(), renderedText, selection: selection && { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn }, selectedText: selection && model.getValueInRange(selection), position: control.getPosition() };
  });
}
async function exact(text) {
  for (let i = 0; i < 100; i++) { const current = await state(); if (current.text === text && current.renderedText === text) return; await page.waitForTimeout(25); }
  const current = await state(); assert.equal(current.text, text); assert.equal(current.renderedText, text);
}
async function save(text) {
  await page.keyboard.press('Meta+s');
  for (let i = 0; i < 100; i++) { if (await readFile(runtime.workspace + '/selection-target.json', 'utf8') === text) return; await page.waitForTimeout(25); }
  assert.equal(await readFile(runtime.workspace + '/selection-target.json', 'utf8'), text);
}
async function replace(text) {
  await lines().click(); await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.keyboard.insertText(text); await exact(text); await save(text);
}
async function command(label) {
  await page.keyboard.press('Escape'); await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill('>' + label);
  const expression = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  await page.locator('.quick-input-list .label-name').filter({ hasText: expression }).filter({ visible: true }).first().click();
  await page.locator('.quick-input-box input').waitFor({ state: 'hidden' });
}
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) { assert.ok((await page.locator('body').innerText()).includes(runtime.workspace)); await trust.click(); }
  await page.keyboard.press('Meta+p'); const input = page.locator('input[placeholder^="Search files by name"]'); await input.fill('selection-target.json');
  await page.locator('.quick-input-list .label-name').filter({ hasText: /^selection-target\.json$/ }).filter({ visible: true }).first().click(); await input.waitFor({ state: 'hidden' }); await lines().waitFor();
  await lines().click(); assert.equal((await state()).language, 'json');
  const intended = '{"ecosystemBuildName":"owned-fixture","networkMode":"testnet"}';
  stage = 'original schema completion then selected typing and sort';
  await lines().locator('.view-line').first().click(); await page.keyboard.press('Meta+ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Control+Space');
  await page.locator('.suggest-widget.visible').getByText('ecosystemBuildName', { exact: false }).filter({ visible: true }).first().waitFor(); await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+a'); await page.keyboard.type(intended); await exact(intended + '"}'); await save(intended + '"}');
  await command('JSON: Sort Document');
  await exact(JSON.stringify(JSON.parse(intended), null, 4) + '"}');
  observations.push({ stage, ...await state() }); await save((await state()).text);
  checks.push('The original unopened-schema completion, selected typing and JSON sort sequence renders and saves the expected surround-selection result without losing text.');
  stage = 'selected braces and undo';
  await replace('alpha'); await page.keyboard.press('Meta+a'); await page.keyboard.type('{'); await exact('{alpha}');
  assert.equal((await state()).selectedText, 'alpha'); observations.push({ stage, ...await state() }); await save('{alpha}');
  await page.keyboard.press('Meta+z'); await exact('alpha'); await save('alpha');
  await page.keyboard.press('Meta+Shift+z'); await exact('{alpha}'); await save('{alpha}');
  checks.push('Real JSON selection is surrounded with braces, remains selected, saves exact bytes, and Undo/Redo restore the exact document.');
  stage = 'selected quotes';
  await replace('alpha'); await page.keyboard.press('Meta+a'); await page.keyboard.type('"'); await exact('"alpha"');
  assert.equal((await state()).selectedText, 'alpha'); observations.push({ stage, ...await state() }); await page.keyboard.type('beta'); await exact('"beta"'); await save('"beta"');
  checks.push('Typing a quote surrounds the real JSON selection, and subsequent normal text replaces only that selection, preserving its surrounding quotes.');
  stage = 'rapid whole selected JSON';
  for (const mode of ['rapid', 'delayed']) {
    await replace('{"old":"selected"}'); await page.keyboard.press('Meta+a');
    await page.keyboard.type(intended, { delay: mode === 'delayed' ? 10 : 0 });
    const actual = await state(); observations.push({ stage, mode, intended, ...actual }); await save(actual.text);
    assert.equal(actual.text, intended + '"}');
    await command('Format Document'); await exact(JSON.stringify(JSON.parse(intended), null, 4) + '"}'); await save((await state()).text);
  }
  checks.push('Rapid and delayed typing over a selected JSON object and real formatting render the same standard surround-selection result and exact saved bytes.');
  stage = 'multiline Unicode selection';
  const unicode = 'YNX 中文 🧩\nsecond line';
  await replace(unicode); await page.keyboard.press('Meta+a'); await page.keyboard.type('{'); await exact('{' + unicode + '}');
  observations.push({ stage, ...await state() }); await save('{' + unicode + '}');
  await page.keyboard.press('Meta+z'); await exact(unicode); await save(unicode);
  checks.push('A multiline Unicode/emoji selection is surrounded and undone without changing its original text or saved bytes.');
  stage = 'empty document rapid typing';
  await replace(''); await page.keyboard.type(intended); await exact(intended); await save(intended); assert.deepEqual(JSON.parse(await readFile(runtime.workspace + '/selection-target.json', 'utf8')), JSON.parse(intended));
  checks.push('Normal rapid JSON typing into an empty document overtypes automatic pairs and produces the exact intended valid saved JSON.');
  await page.waitForTimeout(300); assert.deepEqual(errors, []);
  await page.screenshot({ path: runtime.qa + '/selection-typing.png' });
} catch (error) {
  checks.push({ failure: String(error), stage, text: await page.locator('body').innerText() });
  await page.screenshot({ path: runtime.qa + '/selection-typing-failure.png' }); process.exitCode = 1;
} finally {
  const result = { runtime, runnerSha256: createHash('sha256').update(runner).digest('hex'), checks, observations, errors, consoleErrors, scope: 'Actual controlled Mac keyboard/editor/disk behavior, unchanged JSON extension and current pinned workbench. No canonical or other-platform claim.' };
  await writeFile(runtime.qa + '/selection-typing-browser.json', JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 }); await browser.close(); console.log(JSON.stringify(result));
}
