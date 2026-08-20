const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const port = 30000 + (process.pid % 10000);
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync('/tmp/ynx-calendar-wallet-visible-');
const artifactDir = path.join(__dirname, '..', 'release', 'evidence', 'p0-075');
fs.mkdirSync(artifactDir, { recursive: true });

const server = spawn('go', ['run', './apps/calendar'], {
  cwd: root,
  env: {
    ...process.env,
    YNX_CALENDAR_ADDR: `127.0.0.1:${port}`,
    YNX_CALENDAR_DATA_DIR: dataDir,
    YNX_WALLET_VERIFY_URL: 'https://wallet-auth.ynxweb4.com',
  },
  detached: true,
  stdio: 'inherit',
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForServer() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Calendar server exited before ready');
    try {
      const response = await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('Calendar server readiness timeout');
}

function stopServer() {
  try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill('SIGTERM'); } catch {} }
}

async function installProvider(page, { reject = false } = {}) {
  await page.addInitScript(({ shouldReject }) => {
    const listeners = new Map();
    const provider = {
      request: async ({ method }) => {
        if (method === 'eth_requestAccounts') {
          if (shouldReject) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          return ['0x1111111111111111111111111111111111111111'];
        }
        if (method === 'eth_chainId') return '0x1917';
        throw Object.assign(new Error(`Unsupported ${method}`), { code: 4200 });
      },
      on: (event, listener) => { const group = listeners.get(event) ?? new Set(); group.add(listener); listeners.set(event, group); },
      removeListener: (event, listener) => listeners.get(event)?.delete(listener),
    };
    window.addEventListener('eip6963:requestProvider', () => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: '11111111-1111-4111-8111-111111111111', name: 'YNX Wallet', rdns: 'com.ynxweb4.wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' },
          provider,
        },
      }));
    });
  }, { shouldReject: reject });
}

(async () => {
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({
      headless: true,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });

    const approved = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    const approvedErrors = [];
    approved.on('pageerror', (error) => approvedErrors.push(error.message));
    await installProvider(approved);
    await approved.goto(base, { waitUntil: 'networkidle' });
    await approved.locator('#wallet-signin').click();
    await approved.locator('#signin').waitFor({ state: 'hidden' });
    const accountBoundary = await approved.locator('#account').getAttribute('aria-label');
    if (!accountBoundary?.includes('YNX Wallet 0x1111…1111 connected on YNX Testnet')) throw new Error(`Unexpected account boundary: ${accountBoundary}`);
    if (approvedErrors.length) throw new Error(`Approved page errors: ${approvedErrors.join('; ')}`);
    await approved.screenshot({ path: path.join(artifactDir, 'calendar-standard-wallet-connected.png'), fullPage: true });

    const rejected = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const rejectedErrors = [];
    rejected.on('pageerror', (error) => rejectedErrors.push(error.message));
    await installProvider(rejected, { reject: true });
    await rejected.goto(base, { waitUntil: 'networkidle' });
    await rejected.locator('#wallet-signin').click();
    await rejected.locator('#signin-state').filter({ hasText: 'Wallet connection was rejected.' }).waitFor();
    const rejection = await rejected.locator('#signin-state').innerText();
    if (rejection !== 'Wallet connection was rejected. No account or Calendar session was created.') throw new Error(`Unexpected rejection: ${rejection}`);
    if (await rejected.locator('#signin').isHidden()) throw new Error('Rejected connection incorrectly entered the Calendar app');
    if (rejectedErrors.length) throw new Error(`Rejected page errors: ${rejectedErrors.join('; ')}`);
    await rejected.screenshot({ path: path.join(artifactDir, 'calendar-standard-wallet-rejected.png'), fullPage: true });

    console.log(JSON.stringify({
      sourceType: 'deterministic-eip6963-browser-provider',
      approved: true,
      rejectedFailClosed: true,
      guestStillAvailable: await rejected.locator('#guest-try').isVisible(),
      accountBoundary,
      privateServiceState: 'PRIVATE_SERVICE_DEGRADED',
      installedWalletVerified: false,
      productSessionV2: false,
      consoleErrors: 0,
    }));
  } finally {
    await browser?.close();
    stopServer();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
