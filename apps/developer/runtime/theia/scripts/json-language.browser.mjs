import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/); assert.equal(runtime.workspace, runtime.qa + '/project');
const runner = await readFile(fileURLToPath(import.meta.url)); await writeFile(runtime.qa + '/json-language-runner.mjs', runner, { flag: 'wx', mode: 0o600 });
const schema = { type: 'object', properties: { ecosystemBuildName: { type: 'string' }, networkMode: { enum: ['testnet'] } }, additionalProperties: false };
await writeFile(runtime.workspace + '/schema-fixture.json', JSON.stringify(schema), { flag: 'wx', mode: 0o600 });
await writeFile(runtime.workspace + '/ynx.config.json', '{}\n', { flag: 'wx', mode: 0o600 });
await writeFile(runtime.workspace + '/remote-schema.json', JSON.stringify({ $schema: 'https://json.schemastore.org/package', name: 'ynx-owned-schema-probe' }), { flag: 'wx', mode: 0o600 });
await writeFile(runtime.workspace + '/.vscode/settings.json', JSON.stringify({ 'json.schemas': [{ fileMatch: ['ynx.config.json'], url: './schema-fixture.json' }] }), { flag: 'wx', mode: 0o600 });
const browser = await chromium.launch({ headless: true }), page = await browser.newPage(), checks = [], errors = [], consoleErrors = [];
await page.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(30000);
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
const lines = () => page.locator('.monaco-editor .view-lines').filter({ visible: true }).last();
async function command(name) { await page.keyboard.press('Escape'); await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill('>' + name); await page.locator('.quick-input-list').getByText(name, { exact: true }).first().click(); }
async function open(name) { await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill(name); await page.locator('.quick-input-list').getByText(name, { exact: true }).first().click(); await lines().waitFor(); }
async function visibleText(expected) {
  let actual;
  const normalizeIndentation = value => value.split('\n').map(line => line.trim()).join('\n');
  for (let i = 0; i < 200; i++) {
    actual = await lines().locator('.view-line').evaluateAll(nodes => nodes.map(node => node.textContent.replace(/\u00a0/g, ' ')).join('\n'));
    if (normalizeIndentation(actual) === normalizeIndentation(expected)) return;
    await page.waitForTimeout(25);
  }
  assert.equal(normalizeIndentation(actual), normalizeIndentation(expected), 'Wait for the actual editor edit before the next command.');
}
async function type(text) { await lines().click(); await page.keyboard.press('Meta+a'); await page.keyboard.insertText(' ' + text); await visibleText(' ' + text); }
async function hoverDiagnostic(marker) {
  await marker.waitFor();
  const bounds = await marker.boundingBox(); assert.ok(bounds);
  // Monaco decorations sit below the visible text. Move the real pointer over
  // that text instead of asking the noninteractive decoration to receive it.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}
async function saveJson(expected, path, formatted = false, exactText) {
  await page.keyboard.press('Meta+s');
  let saved;
  for (let i = 0; i < 200; i++) {
    try {
      saved = await readFile(path, 'utf8');
      assert.deepEqual(JSON.parse(saved), expected);
      if (formatted) assert.ok(saved.split('\n').length > 2, 'Wait for formatted bytes, not the previous compact object.');
      if (exactText !== undefined) assert.equal(saved, exactText);
      return saved;
    } catch {}
    await page.waitForTimeout(50);
  }
  assert.fail('Saved JSON did not reach the expected ' + (formatted ? 'formatted ' : '') + 'disk state: ' + saved);
}
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) { assert.ok((await page.locator('body').innerText()).includes(runtime.workspace)); await trust.click(); }
  await open('ynx.config.json'); await page.getByText('JSON', { exact: true }).last().waitFor();
  await lines().locator('.view-line').first().click(); await page.keyboard.press('Meta+ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Control+Space');
  await page.locator('.suggest-widget.visible').getByText('ecosystemBuildName', { exact: false }).first().waitFor(); await page.keyboard.press('Escape');
  checks.push('Actual JSON mode and stock language server complete a property from an unopened local schema, absent from the active document.');
  const valid = { ecosystemBuildName: 'owned-fixture', networkMode: 'testnet' };
  await type(JSON.stringify({ networkMode: 'testnet', ecosystemBuildName: 'owned-fixture' }));
  await command('JSON: Sort Document');
  await lines().locator('.view-line').nth(3).waitFor();
  const sorted = await saveJson(valid, runtime.workspace + '/ynx.config.json', true);
  assert.ok(sorted.indexOf('ecosystemBuildName') < sorted.indexOf('networkMode'));
  checks.push('The contributed JSON Sort Document command activates the existing extension and uses its server to sort real saved properties.');
  await type(JSON.stringify(valid)); await command('Format Document');
  // The command palette closes before the language server returns edits. Observe
  // those edits before saving, otherwise Save correctly writes the old object.
  await lines().locator('.view-line').nth(3).waitFor();
  await saveJson(valid, runtime.workspace + '/ynx.config.json', true);
  const formatted = await readFile(runtime.workspace + '/ynx.config.json', 'utf8'); assert.ok(formatted.includes('\n') && formatted.split('\n').length > 2);
  const classes = await lines().locator('span').evaluateAll(nodes => [...new Set(nodes.map(n => n.className).filter(n => /^mtk\d/.test(n)))]); assert.ok(classes.length >= 2);
  checks.push('Real JSON formatter expands the saved object; syntax tokens have distinct textmate colors and the disk object remains exact.');
  await lines().click(); await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace');
  await page.keyboard.type(JSON.stringify(valid));
  await visibleText(JSON.stringify(valid));
  await saveJson(valid, runtime.workspace + '/ynx.config.json', false, JSON.stringify(valid));
  checks.push('Normal character-by-character JSON typing from an empty document overtypes automatically paired quotes/braces and saves the exact intended bytes.');
  await type(JSON.stringify({ networkMode: 'unapproved-mode', ecosystemBuildName: 42 }));
  const error = page.locator('.monaco-editor .squiggly-error, .monaco-editor .squiggly-warning').filter({ visible: true }).first(); await hoverDiagnostic(error);
  await page.getByText(/Valid values:.*testnet/).first().waitFor(); await page.screenshot({ path: runtime.qa + '/json-schema-error.png' });
  checks.push('Stock JSON language diagnostics reject a schema-invalid enum even though the document is syntactically valid JSON.');
  await type(JSON.stringify(valid)); await saveJson(valid, runtime.workspace + '/ynx.config.json');
  await command('Preferences: Open Keyboard Shortcuts (JSON)'); await page.getByText('JSON with Comments', { exact: true }).last().waitFor();
  await type('[{}]'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Control+Space');
  await page.locator('.suggest-widget.visible').getByText('command', { exact: true }).first().waitFor(); await page.keyboard.press('Escape');
  checks.push('The own profile shortcut file uses JSONC mode and completes command from the local YNX Tools schema, without a remote schema.');
  await type('// own shortcut configuration\n[]'); await page.keyboard.press('Meta+s');
  await open('remote-schema.json');
  // This stock client suppresses schema-resolution squiggles when download is
  // disabled and reports the reason through the LanguageStatusItem API instead.
  await page.locator('#status-bar-editor-language-status-items .codicon-bracket-error').waitFor();
  await page.locator('#status-bar-editor-language-status-items').hover();
  await page.getByText('Schema download issue', { exact: true }).waitFor();
  await page.getByText('Download disabled', { exact: true }).waitFor();
  checks.push('The unchanged stock language client reports Download disabled in its real language-status UI for a remote schema under the product default; no remote schema access is accepted.');
  assert.deepEqual(errors, []); await page.screenshot({ path: runtime.qa + '/json-language.png' });
} catch (e) { checks.push({ failure: String(e), text: await page.locator('body').innerText() }); process.exitCode = 1; }
finally { const result = { runtime, runnerSha256: createHash('sha256').update(runner).digest('hex'), checks, errors, consoleErrors, scope: 'Real isolated editor and existing unchanged JSON client/server. Own local schema/profile only; not canonical admission, remote schema access or other-platform acceptance.' }; await writeFile(runtime.qa + '/json-language-browser.json', JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 }); await browser.close(); console.log(JSON.stringify(result)); }
