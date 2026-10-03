import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
if (!process.env.YNX_QA_TOOLS_URL) throw new Error('YNX_QA_TOOLS_URL must name the isolated native-tools fixture');
const browser = await chromium.launch({ headless: true }), checks = [], errors = [], traces = [];
let passed = false;
async function harness() {
  const page = await browser.newPage(), state = { contextStatus: 200, contexts: 0 };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const listeners = new Map(), calls = [];
    const state = { account: '0x' + '1'.repeat(40), chainId: '0x1917', holdAccounts: false, accountReadPending: false, releaseAccounts: null };
    const provider = { isYNXWallet: true, isMetaMask: false, rdns: 'com.ynx.wallet',
      async request(input) {
        calls.push(input.method);
        if (input.method === 'wallet_switchEthereumChain') { state.chainId = input.params[0].chainId; return null; }
        if (input.method === 'eth_requestAccounts') return [state.account];
        if (input.method === 'eth_chainId') return state.chainId;
        if (input.method === 'eth_accounts') {
          const snapshot = [state.account];
          if (state.holdAccounts) { state.accountReadPending = true; await new Promise(resolve => { state.releaseAccounts = resolve; }); }
          return snapshot;
        }
        throw new Error('Unexpected Wallet method: ' + input.method);
      },
      on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener); },
      removeListener(event, listener) { listeners.get(event)?.delete(listener); },
    };
    window.ethereum = provider;
    window.__nativeWallet = { state, calls,
      emit(event, value) {
        if (event === 'accountsChanged') state.account = value[0] || '';
        if (event === 'chainChanged') state.chainId = value;
        for (const listener of [...(listeners.get(event) || [])]) listener(value);
      },
      listenerCount() { return [...listeners.values()].reduce((sum, value) => sum + value.size, 0); },
    };
  });
  await page.route('**/runtime/native-tools/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/context')) state.contexts++;
    const status = state.contextStatus;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200
      ? { csrf: 'fresh', account: 'Wallet-project-account', projectId: 'project-A', expiresAt: Date.now() + 60_000 }
      : { error: 'Wallet project ended. Sign in again.', code: 'tools_identity_changed' }) });
  });
  await page.goto(process.env.YNX_QA_TOOLS_URL);
  await page.getByRole('button', { name: 'Review YNX Wallet connection', exact: true }).waitFor();
  return { page, state,
    connect: () => page.getByRole('button', { name: 'Review YNX Wallet connection', exact: true }).click(),
    async ready() { await page.getByText(/^Wallet approved account 0x/).waitFor(); assert.equal(await page.evaluate(() => window.__nativeWallet.listenerCount()), 3); },
    async close() { traces.push(await page.evaluate(() => ({ calls: window.__nativeWallet.calls, listeners: window.__nativeWallet.listenerCount() }))); await page.close(); },
  };
}
try {
  for (const [event, value] of [['accountsChanged', ['0x' + '2'.repeat(40)]], ['chainChanged', '0x1'], ['disconnect', { code: 4900 }]]) {
    const h = await harness();
    try {
      await h.connect(); await h.ready(); const before = h.state.contexts;
      const rechecked = h.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/context'));
      await h.page.evaluate(({ event, value }) => window.__nativeWallet.emit(event, value), { event, value });
      await h.page.getByText('The selected Wallet account, network or connection changed. Review the Wallet connection again.', { exact: true }).waitFor();
      await h.page.waitForFunction(() => window.__nativeWallet.listenerCount() === 0);
      assert.equal(await h.page.getByText(/^Wallet approved account 0x/).count(), 0);
      await rechecked;
      assert.ok(h.state.contexts > before);
      assert.equal(await h.page.evaluate(() => window.__nativeWallet.calls.filter(method => method === 'eth_requestAccounts').length), 1);
      checks.push(event + ' retires the approved account, removes listeners and rechecks the core without new approval');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      await h.page.evaluate(() => { window.__nativeWallet.state.holdAccounts = true; });
      await h.connect(); await h.page.waitForFunction(() => window.__nativeWallet.state.accountReadPending);
      await h.page.evaluate(() => window.__nativeWallet.emit('accountsChanged', ['0x' + '2'.repeat(40)]));
      await h.page.getByText('The selected Wallet account, network or connection changed. Review the Wallet connection again.', { exact: true }).waitFor();
      await h.page.evaluate(() => window.__nativeWallet.state.releaseAccounts());
      await h.page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Review YNX Wallet connection')?.disabled === false);
      assert.equal(await h.page.getByText(/^Wallet approved account 0x/).count(), 0);
      assert.equal(await h.page.evaluate(() => window.__nativeWallet.listenerCount()), 0);
      checks.push('late passive account result cannot restore an approval retired by a provider event');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      await h.connect(); await h.ready();
      await h.page.evaluate(() => { window.__nativeWallet.state.account = '0x' + '2'.repeat(40); window.dispatchEvent(new Event('focus')); });
      await h.page.getByText('The selected Wallet account, network or connection changed. Review the Wallet connection again.', { exact: true }).waitFor();
      assert.equal(await h.page.evaluate(() => window.__nativeWallet.calls.filter(method => method === 'eth_requestAccounts').length), 1);
      checks.push('focus passively detects a missing provider event without requesting accounts');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      await h.connect(); await h.ready(); h.state.contextStatus = 401;
      await h.page.evaluate(() => window.__nativeWallet.emit('disconnect', { code: 4900 }));
      await h.page.getByRole('link', { name: 'Sign in with YNX Wallet', exact: true }).waitFor();
      assert.equal(await h.page.evaluate(() => window.__nativeWallet.listenerCount()), 0);
      assert.equal(await h.page.getByText(/^Wallet approved account 0x/).count(), 0);
      checks.push('core identity rejection retires the private page and its Wallet listeners');
    } finally { await h.close(); }
  }
  assert.deepEqual(errors, []);
  assert.ok(traces.every(trace => trace.calls.every(method => ['wallet_switchEthereumChain', 'eth_requestAccounts', 'eth_chainId', 'eth_accounts'].includes(method))));
  passed = true;
} finally {
  await browser.close();
  if (process.env.YNX_QA_NATIVE_WALLET_RECEIPT) await writeFile(process.env.YNX_QA_NATIVE_WALLET_RECEIPT, JSON.stringify({ passed, checks, errors, traces, actualReact: true, actualChromium: true, wallet: 'controlled injected EIP-1193 provider', backend: 'controlled routes', signed: false, submitted: false, public: false }, null, 2));
}
console.log(JSON.stringify({ passed, checks, errors }));
