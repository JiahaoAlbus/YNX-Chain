import { describe, expect, it } from 'vitest';
import { connectStandardWallet } from './connection';

const account = '0x1111111111111111111111111111111111111111';

function provider(name: string) {
  const calls: string[] = [];
  return {
    name,
    calls,
    request: async ({ method }: { method: string }) => {
      calls.push(method);
      if (method === 'eth_requestAccounts') return [account];
      if (method === 'eth_chainId') return '0x1917';
      throw Object.assign(new Error(`Unsupported ${method}`), { code: 4200 });
    },
  };
}

function announcedWindow(entries: Array<{ name: string; rdns: string; provider: ReturnType<typeof provider> }>) {
  const target = new EventTarget() as Window;
  target.addEventListener('eip6963:requestProvider', () => {
    entries.forEach((entry, index) => target.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: `11111111-1111-4111-8111-11111111111${index}`, name: entry.name, rdns: entry.rdns },
        provider: entry.provider,
      },
    })));
  });
  return target;
}

describe('Governance standard wallet consumption', () => {
  it('selects YNX Wallet ahead of another announced provider without creating governance authority', async () => {
    const metaMask = provider('MetaMask');
    const ynx = provider('YNX Wallet');
    const result = await connectStandardWallet(announcedWindow([
      { name: 'MetaMask', rdns: 'io.metamask', provider: metaMask },
      { name: 'YNX Wallet', rdns: 'com.ynx.wallet', provider: ynx },
    ]), 'ynx');

    expect(result).toEqual({ account, chainId: '0x1917', walletName: 'YNX Wallet', state: 'STANDARD_CONNECTED' });
    expect(ynx.calls).toEqual(['eth_requestAccounts', 'eth_chainId', 'eth_chainId', 'eth_chainId']);
    expect(metaMask.calls).toEqual([]);
    expect(result).not.toHaveProperty('productSession');
    expect(result).not.toHaveProperty('governanceAuthority');
  });

  it('fails clearly when the requested wallet is not installed', async () => {
    await expect(connectStandardWallet(announcedWindow([]), 'ynx')).rejects.toThrow('YNX Wallet was not found.');
  });
});

