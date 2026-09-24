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
  parseFinanceEvmSubjectChallenge, financeEvmSubjectSigningRequest, issueFinanceEvmSubjectSession,
  verifyAndConsumeFinanceEvmSubjectRead, verifyAndConsumeFinanceEvmSubjectRevoke,
  ethereumPersonalMessageDigest,
} from '@ynx-chain/wallet-auth';

const bundle = await readFile(fileURLToPath(new URL('../web/evm-subject.js', import.meta.url)));
const { build } = createRequire(new URL('../web/package.json', import.meta.url))('esbuild');
const walletSecret = new Uint8Array(32).fill(7);
const account = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(walletSecret, false).slice(1)).slice(-20))}`;
const origin = 'https://finance.ynxweb4.com';
const emptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><body>
<select id="finance-language"><option value="en">English</option><option value="zh-CN">简体中文</option></select>
<h3 id="evm-subject-heading"></h3><p id="evm-subject-explanation"></p>
<button id="evm-subject-begin"></button><button id="evm-subject-read"></button><button id="evm-subject-end"></button>
<p id="evm-subject-state"></p><p id="evm-subject-summary"></p>
<a id="install-wallet" href="https://www.ynxweb4.com/dapp/download">Download YNX Wallet</a>
<a id="install-metamask" href="https://metamask.io/download/">Install MetaMask</a>
<script>window.walletStandard={status:'connected',chainId:'0x1917',account:'${account}',providerKind:'metamask'};window.walletRevision=1;window.YNXFinanceWallet={ready:Promise.resolve(),getStandardWalletState:()=>window.walletStandard,getStandardRevision:()=>window.walletRevision,signEVMLoginRequest:async request=>{try{return await window.signFinanceRequest(request)}catch{const error=new Error('USER_REJECTED');error.code=4001;throw error}}};</script>
<script src="/evm-subject.js" defer></script></body></html>`;

function signMessage(message) {
  const signed = secp256k1.sign(ethereumPersonalMessageDigest(message), walletSecret, { prehash: false, format: 'recovered' });
  return `0x${bytesToHex(concatBytes(signed.slice(1), Uint8Array.of(signed[0] + 27)))}`;
}

test('EVM-only browser bundle is byte-reproducible from accepted Wallet/Auth root', async () => {
  const options = { entryPoints: [fileURLToPath(new URL('../scripts/evm-subject-browser-entry.mjs', import.meta.url))], bundle: true, minify: true, platform: 'browser', target: 'es2022', format: 'iife', write: false };
  const [first, second] = await Promise.all([build(options), build(options)]);
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), Buffer.from(second.outputFiles[0].contents));
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), bundle);
});

test('real local Chromium keeps EVM-only identity separate, restores and revokes without blank tabs', async () => {
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
      if (path === '/evm-subject.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: bundle });
      if (path === '/api/evm-subject/challenges') {
        const submitted = request.postDataJSON(), at = Date.now();
        challenge = parseFinanceEvmSubjectChallenge({ version: '1', productId: 'finance', subjectNamespace: 'evm', origin,
          callback: `${origin}/wallet-auth/callback`, chainId: 6423, account, accountType: 'eoa', scope: 'finance.evm.private.read',
          deviceId: submitted.deviceId, deviceAlgorithm: 'p256-sha256', deviceKey: submitted.deviceKey,
          nonce: 'browser_subject_nonce_0123456789abcdef', state: 'browser_subject_state_0123456789abcdef',
          requestId: 'browser-finance-subject-000001', issuedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300000).toISOString() });
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'finance-evm-subject-challenge-v1', challenge, signingRequest: financeEvmSubjectSigningRequest(challenge), brokerAuthorized: false }) });
      }
      if (path === '/api/evm-subject/sessions') {
        const proof = request.postDataJSON().proof;
        session = await issueFinanceEvmSubjectSession(proof, challenge, { sessionId: 'browser_finance_subject_session_0123456789', subjectId: 'evm_subject_' + 'a'.repeat(64), expiresAt: challenge.expiresAt }, async () => true, new Date());
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'finance-evm-subject-session-v1', session, evmSubjectReadAuthorized: true, nativeAccount: null, brokerAuthorized: false }) });
      }
      if (path === '/api/evm-subject/identity') {
        const proof = JSON.parse(Buffer.from(request.headers()['x-ynx-evm-subject-proof'], 'base64url').toString());
        const target = new URL(request.url()).pathname;
        await verifyAndConsumeFinanceEvmSubjectRead(proof, async () => session, { origin, method: 'GET', target, bodyDigest: emptyDigest, requiredScope: 'finance.evm.private.read', allowedTargets: ['/api/evm-subject/identity'] }, async ({ nonce }) => { if (used.has(nonce)) return false; used.add(nonce); return true; }, new Date());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'finance-evm-subject-identity-v1', subjectId: session.subjectId, evmAccount: account, nativeAccount: null, brokerAuthorized: false }) });
      }
      if (path === '/api/evm-subject/revoke') {
        const proof = JSON.parse(Buffer.from(request.headers()['x-ynx-evm-subject-proof'], 'base64url').toString());
        await verifyAndConsumeFinanceEvmSubjectRevoke(proof, async () => session, { origin, method: 'POST', target: path, bodyDigest: emptyDigest }, async () => { revokeCount++; return true; }, new Date());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'finance-evm-subject-revoke-v1', revoked: true, standardWalletUnchanged: true }) });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${origin}/test`);
    await page.getByRole('button', { name: 'Authorize EVM-only identity' }).click();
    await page.waitForFunction(() => window.YNXFinanceEVMSubject?.state().active === true && document.querySelector('#evm-subject-summary').textContent.includes('EVM-only'));
    assert.equal(await page.locator('#evm-subject-begin').isHidden(), true);
    assert.equal(context.pages().length, 1);
    assert.equal(await page.evaluate(() => window.YNXFinanceWallet.getStandardWalletState().status), 'connected');
    assert.equal(await page.evaluate(() => window.YNXFinanceEVMSubject.state().subjectId), session.subjectId);
    await page.reload();
    await page.waitForFunction(() => window.YNXFinanceEVMSubject?.state().active === true);
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.match(await page.locator('#evm-subject-state').textContent(), /EVM-only/u);
    const revokeResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/evm-subject/revoke');
    await page.evaluate(() => { window.walletStandard = { status: 'wrong-chain', chainId: '0x1', account: window.walletStandard.account, providerKind: 'metamask' }; window.walletRevision++; window.dispatchEvent(new CustomEvent('ynx-finance-standard-state', { detail: window.walletStandard })); });
    await revokeResponse;
    await page.waitForFunction(() => window.YNXFinanceEVMSubject?.state().active === false);
    assert.equal(revokeCount, 1);
    assert.equal(context.pages().length, 1);
    assert.equal(requests.some(url => url.startsWith('ynxwallet:')), false);
  } finally { await browser.close(); }
});

test('local Chromium rejects an EVM-only signature without dropping Standard Wallet or guest fallbacks', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.exposeFunction('signFinanceRequest', async () => { throw Object.assign(new Error('rejected'), { code: 4001 }); });
    await page.route(`${origin}/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/test') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
      if (path === '/evm-subject.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: bundle });
      if (path === '/api/evm-subject/challenges') {
        const submitted = route.request().postDataJSON(), at = Date.now();
        const challenge = parseFinanceEvmSubjectChallenge({ version: '1', productId: 'finance', subjectNamespace: 'evm', origin,
          callback: `${origin}/wallet-auth/callback`, chainId: 6423, account, accountType: 'eoa', scope: 'finance.evm.private.read',
          deviceId: submitted.deviceId, deviceAlgorithm: 'p256-sha256', deviceKey: submitted.deviceKey,
          nonce: 'reject_subject_nonce_0123456789abcdef', state: 'reject_subject_state_0123456789abcdef',
          requestId: 'reject-finance-subject-000001', issuedAt: new Date(at).toISOString(), expiresAt: new Date(at + 300000).toISOString() });
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'finance-evm-subject-challenge-v1', challenge, signingRequest: financeEvmSubjectSigningRequest(challenge), brokerAuthorized: false }) });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${origin}/test`);
    await page.getByRole('button', { name: 'Authorize EVM-only identity' }).click();
    await page.waitForFunction(() => document.querySelector('#evm-subject-state').textContent.includes('rejected'));
    assert.equal(await page.evaluate(() => window.YNXFinanceWallet.getStandardWalletState().status), 'connected');
    assert.equal(await page.evaluate(() => window.YNXFinanceEVMSubject.state().active), false);
    assert.equal(await page.locator('#install-wallet').getAttribute('href'), 'https://www.ynxweb4.com/dapp/download');
    assert.equal(await page.locator('#install-metamask').getAttribute('href'), 'https://metamask.io/download/');
    assert.equal(page.context().pages().length, 1);
    await page.evaluate(() => { window.walletStandard = { status: 'disconnected', chainId: null, account: null, providerKind: null }; window.walletRevision++; window.dispatchEvent(new CustomEvent('ynx-finance-standard-state', { detail: window.walletStandard })); });
    assert.equal(await page.locator('#evm-subject-begin').isHidden(), true);
  } finally { await browser.close(); }
});
