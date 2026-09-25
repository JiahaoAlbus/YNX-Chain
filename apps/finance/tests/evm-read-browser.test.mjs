import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { secp256k1 } from '../../../packages/wallet-auth/node_modules/@noble/curves/secp256k1.js';
import { keccak_256 } from '../../../packages/wallet-auth/node_modules/@noble/hashes/sha3.js';
import { bytesToHex, concatBytes } from '../../../packages/wallet-auth/node_modules/@noble/hashes/utils.js';
import {
  createEvmProductSessionChallenge, ethereumPersonalMessageDigest,
  evmProductSessionMessage,
  issueEvmProductSession, verifyAndConsumeEvmProductSessionHttpProof,
  verifyAndConsumeEvmProductSessionRevokeProof,
} from '@ynx-chain/wallet-auth';

const bundle = await readFile(fileURLToPath(new URL('../web/evm-read-session.js', import.meta.url)));
const { build } = createRequire(new URL('../web/package.json', import.meta.url))('esbuild');
const walletSecret = new Uint8Array(32).fill(7);
const account = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(walletSecret, false).slice(1)).slice(-20))}`;
const origin = 'https://finance.ynxweb4.com';
const emptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><body>
<select id="finance-language"><option value="en">English</option><option value="zh-CN">简体中文</option></select>
<button id="evm-read-begin">Open read-only EVM account</button>
<button id="evm-read-refresh">Refresh read-only account</button>
<button id="evm-read-end">End read-only session</button>
<p id="evm-read-state"></p><p id="evm-read-summary"></p>
<a id="install-wallet" href="https://www.ynxweb4.com/dapp/download">Download YNX Wallet</a>
<a id="install-metamask" href="https://metamask.io/download/">Install MetaMask</a>
<script>window.walletStandard={status:'connected',chainId:'0x1917',account:'${account}',providerKind:'metamask'};window.walletRevision=1;window.YNXFinanceWallet={ready:Promise.resolve(),getStandardWalletState:()=>window.walletStandard,getStandardRevision:()=>window.walletRevision,signEVMLoginRequest:async request=>{try{return await window.signFinanceRequest(request)}catch{const error=new Error('USER_REJECTED');error.code=4001;throw error}}};</script>
<script src="/evm-read-session.js" defer></script></body></html>`;

function signMessage(message) {
  const signed = secp256k1.sign(ethereumPersonalMessageDigest(message), walletSecret, { prehash: false, format: 'recovered' });
  return `0x${bytesToHex(concatBytes(signed.slice(1), Uint8Array.of(signed[0] + 27)))}`;
}

test('browser read-only bundle is byte-reproducible from the shared Wallet/Auth root', async () => {
  const options = { entryPoints: [fileURLToPath(new URL('../scripts/evm-read-browser-entry.mjs', import.meta.url))], bundle: true, minify: true, platform: 'browser', target: 'es2022', write: false };
  const [first, second] = await Promise.all([build(options), build(options)]);
  assert.equal(first.outputFiles.length, 1);
  assert.equal(second.outputFiles.length, 1);
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), Buffer.from(second.outputFiles[0].contents));
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), bundle);
});

test('real Chromium preserves short EVM-only session across refresh and revokes on account change without tabs', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let challenge, session, revokeCount = 0;
  const used = new Set(), requests = [];
  try {
    await page.exposeFunction('signFinanceRequest', async request => signMessage(request.message));
    page.on('request', request => requests.push(request.url()));
    await page.route(`${origin}/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === '/test') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
      if (path === '/evm-read-session.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: bundle });
      if (path === '/api/evm-read/challenges') {
        const submitted = request.postDataJSON(), at = Date.now();
        challenge = createEvmProductSessionChallenge({ chainId: 6423, account, productId: 'finance', origin,
          callback: `${origin}/wallet-auth/callback`, scope: 'finance.account.read', deviceId: submitted.deviceId,
          deviceAlgorithm: 'p256-sha256', deviceKey: submitted.deviceKey, nonce: 'browser_login_nonce_0123456789abcdef',
          state: 'browser_login_state_0123456789abcdef', requestId: 'browser-finance-session-000001', providerKind: 'metamask',
          issuedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300000).toISOString() });
        const message = evmProductSessionMessage(challenge);
        const params = [`0x${Buffer.from(message).toString('hex')}`, account];
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'finance-evm-read-challenge-v1', challenge, signingRequest: { method: 'personal_sign', params, message }, privateFinanceAuthorized: false }) });
      }
      if (path === '/api/evm-read/sessions') {
        const proof = request.postDataJSON().proof, at = new Date();
        session = await issueEvmProductSession(proof, challenge, { sessionId: 'browser_finance_session_0123456789abcdef', expiresAt: new Date(at.getTime() + 300000).toISOString() }, async () => true, at);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'finance-evm-read-session-v1', session, evmAccountReadAuthorized: true, privateFinanceAuthorized: false, extensionLiveStateAttested: false }) });
      }
      if (path === '/api/evm-read/portfolio') {
        const proof = JSON.parse(Buffer.from(request.headers()['x-ynx-evm-read-proof'], 'base64url').toString());
        const target = new URL(request.url()).pathname;
        await verifyAndConsumeEvmProductSessionHttpProof(proof, async () => session, { origin, method: 'GET', target, bodyDigest: emptyDigest, requiredScope: 'finance.account.read', allowedTargets: ['/api/evm-read/portfolio'] }, { currentAccount: account, currentChainId: 6423, connected: true, revoked: false }, async ({ nonce }) => { if (used.has(nonce)) return false; used.add(nonce); return true; }, new Date());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'finance-evm-account-read-v1', account, portfolio: { account, balanceYnxt: 123, explorerStatus: { available: true } }, evmAccountReadAuthorized: true, privateFinanceAuthorized: false, extensionLiveStateAttested: false }) });
      }
      if (path === '/api/wallet-login/revoke') {
        const proof = JSON.parse(Buffer.from(request.headers()['x-ynx-evm-read-proof'], 'base64url').toString());
        await verifyAndConsumeEvmProductSessionRevokeProof(proof, async () => session, { origin, method: 'POST', target: path, bodyDigest: emptyDigest }, async () => { revokeCount++; return true; }, new Date());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'finance-evm-read-revoke-v1', revoked: true, standardWalletUnchanged: true }) });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${origin}/test`);
    await page.getByRole('button', { name: 'Authorize read-only account' }).click();
    await page.waitForFunction(() => window.YNXFinanceEVMRead?.state().active === true && document.querySelector('#evm-read-summary').textContent.includes('123 YNXT'));
    assert.equal(await page.locator('#evm-read-state').textContent(), 'Read-only EVM account is authorized for this short session. This does not authorize private native Finance, orders, or transfers.');
    assert.equal(await page.locator('#evm-read-begin').isHidden(), true);
    assert.equal(context.pages().length, 1);
    await page.evaluate(() => sessionStorage.setItem('ynx.finance.evm-read.pending.v1', JSON.stringify({ requestId: 'stale-reload-request' })));
    await page.reload();
    await page.waitForFunction(() => window.YNXFinanceEVMRead?.state().active === true);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('ynx.finance.evm-read.pending.v1')), null);
    await page.getByRole('button', { name: 'Refresh account view' }).click();
    await page.waitForFunction(() => document.querySelector('#evm-read-summary').textContent.includes('123 YNXT'));
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.match(await page.locator('#evm-read-state').textContent(), /只读/u);
    const revokeResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/wallet-login/revoke');
    await page.evaluate(() => { window.walletStandard = { status: 'wrong-chain', chainId: '0x1', account: window.walletStandard.account, providerKind: 'metamask' }; window.walletRevision++; window.dispatchEvent(new CustomEvent('ynx-finance-standard-state', { detail: window.walletStandard })); });
    await revokeResponse;
    await page.waitForFunction(() => window.YNXFinanceEVMRead?.state().active === false);
    assert.equal(revokeCount, 1);
    assert.equal(context.pages().length, 1);
    assert.equal(requests.some(url => url.startsWith('ynxwallet:')), false);
  } finally { await browser.close(); }
});

test('real Chromium retains Standard Wallet and official fallback when read-only signature is rejected', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.exposeFunction('signFinanceRequest', async () => { throw Object.assign(new Error('rejected'), { code: 4001 }); });
    await page.route(`${origin}/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/test') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
      if (path === '/evm-read-session.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: bundle });
      if (path === '/api/evm-read/challenges') {
        const submitted = route.request().postDataJSON(), at = Date.now();
        const challenge = createEvmProductSessionChallenge({ chainId: 6423, account, productId: 'finance', origin, callback: `${origin}/wallet-auth/callback`, scope: 'finance.account.read', deviceId: submitted.deviceId, deviceAlgorithm: 'p256-sha256', deviceKey: submitted.deviceKey, nonce: 'reject_login_nonce_0123456789abcdef', state: 'reject_login_state_0123456789abcdef', requestId: 'reject-finance-session-000001', providerKind: 'metamask', issuedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300000).toISOString() });
        const message = evmProductSessionMessage(challenge);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'finance-evm-read-challenge-v1', challenge, signingRequest: { method: 'personal_sign', params: [`0x${Buffer.from(message).toString('hex')}`, account], message }, privateFinanceAuthorized: false }) });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${origin}/test`);
    await page.getByRole('button', { name: 'Authorize read-only account' }).click();
    await page.waitForFunction(() => document.querySelector('#evm-read-state').textContent.includes('not approved'));
    assert.equal(await page.evaluate(() => window.YNXFinanceWallet.getStandardWalletState().status), 'connected');
    assert.equal(await page.evaluate(() => window.YNXFinanceEVMRead.state().active), false);
    assert.equal(await page.locator('#install-wallet').getAttribute('href'), 'https://www.ynxweb4.com/dapp/download');
    assert.equal(await page.locator('#install-metamask').getAttribute('href'), 'https://metamask.io/download/');
    assert.equal(page.context().pages().length, 1);
  } finally { await browser.close(); }
});

test('real Chromium keeps guest links usable without a connected Standard Wallet', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests = [];
  try {
    page.on('request', request => requests.push(request.url()));
    await page.route(`${origin}/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/test') return route.fulfill({ status: 200, contentType: 'text/html', body: html.replace("status:'connected'", "status:'disconnected'") });
      if (path === '/evm-read-session.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: bundle });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${origin}/test`);
    await page.waitForFunction(() => Boolean(window.YNXFinanceEVMRead));
    assert.equal(await page.locator('#evm-read-begin').isHidden(), true);
    assert.equal(await page.locator('#install-wallet').getAttribute('href'), 'https://www.ynxweb4.com/dapp/download');
    assert.equal(await page.locator('#install-metamask').getAttribute('href'), 'https://metamask.io/download/');
    assert.equal(requests.some(url => url.includes('/api/evm-read/')), false);
    assert.equal(page.context().pages().length, 1);
  } finally { await browser.close(); }
});
