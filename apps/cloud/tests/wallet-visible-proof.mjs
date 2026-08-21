import {spawn} from 'node:child_process';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';

const root = path.resolve(import.meta.dirname, '../../..');
const port = 18215;
const base = `http://127.0.0.1:${port}`;
const data = await mkdtemp(path.join(tmpdir(), 'ynx-cloud-wallet-visible-'));
const evidence = path.resolve(import.meta.dirname, '../evidence/visible');
await mkdir(evidence, {recursive: true});

const proc = spawn('go', ['run', './apps/cloud/cmd/ynx-cloudd', '-addr', `127.0.0.1:${port}`, '-data', data], {
  cwd: root,
  stdio: 'inherit',
  detached: true,
});
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('Cloud server did not start');
}
function installProvider({reject}) {
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
      detail: {info: {uuid: reject ? 'ynx-cloud-reject' : 'ynx-cloud-approve', name: 'YNX Wallet'}, provider},
    }));
  });
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({headless: true});
  for (const scenario of [
    {name: 'approved-private-degraded', reject: false},
    {name: 'rejected-guest-preview', reject: true},
  ]) {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, locale: 'en-US'});
    await context.addInitScript(installProvider, {reject: scenario.reject});
    const page = await context.newPage();
    const pageErrors = [];
    const privateRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/api/v1/')) privateRequests.push(request.url());
    });
    await page.goto(base, {waitUntil: 'networkidle'});
    await page.locator('#wallet').click();
    await page.locator('#auth-start').click();
    if (scenario.reject) {
      await page.locator('#auth-state').filter({hasText: /rejected/i}).waitFor();
      if ((await page.locator('#wallet').getAttribute('data-connected')) === 'true') throw new Error('Rejected Wallet unexpectedly connected');
    } else {
      await page.locator('#wallet').filter({hasText: '0x111111'}).waitFor();
      await page.locator('#auth-state').filter({hasText: 'Private Cloud files'}).waitFor();
      await page.locator('#status').filter({hasText: 'private service is degraded'}).waitFor();
    }
    if (!(await page.locator('#empty').isVisible())) throw new Error('Guest Cloud empty state is not visible');
    if (privateRequests.length) throw new Error(`private API requested before Product Session: ${privateRequests.join(', ')}`);
    if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(', ')}`);
    await page.screenshot({path: path.join(evidence, `cloud-wallet-${scenario.name}-1440x900.png`), fullPage: true});
    await context.close();
  }
  console.log(JSON.stringify({
    product: 'cloud',
    walletVisible: '2/2',
    approved: 'standard connection preserved; private Cloud service degraded',
    rejected: 'no account or private session; guest preview preserved',
    privateApiRequests: 0,
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
