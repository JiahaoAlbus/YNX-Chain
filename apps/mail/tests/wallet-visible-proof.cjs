const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../../..');
const port = 18205;
const base = `http://127.0.0.1:${port}`;
const evidence = path.join(__dirname, '../evidence/visible');
fs.mkdirSync(evidence, {recursive: true});

const proc = spawn('go', ['run', './apps/mail'], {
  cwd: root,
  env: {
    ...process.env,
    YNX_MAIL_ADDR: `127.0.0.1:${port}`,
    YNX_MAIL_DATA_DIR: fs.mkdtempSync('/tmp/ynx-mail-wallet-visible-'),
  },
  stdio: 'inherit',
  detached: true,
});

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${base}/v1/health`)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('Mail server did not start');
}

function providerScript({reject}) {
  const provider = {
    request: async ({method}) => {
      if (method === 'eth_requestAccounts') {
        if (reject) throw Object.assign(new Error('User rejected the request'), {code: 4001});
        return ['0x1111111111111111111111111111111111111111'];
      }
      if (method === 'eth_chainId') return '0x1917';
      throw Object.assign(new Error('unsupported'), {code: 4200});
    },
    on() {},
  };
  addEventListener('eip6963:requestProvider', () => {
    dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {info: {uuid: reject ? 'ynx-mail-reject' : 'ynx-mail-approve', name: 'YNX Wallet'}, provider},
    }));
  });
}

(async () => {
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({headless: true});
    for (const scenario of [
      {name: 'approved-private-degraded', reject: false},
      {name: 'rejected-guest-preview', reject: true},
    ]) {
      const context = await browser.newContext({viewport: {width: 1440, height: 900}, locale: 'en-US'});
      await context.addInitScript(providerScript, {reject: scenario.reject});
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(base, {waitUntil: 'networkidle'});
      await page.locator('#wallet-signin').click();
      if (scenario.reject) {
        await page.locator('#signin-state').filter({hasText: 'WALLET_USER_REJECTED'}).waitFor();
        if ((await page.locator('#wallet-standard-state').textContent()).includes('CONNECTED')) throw new Error('Rejected Wallet unexpectedly connected');
      } else {
        await page.locator('#wallet-standard-state').filter({hasText: 'CONNECTED'}).waitFor();
        await page.locator('#signin-state').filter({hasText: 'Private Mail account service remains degraded'}).waitFor();
      }
      if (!(await page.locator('#guest-preview').isVisible())) throw new Error('Guest preview is not available');
      if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(', ')}`);
      await page.screenshot({
        path: path.join(evidence, `mail-wallet-${scenario.name}-1440x900.png`),
        fullPage: true,
      });
      await context.close();
    }
    console.log(JSON.stringify({
      product: 'mail',
      walletVisible: '2/2',
      approved: 'standard connection preserved; private Mail service degraded',
      rejected: 'no account or private session; guest preview preserved',
      installedWallet: false,
      publicRuntime: false,
      computerControl: false,
    }));
  } finally {
    if (browser) await browser.close();
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      proc.kill();
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
