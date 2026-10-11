import {exactObject, multiError} from './multichain-config.mjs';
import {validateFamilyNetwork} from './multichain-family-networks.mjs';
import {createFamilyReadTransport} from './multichain-family-transport.mjs';
import {effectiveFamilyNetworks} from './multichain-family-defaults.mjs';
const changed = () => multiError('MULTICHAIN_CONTEXT_CHANGED', 'Account or network changed. Check the selected account again.');
async function adapter(network) {
  const transport = createFamilyReadTransport({family: network.family, networkId: network.network, baseURL: network.rpcUrl});
  if (network.family === 'bitcoin') { const {BitcoinReadAdapter} = await import('./multichain-bitcoin.mjs'); return new BitcoinReadAdapter({network: network.network, request: transport}); }
  const {TronReadAdapter} = await import('./multichain-tron.mjs'); return new TronReadAdapter({network: {id: network.network, genesisBlockId: network.genesis}, transport});
}
export class FamilyRead {
  constructor({networks, accounts, getContext, createAdapter = adapter}) { Object.assign(this, {networks, accounts, getContext, createAdapter}); }
  async snapshot() { return effectiveFamilyNetworks(await this.networks.read()); }
  async configure(input) {
    const network = validateFamilyNetwork(input), context = await this.getContext(), before = await this.networks.read();
    const reader = await this.createAdapter(network); await reader.verify();
    const current = await this.getContext();
    if (current.account !== context.account || current.revision !== context.revision || (await this.networks.read()).revision !== before.revision) throw changed();
    return this.networks.put(network, before.revision);
  }
  async balances(input) {
    exactObject(input, ['family', 'network']);
    const context = await this.getContext(), before = await this.networks.read();
    const network = effectiveFamilyNetworks(before).networks.find(n => n.family === input.family && n.network === input.network);
    if (!network) throw multiError('FAMILY_NETWORK_REQUIRED', 'Configure and verify the selected chain endpoint first.');
    const account = await this.accounts.account(input), reader = await this.createAdapter(network);
    await reader.verify();
    let assets;
    if (input.family === 'bitcoin') {
      const {formatBitcoinAmount} = await import('./multichain-bitcoin.mjs');
      const read = await reader.readAddress(account.address);
      assets = [{symbol: 'BTC', decimals: 8, confirmed: read.confirmedSats, unconfirmed: read.unconfirmedSats, display: formatBitcoinAmount(read.confirmedSats), verification: 'provider-reported-not-spv'}];
    } else {
      const {tronDisplay} = await import('./multichain-tron.mjs');
      const amount = await reader.balance(account.address);
      assets = [{symbol: 'TRX', decimals: 6, amount: amount.sun, display: tronDisplay(amount.sun, 6), activated: amount.activated, verification: 'provider-reported-not-consensus'}];
    }
    const current = await this.getContext();
    if (current.account !== context.account || current.revision !== context.revision || current.locked || (await this.networks.read()).revision !== before.revision) throw changed();
    return {family: input.family, network: input.network, account: account.address, vaultAccount: context.account, configRevision: before.revision, assets};
  }
}
