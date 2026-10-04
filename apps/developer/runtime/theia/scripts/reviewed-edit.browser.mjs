import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { reviewedSelection, reviewedReplacement } from '../../../services/codeoss-service/src/reviewed-selection.mjs';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, runtime.qa + '/project');
const tag = process.argv[3] || 'reviewed-edit'; assert.match(tag, /^[a-z0-9-]{1,40}$/);
const toolsURL = process.env.YNX_QA_TOOLS_URL;
if (toolsURL) assert.match(toolsURL, /^http:\/\/127\.0\.0\.1:\d{4,5}\/native-tools\?sessionId=/);
const filename = `review-${tag}.ynxnotes`;
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/${tag}-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
const original = 'before\nselected passage\nafter\n', replacement = 'before\nnew passage\nafter\n';
try { await writeFile(runtime.workspace + '/' + filename, original, { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await readFile(runtime.workspace + '/' + filename, 'utf8'), original); }
const browser = await chromium.launch({ headless: true }), context = await browser.newContext(), page = await context.newPage();
const checks = [], errors = []; let capture, bundle, previewState, sharedClipboard = '', toolsHandoff;
await context.exposeBinding('__ynxQAClipboardWrite', (_, text) => { sharedClipboard = text; });
await context.exposeBinding('__ynxQAClipboardRead', () => sharedClipboard);
await context.route('**/*', route => [runtime.url, toolsURL && new URL(toolsURL).origin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
  writeText: async text => { window.__qaReviewCapture = text; await window.__ynxQAClipboardWrite(text); },
  readText: async () => window.__ynxQAClipboardRead(),
} }));
page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push({ message: error.message, stack: error.stack }));
async function command(name) {
  // Escape collapses the selected text; F1 must preserve the capture selection.
  await page.keyboard.press('F1');
  await page.locator('.quick-input-box input').fill('>' + name);
  await page.locator('.quick-input-list').getByText(name, { exact: true }).filter({ visible: true }).first().click();
}
async function editorOperation(action, value) {
  return page.evaluate(({ action, value, filename }) => {
    const container = window.theia.container;
    const id = [...container._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    const manager = container.get(id);
    const editor = manager.all.find(widget => widget.editor.uri.toString().endsWith('/' + filename))?.editor;
    if (!editor) throw Error('The real reviewed editor is not open.');
    // Hidden source widgets detach their view control during a diff. The
    // document model remains the real source of text/version in that case.
    const control = editor.getControl(), model = editor.document.textEditorModel;
    if (action === 'select') control.setSelection({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: model.getLineMaxColumn(2) });
    if (action === 'change') model.setValue(value);
    return { text: model.getValue(), version: model.getVersionId(), selectedText: control.getSelection() ? model.getValueInRange(control.getSelection()) : '' };
  }, { action, value, filename });
}
async function open() {
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill(filename);
  await page.locator('.quick-input-list').getByText(filename, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForFunction(filename => {
    const container = window.theia.container, id = [...container._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    const editor = container.get(id).currentEditor?.editor;
    return editor?.uri.toString().startsWith('file:') && editor.uri.toString().endsWith('/' + filename) && !!editor.getControl().getModel();
  }, filename);
  await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().click();
  await editorOperation('read');
}
async function copySelection() {
  await open(); const selected = await editorOperation('select'); assert.ok(selected.selectedText.length); await command('YNX: Copy Selected Context for Review');
  await page.getByRole('button', { name: 'Copy selection', exact: true }).click();
  await page.waitForFunction(() => !!window.__qaReviewCapture);
  return JSON.parse(await page.evaluate(() => window.__qaReviewCapture));
}
async function preview(value, source = 'clipboard', preserveCopied = false) {
  if (source === 'clipboard' && !preserveCopied) await page.evaluate(text => navigator.clipboard.writeText(text), JSON.stringify(value));
  await command('YNX: Apply Reviewed Text Changes');
  await page.locator('.quick-input-list').getByText(source === 'clipboard' ? 'Use copied changes' : 'Paste review JSON', { exact: true }).filter({ visible: true }).first().click();
  if (source === 'paste') { const input = page.locator('.quick-input-box input'); await input.fill(JSON.stringify(value)); await input.press('Enter'); }
}
async function disk(expected) {
  for (let i = 0; i < 100; i++) { if (await readFile(runtime.workspace + '/' + filename, 'utf8') === expected) return; await page.waitForTimeout(50); }
  assert.equal(await readFile(runtime.workspace + '/' + filename, 'utf8'), expected);
}
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const container = window.theia.container, id = [...container._bindingDictionary._map.keys()].find(id => typeof id === 'function' && typeof id.prototype.reachedState === 'function' && typeof id.prototype.doSetState === 'function');
    await container.get(id).reachedState('ready');
  });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) await trust.click();
  capture = await copySelection();
  assert.equal(capture.selectedText, 'selected passage'); assert.equal(capture.sessionId, runtime.fixtureSessionId);
  assert.equal(capture.fullTextDigest, createHash('sha256').update(original).digest('hex'));
  bundle = reviewedReplacement(JSON.stringify({ summary: 'Change selected passage', replacement: 'new passage' }), reviewedSelection(JSON.stringify(capture), runtime.fixtureSessionId)).bundle;
  checks.push('Actual installed Tools captures the real selected file/version/digest/session; production review parser builds a selection-bound bundle from a controlled answer.');
  if (toolsURL) {
    const tools = await context.newPage(), calls = [];
    tools.on('pageerror', error => errors.push({ message: error.message, stack: error.stack }));
    await tools.route('**/runtime/native-tools/**', async route => {
      const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON(); calls.push({ path, body });
      let value;
      if (path.endsWith('/context')) value = { csrf: 'controlled', account: 'controlled-account', projectId: 'controlled-project', expiresAt: Date.now() + 60000 };
      else if (path.endsWith('/proposals')) { assert.equal(body.mode, 'selected-edit'); assert.deepEqual(JSON.parse(body.context), capture); value = { ...body, csrf: 'controlled-review', proposalId: 'controlled-one-use', model: 'qwen3:4b', contextBytes: Buffer.byteLength(body.context), mode: 'selected-edit' }; }
      else if (path.endsWith('/approve')) value = { text: 'Controlled suggested replacement', edit: { summary: 'Change selected passage', bundle }, applied: false, signed: false };
      else throw Error('Unexpected Tools request in the controlled handoff.');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    });
    await tools.goto(toolsURL);
    await tools.getByLabel('Request', { exact: true }).fill('Improve selected passage');
    await tools.getByRole('button', { name: 'Use copied selection', exact: true }).click();
    await tools.getByRole('complementary', { name: 'Copied selection' }).getByText(capture.selectedText, { exact: true }).waitFor();
    assert.equal(await tools.getByLabel('Review mode', { exact: true }).inputValue(), 'selected-edit');
    assert.deepEqual(JSON.parse(await tools.getByLabel('Selected context', { exact: true }).inputValue()), capture);
    assert.equal(await tools.getByLabel('Selected context', { exact: true }).isVisible(), false);
    await tools.getByRole('button', { name: 'Preview request', exact: true }).click();
    const metadata = tools.getByText('Selection metadata', { exact: true }); await metadata.waitFor();
    assert.equal(await metadata.evaluate(node => node.closest('details').open), false);
    assert.equal(calls.filter(call => call.path.endsWith('/approve')).length, 0);
    await tools.getByRole('button', { name: 'Send reviewed context once', exact: true }).click();
    await tools.getByRole('button', { name: 'Copy changes for editor', exact: true }).click();
    await tools.getByRole('status').filter({ hasText: 'Changes copied' }).waitFor();
    assert.deepEqual(JSON.parse(sharedClipboard), bundle);
    assert.equal(calls.filter(call => call.path.endsWith('/approve')).length, 1);
    await tools.screenshot({ path: `${runtime.qa}/${tag}-tools-copy.png` });
    toolsHandoff = { url: toolsURL, calls, backend: 'controlled HTTP answer; no hosted provider or canonical admission' };
    await tools.close(); await page.bringToFront();
    checks.push('Compiled React imports the real editor selection through a shared in-memory clipboard, displays selected code, explicitly previews/sends once, then copies the exact suggestion back to the native editor command without manual JSON paste.');
  }
  await preview(bundle, 'clipboard', !!toolsURL); await page.getByRole('button', { name: 'Apply reviewed changes', exact: true }).waitFor();
  previewState = await page.evaluate(() => {
    const container = window.theia.container, id = [...container._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    const editor = container.get(id).currentEditor.editor;
    return { readOnly: !!editor.getControl().getRawOptions().readOnly, modifiedText: editor.getControl().getModel()?.getValue() };
  });
  assert.equal(previewState.readOnly, true, 'Review must show an immutable suggestion instead of an editable draft that is not the applied bundle.');
  assert.equal((await editorOperation('read')).text, original); await disk(original);
  await page.screenshot({ path: `${runtime.qa}/${tag}-diff-preview.png` });
  await page.keyboard.press('Escape');
  checks.push('Actual diff preview and cancellation leave editor and disk unchanged.');
  await page.locator('.monaco-diff-editor .view-lines').filter({ visible: true }).last().click();
  await page.keyboard.press('Meta+a'); await page.keyboard.insertText('attempted change to the suggestion');
  const unchangedPreview = await page.evaluate(() => {
    const container = window.theia.container, id = [...container._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    return container.get(id).currentEditor.editor.getControl().getModel().getValue();
  });
  assert.equal(unchangedPreview, replacement); assert.equal((await editorOperation('read')).text, original); await disk(original);
  checks.push('The real suggested-change pane is read-only: keyboard input cannot change the immutable preview or source.');
  await preview(bundle, 'paste'); await page.getByRole('button', { name: 'Apply reviewed changes', exact: true }).waitFor();
  await page.keyboard.press('Escape'); assert.equal((await editorOperation('read')).text, original); await disk(original);
  checks.push('The saved-review paste fallback opens the same guarded diff; cancellation still preserves editor and disk.');
  await preview(bundle, 'clipboard', !!toolsURL); await page.getByRole('button', { name: 'Apply reviewed changes', exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Apply these reviewed text changes?'));
  await open();
  for (let i = 0; i < 100 && (await editorOperation('read')).text !== replacement; i++) await page.waitForTimeout(50);
  assert.equal((await editorOperation('read')).text, replacement); await disk(original);
  await page.keyboard.press('Meta+s'); await disk(replacement);
  checks.push('Explicit native approval replaces only the selected passage in the real buffer; disk remains unchanged until normal Save.');
  await preview(bundle);
  await page.getByText('A document changed or is not open. Preserve both versions and review again.', { exact: true }).filter({ visible: true }).first().waitFor();
  assert.equal((await editorOperation('read')).text, replacement); await disk(replacement);
  checks.push('Replaying the old version-bound suggestion refuses without changing the saved project.');
  await command('Notifications: Clear All Notifications');
  await page.getByText('A document changed or is not open. Preserve both versions and review again.', { exact: true }).filter({ visible: true }).first().waitFor({ state: 'hidden' });
  await page.evaluate(() => { window.__qaReviewCapture = ''; });
  const fresh = await copySelection();
  const next = reviewedReplacement(JSON.stringify({ summary: 'Another suggestion', replacement: 'second suggestion' }), reviewedSelection(JSON.stringify(fresh), runtime.fixtureSessionId)).bundle;
  await preview(next); await page.getByRole('button', { name: 'Apply reviewed changes', exact: true }).waitFor();
  const concurrent = replacement + 'concurrent local edit\n'; await editorOperation('change', concurrent);
  await page.getByRole('button', { name: 'Apply reviewed changes', exact: true }).click();
  await page.getByText('A document changed or is not open. Preserve both versions and review again.', { exact: true }).filter({ visible: true }).first().waitFor();
  assert.equal((await editorOperation('read')).text, concurrent); await disk(replacement);
  checks.push('A real document edit during approval invalidates the suggestion and preserves the concurrent unsaved buffer.');
  await preview({ ...next, sessionId: '00000000-0000-4000-8000-000000000001' });
  await page.getByText('Use a reviewed YNX text change bundle.', { exact: true }).filter({ visible: true }).first().waitFor();
  assert.equal((await editorOperation('read')).text, concurrent); await disk(replacement);
  checks.push('A bundle from another opaque runtime session is refused without applying or saving the proposal.');
  assert.deepEqual(errors, []);
} finally {
  await page.screenshot({ path: `${runtime.qa}/${tag}-last-state.png` }).catch(() => {}); await browser.close();
  await writeFile(`${runtime.qa}/${tag}-ui.json`, JSON.stringify({ runtime, checks, errors, capture, bundle, previewState, toolsHandoff,
    runnerSha256: createHash('sha256').update(bytes).digest('hex'), actualNativeEditor: true, clipboard: 'frontend memory sink', model: 'controlled answer through production review parser; no real hosted model', canonicalAdmission: false, public: false }, null, 2), { flag: 'wx', mode: 0o600 });
}
console.log(JSON.stringify({ checks: checks.length, errors }));
