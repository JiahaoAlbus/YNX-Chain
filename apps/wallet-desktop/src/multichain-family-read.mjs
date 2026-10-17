import {exactObject, multiError} from './multichain-config.mjs';
import {validateFamilyNetwork} from './multichain-family-networks.mjs';
import {createFamilyReadTransport} from './multichain-family-transport.mjs';
import {effectiveFamilyNetworks} from './multichain-family-defaults.mjs';
import {FamilyOperationGate} from './multichain-family-operation-gate.mjs';
const changed = () => multiError('MULTICHAIN_CONTEXT_CHANGED', 'Account or network changed. Check the selected account again.');
async function adapter(network) {
  const transport = createFamilyReadTransport({family: network.family, networkId: network.network, baseURL: network.rpcUrl});
  if (network.family === 'bitcoin') { const {BitcoinReadAdapter} = await import('./multichain-bitcoin.mjs'); return new BitcoinReadAdapter({network: network.network, request: transport}); }
  const {TronReadAdapter} = await import('./multichain-tron.mjs'); return new TronReadAdapter({network: {id: network.network, genesisBlockId: network.genesis}, transport});
}
export class FamilyRead {
  constructor({networks, tokens, accounts, getContext, assertNetworkEditable = async () => {}, createAdapter = adapter, gate = new FamilyOperationGate()}) { Object.assign(this, {networks, tokens, accounts, getContext, assertNetworkEditable, createAdapter, gate}); }
  async snapshot() { return effectiveFamilyNetworks(await this.networks.read()); }
  async configure(input) {
    return this.gate.run(()=>this.#configureOriginal(input));
  }
  async #configureOriginal(input) {
    const network = validateFamilyNetwork(input), context = await this.getContext(), before = await this.networks.read();
    await this.assertNetworkEditable(network);
    const reader = await this.createAdapter(network); await reader.verify();
    const current = await this.getContext();
    if (current.account !== context.account || current.revision !== context.revision || (await this.networks.read()).revision !== before.revision) throw changed();
    await this.assertNetworkEditable(network);
    return this.networks.put(network, before.revision);
  }
  async importToken(input) {
    return this.gate.run(()=>this.#importOriginalToken(input));
  }
  async #importOriginalToken(input) {
    exactObject(input, ['family', 'network', 'contract']);
    if (input.family !== 'tron' || !this.tokens) throw multiError('FAMILY_TOKEN_UNSUPPORTED', 'Select a TRON network and TRC20 contract.');
    const context = await this.getContext(), before = await this.networks.read(), catalog = await this.tokens.read();
    const network = effectiveFamilyNetworks(before).networks.find(n => n.family === input.family && n.network === input.network);
    if (!network) throw multiError('FAMILY_NETWORK_REQUIRED', 'Configure the selected chain endpoint first.');
    const account = await this.accounts.account({family: input.family, network: input.network});
    const {tronAddress} = await import('./multichain-tron.mjs'), contract = tronAddress(input.contract);
    const reader = await this.createAdapter(network), metadata = await reader.tokenMetadata(account.address, contract.hex);
    if (metadata.networkId !== network.network || metadata.networkGenesis !== network.genesis || metadata.contractHex !== contract.hex || metadata.contractAddress !== contract.base58 || metadata.verification !== 'provider-reported-not-consensus') throw changed();
    const current = await this.getContext();
    if (current.locked || current.account !== context.account || current.revision !== context.revision || (await this.networks.read()).revision !== before.revision) throw changed();
    const token = {family: 'tron', network: network.network, genesis: network.genesis, contract: contract.hex, name: metadata.name, symbol: metadata.symbol, decimals: metadata.decimals};
    await this.tokens.put(token, catalog.revision); return token;
  }
  async tokenCatalog(input) {
    exactObject(input,['family','network']);
    if(input.family!=='tron'||!this.tokens)throw multiError('FAMILY_TOKEN_UNSUPPORTED','Select a TRON network.');
    const before=await this.networks.read(),catalog=await this.tokens.read(),network=effectiveFamilyNetworks(before).networks.find(n=>n.family===input.family&&n.network===input.network);
    if(!network)throw multiError('FAMILY_NETWORK_REQUIRED','Configure the selected chain endpoint first.');
    return {family:input.family,network:input.network,genesis:network.genesis,revision:catalog.revision,tokens:catalog.tokens.filter(t=>t.family===input.family&&t.network===input.network)};
  }
  async removeToken(input) {return this.gate.run(async()=>{
    exactObject(input,['family','network','genesis','contract','revision']);
    if(input.family!=='tron'||!this.tokens||!Number.isSafeInteger(input.revision)||input.revision<0)throw multiError('FAMILY_TOKEN_INVALID','Check the original token identity.');
    const context=await this.getContext();if(context.locked||context.authenticating||!context.account)throw multiError('MULTICHAIN_LOCKED','Unlock before editing the token catalog.');
    const catalog=await this.tokens.read(),current=await this.getContext();
    if(current.locked||current.authenticating||current.account!==context.account||current.revision!==context.revision||catalog.revision!==input.revision)throw changed();
    await this.tokens.remove({family:input.family,network:input.network,genesis:input.genesis,contract:input.contract},input.revision);
    return {family:input.family,network:input.network,genesis:input.genesis,contract:input.contract,removed:true};
  });}
  async balances(input) {
    exactObject(input, ['family', 'network']);
    const context = await this.getContext(), before = await this.networks.read();
    const network = effectiveFamilyNetworks(before).networks.find(n => n.family === input.family && n.network === input.network);
    if (!network) throw multiError('FAMILY_NETWORK_REQUIRED', 'Configure and verify the selected chain endpoint first.');
    const account = await this.accounts.account(input), reader = await this.createAdapter(network);
    await reader.verify();
    const catalog = this.tokens ? await this.tokens.read() : {revision: 0, tokens: []};
    let assets; const errors = [];
    if (input.family === 'bitcoin') {
      const {formatBitcoinAmount} = await import('./multichain-bitcoin.mjs');
      const read = await reader.readAddress(account.address);
      assets = [{symbol: 'BTC', decimals: 8, confirmed: read.confirmedSats, unconfirmed: read.unconfirmedSats, display: formatBitcoinAmount(read.confirmedSats), verification: 'provider-reported-not-spv'}];
    } else {
      const {tronDisplay} = await import('./multichain-tron.mjs');
      const amount = await reader.balance(account.address);
      assets = [{symbol: 'TRX', decimals: 6, amount: amount.sun, display: tronDisplay(amount.sun, 6), activated: amount.activated, verification: 'provider-reported-not-consensus'}];
      for (const token of catalog.tokens.filter(t => t.family === 'tron' && t.network === network.network)) {
        try {
          const active = await this.getContext();
          if (active.locked || active.account !== context.account || active.revision !== context.revision || (await this.networks.read()).revision !== before.revision || (await this.tokens.read()).revision !== catalog.revision) throw changed();
          if (token.genesis !== network.genesis) throw multiError('FAMILY_TOKEN_NETWORK_CHANGED', 'Token was imported on another genesis.');
          const read = await reader.tokenRead(account.address, token.contract);
          if (read.networkId !== network.network || read.networkGenesis !== network.genesis || read.contractHex !== token.contract || read.accountAddress !== account.address || read.name !== token.name || read.symbol !== token.symbol || read.decimals !== token.decimals || read.verification !== 'provider-reported-not-consensus') throw multiError('FAMILY_TOKEN_METADATA_CHANGED', 'Token metadata changed. Recheck the contract.');
          assets.push({contract: token.contract, name: token.name, symbol: token.symbol, decimals: token.decimals, amount: read.units, display: read.display, verification: read.verification});
        } catch (error) {if (error.code === 'MULTICHAIN_CONTEXT_CHANGED') throw error; errors.push({contract: token.contract, symbol: token.symbol, code: typeof error.code === 'string' ? error.code : 'FAMILY_TOKEN_READ_FAILED'});}
      }
    }
    const current = await this.getContext();
    if (current.account !== context.account || current.revision !== context.revision || current.locked || (await this.networks.read()).revision !== before.revision || this.tokens && (await this.tokens.read()).revision !== catalog.revision) throw changed();
    return {family: input.family, network: input.network, account: account.address, vaultAccount: context.account, configRevision: before.revision, assets, errors};
  }
}
