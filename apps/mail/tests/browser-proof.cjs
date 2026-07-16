const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const port = 18195;
const walletPort = 19195;
const base = `http://127.0.0.1:${port}`;
const artifact = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifact, { recursive: true });

const wallet = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    let proof;
    try { proof = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    const valid = req.method === 'POST' && req.url === '/v1/wallet-auth/verify-session' &&
      proof?.registryEntry && proof?.authorizationRequest && proof?.walletApproval && proof?.gatewayCompletion;
    if (!valid) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end('{"error":"invalid central proof"}');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      verifierVersion: 'wallet-auth-v1', productClientId: 'ynx-mail-v1',
      bundleId: 'com.ynxweb4.mail', account: 'ynx1browserproof',
      scopes: ['mail:account'], expiresAt: new Date(Date.now() + 60_000).toISOString()
    }));
  });
}).listen(walletPort, '127.0.0.1');

const proc = spawn('go', ['run', './apps/mail'], {
  cwd: root,
  env: { ...process.env, YNX_MAIL_ADDR: `127.0.0.1:${port}`, YNX_MAIL_DATA_DIR: fs.mkdtempSync('/tmp/ynx-mail-browser-'), YNX_WALLET_VERIFY_URL: `http://127.0.0.1:${walletPort}` },
  stdio: 'inherit', detached: true
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/v1/health`)).ok) return; } catch {}
    await sleep(200);
  }
  throw Error('Mail server did not start');
}
async function api(url, method = 'GET', body, token) {
  const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Error(JSON.stringify(value));
  return value;
}
function unnamedInteractive() {
  return [...document.querySelectorAll('button,a,input,select,textarea')]
    .filter(element => !((element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || '').trim()))
    .map(element => element.outerHTML.slice(0, 120));
}

(async () => {
  let browser;
  try {
    await wait();
    const challenge = await api('/v1/auth/challenges', 'POST', {});
    const authorizationRequest = { version: 'wallet-auth-v1', nonce: `browser-${Date.now()}`, productClientId: 'ynx-mail-v1' };
    const proof = {
      account: 'ynx1browserproof', handle: '@proof', product: 'com.ynx.mail', scopes: ['mail:account'], challenge: challenge.id,
      device_key: 'browser-proof-device', expires_at: Math.floor(Date.now() / 1000) + 60, signature: 'remote-wallet-proof',
      central: { registryEntry: { clientId: 'ynx-mail-v1' }, authorizationRequest, walletApproval: { approved: true }, gatewayCompletion: { completed: true } }
    };
    const session = await api('/v1/auth/sessions', 'POST', proof);
    const draft = await api('/v1/drafts', 'POST', { to: ['@proof'], subject: 'Bounded delivery proof', body: 'This message proves persistent YNX-local delivery, signed sender identity, thread reading, search, archive and Trust controls.' }, session.token);
    await api(`/v1/drafts/${draft.id}/send`, 'POST', {}, session.token);
    browser = await chromium.launch({ headless: true });
    for (const config of [{ name: 'desktop', width: 1440, height: 960 }, { name: 'mobile', width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, reducedMotion: 'reduce' });
      await context.addInitScript(({ token, user }) => { localStorage.setItem('ynx.mail.session', token); localStorage.setItem('ynx.mail.user', JSON.stringify(user)); }, { token: session.token, user: session.user });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('.message').first().click();
      await page.locator('.verified').waitFor();
      const unnamed = await page.evaluate(unnamedInteractive);
      if (unnamed.length) throw Error(`unnamed controls: ${unnamed.join(',')}`);
      if (errors.length) throw Error(`page errors: ${errors.join(',')}`);
      await page.screenshot({ path: path.join(artifact, `mail-${config.name}.png`), fullPage: true });
      await context.close();
    }
    console.log(JSON.stringify({ product: 'mail', desktop: 'apps/mail/tests/artifacts/mail-desktop.png', mobile: 'apps/mail/tests/artifacts/mail-mobile.png', accessibility: 'interactive controls named', consoleErrors: 0 }));
  } finally {
    if (browser) await browser.close();
    wallet.close();
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
