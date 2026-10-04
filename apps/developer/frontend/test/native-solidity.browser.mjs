import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createNativeToolsService } from '../../services/codeoss-service/src/tools-service.mjs';
import { createSolidityCompiler } from '../../services/codeoss-service/src/solidity-compiler.mjs';
import { compilerReadiness } from '../../scripts/compiler-pin.mjs';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const target = process.env.YNX_QA_TOOLS_URL, output = process.env.YNX_QA_SOLIDITY_RECEIPT;
if (!target || !output || new URL(target).hostname !== '127.0.0.1') throw Error('An owned loopback preview and new receipt are required.');
assert.equal(compilerReadiness().available, true);
const origin = new URL(target).origin, sessionId = new URL(target).searchParams.get('sessionId');
const source = '// SPDX-License-Identifier: MIT\npragma solidity 0.8.24; contract PinCheck { function ping() external pure returns(uint256) { return 1; } }\n';
let projectId = 'project-A', started = false, responded = false;
const realCompiler = createSolidityCompiler(), calls = [], checks = [], errors = [];
const compiler = { async compile(value) { started = true; return realCompiler.compile(value); } };
const tools = createNativeToolsService({ compiler, admittedOwners: new WeakMap(), coreService: {
  async authorizeConnection(request, id) {
    assert.equal(id, sessionId);
    return { context: { owner:'fixture-owner', projectId, sessionId, runtimeId:'fixture-runtime' }, identity:{ account:'fixture-account', generation:1, identityReference:'fixture-reference' }, expiresAt:Date.now()+60000 };
  } },
});
const server = createServer((request, response) => tools.handler(request, response));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless:true });
try {
  for (const mode of ['compile-and-diagnostics', 'late-project-change']) {
    projectId = 'project-A'; started = false; responded = false;
    const context = await browser.newContext({ acceptDownloads:true }), page = await context.newPage();
    page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/runtime/native-tools/')) return route.continue();
      // Loopback fixture bridges only origin headers. The real Tools handler
      // still checks them and the actual one-use ticket/body on its HTTP socket.
      const result = await new Promise((resolve, reject) => {
        const request = httpRequest({ hostname:'127.0.0.1', port:server.address().port, path:url.pathname+url.search, method:route.request().method(), headers:{ host:'developer.ynxweb4.com', origin:'https://developer.ynxweb4.com', 'sec-fetch-site':'same-origin', 'content-type':'application/json' } }, response => {
          let body=''; response.on('data', chunk => body+=chunk); response.on('end', () => resolve({ status:response.statusCode, body }));
        }); request.on('error', reject); request.end(route.request().postData() || undefined);
      });
      calls.push({ mode, path:url.pathname, status:result.status });
      await route.fulfill({ status:result.status, contentType:'application/json', body:result.body }).catch(() => {});
      if (url.pathname.endsWith('/chain/compile')) responded = true;
    });
    await page.goto(target);
    await page.getByLabel('Contract name', { exact:true }).fill('PinCheck');
    await page.getByLabel('Solidity source', { exact:true }).fill(source);
    await page.getByRole('button', { name:'Compile contract', exact:true }).click();
    if (mode === 'compile-and-diagnostics') {
      await page.getByRole('heading', { name:'Compiled artifact', exact:true }).waitFor();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name:'Download compiled artifact' }).click();
      const download = await downloadPromise, artifact = JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.equal(artifact.source, source); assert.equal(artifact.compiler.version, '0.8.24');
      assert.equal(artifact.sourceSha256, createHash('sha256').update(source).digest('hex'));
      assert.ok(artifact.abi.some(item => item.name === 'ping')); assert.equal(artifact.projectId, 'project-A');
      assert.equal(artifact.signed, false); assert.equal(artifact.submitted, false);
      await page.screenshot({ path:output+'.png', fullPage:true });
      checks.push('Actual compiled React page → real HTTP Tools handler → pinned worker → downloaded ABI/bytecode/source-bound artifact.');
      await page.getByLabel('Solidity source', { exact:true }).fill('pragma solidity 0.8.24; contract PinCheck { broken }');
      assert.equal(await page.getByRole('heading', { name:'Compiled artifact', exact:true }).count(), 0);
      await page.getByRole('button', { name:'Compile contract', exact:true }).click();
      await page.getByRole('heading', { name:'Compiler diagnostics', exact:true }).waitFor();
      assert.equal(await page.getByRole('button', { name:'Download compiled artifact' }).count(), 0);
      assert.equal(await page.getByRole('button', { name:'Compile contract' }).isEnabled(), true);
      checks.push('Real Solidity syntax errors render diagnostics, retire the old artifact and allow a corrected build.');
      await page.getByLabel('Solidity source', { exact:true }).fill('😀'.repeat(22000));
      assert.equal(await page.getByRole('button', { name:'Compile contract' }).isEnabled(), false);
      checks.push('The source limit measures UTF-8 bytes rather than JavaScript character count.');
    } else {
      for (let i=0;i<200 && !started;i++) await page.waitForTimeout(10);
      assert.equal(started, true); projectId = 'project-B';
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByRole('button', { name:'Refresh workspace connection' }).waitFor();
      await page.getByRole('button', { name:'Refresh workspace connection' }).click();
      await page.getByRole('button', { name:'Compile contract' }).waitFor();
      for (let i=0;i<1000 && !responded;i++) await page.waitForTimeout(10);
      assert.equal(responded, true);
      assert.equal(await page.getByRole('heading', { name:'Compiled artifact', exact:true }).count(), 0);
      assert.equal(await page.getByLabel('Solidity source', { exact:true }).inputValue(), source);
      assert.equal(await page.getByLabel('Contract name', { exact:true }).inputValue(), 'PinCheck');
      assert.equal(await page.getByRole('button', { name:'Refresh workspace connection' }).count(), 0);
      assert.ok(calls.some(call => call.mode === mode && call.path.endsWith('/chain/compile') && call.status === 401));
      checks.push('A real build finishing after project change is rejected; refresh preserves only the unsent source draft and late results cannot retire the new identity.');
    }
    await context.close();
  }
  assert.deepEqual(errors, []); assert.equal(realCompiler.status().active, 0);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(output, JSON.stringify({ checks, errors, calls, actualReact:true, actualHTTP:true, actualCompiler:true, identity:'controlled canonical admission fixture', originBridge:'loopback test only', realWallet:false, chainExecutionVerified:false, public:false }, null, 2), { flag:'wx' });
}
console.log(JSON.stringify({ checks:checks.length, errors }));
