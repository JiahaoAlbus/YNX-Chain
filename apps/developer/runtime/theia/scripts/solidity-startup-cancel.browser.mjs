import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
const tag = process.argv[3] || 'startup-cancel'; assert.match(tag, /^[a-z0-9-]{1,40}$/);
const source = 'pragma solidity 0.8.24; import "./lib/Math.sol"; contract Use { function ping() public pure returns(uint256) { return Math.value(); } }';
await mkdir(runtime.workspace + '/contracts/lib', { recursive: true });
async function fixture(file, content) {
  try { await writeFile(file, content, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await readFile(file, 'utf8'), content); }
}
await fixture(runtime.workspace + '/contracts/Use.sol', source);
await fixture(runtime.workspace + '/contracts/lib/Math.sol', 'pragma solidity 0.8.24; library Math { function value() internal pure returns(uint256) { return 3; } }');
await writeFile(runtime.qa + '/' + tag + '-runner.mjs', await readFile(new URL(import.meta.url)), { flag: 'wx' });
const browser = await chromium.launch({ headless: true }), page = await browser.newPage(), errors = [], observations = [];
let passed = false; page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
async function open(file) {
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill(file);
  await page.locator('.quick-input-list').getByText(file, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForFunction(file => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    return c.get(id).currentEditor?.editor.uri.toString().endsWith('/' + file);
  }, file);
}
try {
  await page.goto(runtime.url); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && typeof id.prototype.reachedState === 'function' && typeof id.prototype.doSetState === 'function');
    await c.get(id).reachedState('ready');
  });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) await trust.click();
  await open('Use.sol');
  observations.push(await page.evaluate(column => {
    const c = window.theia.container, keys = [...c._bindingDictionary._map.keys()];
    const eid = keys.find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    const control = c.get(eid).currentEditor.editor.getControl(); control.setPosition({ lineNumber: 1, column }); control.focus();
    const rid = keys.find(id => typeof id === 'function' && typeof id.prototype.registerHandler === 'function' && typeof id.prototype.executeCommand === 'function');
    const registry = c.get(rid), pid = keys.find(id => typeof id === 'function' && typeof id.prototype.activateByLanguage === 'function');
    window.__definitionStarted = false; window.__definitionFinished = false;
    registry.onWillExecuteCommand(event => { if (event.commandId === 'editor.action.revealDefinition') window.__definitionStarted = true; });
    registry.onDidExecuteCommand(event => { if (event.commandId === 'editor.action.revealDefinition') window.__definitionFinished = true; });
    return { initialPluginState: c.get(pid).deferredDidStart.state, sourceVersion: control.getModel().getVersionId() };
  }, source.indexOf('Math.value') + 6));
  await page.keyboard.press('F12');
  const pending = await page.evaluate(() => ({ started: window.__definitionStarted, finished: window.__definitionFinished }));
  observations.push({ beforeSwitch: pending }); assert.equal(pending.started, true); assert.equal(pending.finished, false);
  await open('main.js');
  await page.waitForFunction(() => window.__definitionFinished);
  const final = await page.evaluate(() => {
    const c = window.theia.container, id = [...c._bindingDictionary._map.keys()].find(id => typeof id === 'function' && 'currentEditor' in id.prototype && typeof id.prototype.getByUri === 'function');
    return c.get(id).currentEditor.editor.uri.toString();
  });
  assert.ok(final.endsWith('/main.js')); observations.push({ final, pendingCommandCompleted: true });
  assert.equal(await readFile(runtime.workspace + '/contracts/Use.sol', 'utf8'), source);
  assert.deepEqual(errors, []); passed = true;
  await page.screenshot({ path: runtime.qa + '/' + tag + '.png' });
} catch (error) { errors.push({ message: error.message, stack: error.stack }); await page.screenshot({ path: runtime.qa + '/' + tag + '-error.png' }).catch(() => {}); }
finally {
  await browser.close();
  await writeFile(runtime.qa + '/' + tag + '-ui.json', JSON.stringify({ passed, errors, observations, actualEditor: true, firstF12ThenOrdinaryFileSwitch: true, languageStatusCommandInvoked: false, runtimeFunctionsInjected: false, canonical: false, realWallet: false, fullRuntimeInput: runtime.plugins === runtime.root + '/plugins' }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ passed, errors, observations })); if (!passed) process.exitCode = 1;
}
