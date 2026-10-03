import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtimes = await Promise.all(process.argv.slice(2, 4).map(async path => JSON.parse(await readFile(path, 'utf8'))));
assert.equal(runtimes.length, 2);
for (const runtime of runtimes) {
  assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
  assert.equal(runtime.workspace, `${runtime.qa}/project`);
  assert.equal(runtime.profile, `${runtime.qa}/profile`);
  process.kill(runtime.pid, 0);
}
const [alpha, beta] = runtimes;
assert.notEqual(alpha.pid, beta.pid); assert.notEqual(alpha.qa, beta.qa);
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${alpha.qa}/parallel-profile-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
const browser = await chromium.launch({ headless: true });
const pages = [], errors = [];
try {
  for (const runtime of runtimes) {
    const context = await browser.newContext();
    await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
    const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(runtime.url); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
    const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true });
    if (await trust.count()) await trust.click();
    await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('main.js');
    await page.locator('.quick-input-list').getByText('main.js', { exact: true }).first().click();
    await page.locator('.monaco-editor .view-lines').first().waitFor();
  }
  const settingsA = JSON.parse(await readFile(`${alpha.profile}/settings.json`, 'utf8'));
  const settingsB = JSON.parse(await readFile(`${beta.profile}/settings.json`, 'utf8'));
  assert.equal(settingsA['editor.fontSize'], 17);
  assert.equal(settingsB['editor.fontSize'], undefined);
  for (const [index, size] of [17, 13].entries()) await pages[index].waitForFunction(size => [...document.querySelectorAll('.monaco-editor .view-line')].some(node => getComputedStyle(node).fontSize === `${size}px`), size);
  const page = pages[0]; await page.keyboard.press('F1');
  await page.locator('.quick-input-box input').fill('>Terminal: Create New Terminal (In Active Workspace)');
  await page.locator('.quick-input-list').getByText('Terminal: Create New Terminal (In Active Workspace)', { exact: true }).first().click();
  const terminal = page.locator('.xterm-helper-textarea').last(); await terminal.waitFor({ state: 'attached' }); await terminal.focus();
  const code = `const fs=require("node:fs");const result={};try{fs.readFileSync(${JSON.stringify(`${beta.profile}/settings.json`)});result.read="allowed"}catch(e){result.read=e.code}try{fs.writeFileSync(${JSON.stringify(`${beta.workspace}/cross-session-write.txt`)},"forbidden");result.write="allowed"}catch(e){result.write=e.code}fs.writeFileSync("parallel-profile-proof.json",JSON.stringify(result))`;
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  await terminal.pressSequentially(`node -e ${quote(code)}`); await terminal.press('Enter');
  let proof;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { proof = JSON.parse(await readFile(`${alpha.workspace}/parallel-profile-proof.json`, 'utf8')); break; } catch {}
    await page.waitForTimeout(50);
  }
  assert.ok(proof); assert.match(proof.read, /^(EPERM|EACCES)$/); assert.match(proof.write, /^(EPERM|EACCES)$/);
  await assert.rejects(readFile(`${beta.workspace}/cross-session-write.txt`), { code: 'ENOENT' });
  assert.deepEqual(errors, []);
  const receipt = { runtimes, runnerSha256: createHash('sha256').update(bytes).digest('hex'), errors, proof,
    checks: ['Two real contained workbench backends run concurrently with independent profiles, rendered font preferences 17 and 13.', 'Actual alpha PTY refuses reading the other running profile and writing the other running project, with permission errors and no write side effect.'],
    scope: 'Two synthetic macOS sessions. Not canonical multi-user authorization, hard quota, resource exhaustion, backend restart or production capacity acceptance.' };
  await writeFile(`${alpha.qa}/parallel-profile-browser.json`, JSON.stringify(receipt, null, 2));
  await page.screenshot({ path: `${alpha.qa}/parallel-profile-browser.png` }); console.log(JSON.stringify(receipt));
} catch (error) {
  await writeFile(`${alpha.qa}/parallel-profile-failure.json`, JSON.stringify({ error: String(error), errors, texts: await Promise.all(pages.map(page => page.locator('body').innerText())) }, null, 2));
  throw error;
} finally { await browser.close(); }
