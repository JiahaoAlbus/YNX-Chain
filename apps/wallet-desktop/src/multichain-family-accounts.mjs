import { exactObject, multiError } from './multichain-config.mjs';
export function createMnemonicFamilyAccounts({vault, getContext}) {
  return new FamilyAccounts({
    getContext,
    deriveBitcoin: async (derivation, context) => {
      const {deriveBitcoinMnemonicAccount} = await import('./multichain-bitcoin.mjs');
      const result = await deriveBitcoinMnemonicAccount({withMnemonic: (action, permission) => vault.withMnemonic(action, permission), expectedVaultAccount: context.account, derivation: {...derivation, changeIndex: derivation.index}});
      return {address: result.address, path: result.senderPath, publicKey: result.publicKey, changeAddress: result.changeAddress, changePath: result.changePath, changePublicKey: result.changePublicKey};
    },
    deriveTron: async (derivation, context) => {
      const {tronMnemonicAddress, tronDerivationPath} = await import('./multichain-tron.mjs');
      return vault.withMnemonic((phrase, identity, guard) => {
        guard.assert(); if (identity.account !== context.account) throw new Error('FAMILY_ACCOUNT_CHANGED');
        return {address: tronMnemonicAddress(phrase, derivation.index).base58, path: tronDerivationPath(derivation.index)};
      });
    }
  });
}
const fail = code => { throw multiError(code, 'Unlock the selected mnemonic account and try again.'); };
export class FamilyAccounts {
  constructor({ getContext, deriveBitcoin, deriveTron }) { Object.assign(this, { getContext, deriveBitcoin, deriveTron }); }
  async account(input) {
    exactObject(input, ['family', 'network', 'index', 'account']);
    const { family, network, index = 0, account = 0 } = input;
    if (!['bitcoin', 'tron'].includes(family) || !Number.isSafeInteger(index) || index < 0 || index >= 0x80000000 || !Number.isSafeInteger(account) || account < 0 || account >= 0x80000000 || family === 'tron' && account !== 0 || !(family === 'bitcoin' ? ['mainnet', 'testnet3', 'testnet4', 'signet'] : ['mainnet', 'shasta', 'nile']).includes(network)) fail('FAMILY_ACCOUNT_INVALID');
    const context = await this.getContext();
    if (!context.account || context.locked || context.authenticating) fail('MULTICHAIN_LOCKED');
    const result = await (family === 'bitcoin' ? this.deriveBitcoin : this.deriveTron)({ network, index, account }, Object.freeze({ ...context }));
    const current = await this.getContext();
    if (current.account !== context.account || current.revision !== context.revision || current.locked || current.authenticating) fail('MULTICHAIN_CONTEXT_CHANGED');
    // Strict projection rejects secret-bearing adapter output instead of quietly
    // stripping it and accidentally legitimising an unsafe bridge.
    exactObject(result, ['address', 'path', 'publicKey', 'changeAddress', 'changePath', 'changePublicKey']);
    if (typeof result.address !== 'string' || !result.address || result.address.length > 128 || typeof result.path !== 'string' || result.path.length > 80 || result.publicKey !== undefined && !/^(02|03)[0-9a-f]{64}$/.test(result.publicKey)) fail('FAMILY_ACCOUNT_INVALID');
    if (family === 'bitcoin' && (typeof result.changeAddress !== 'string' || typeof result.changePath !== 'string' || !/^(02|03)[0-9a-f]{64}$/.test(result.changePublicKey))) fail('FAMILY_ACCOUNT_INVALID');
    const path = family === 'bitcoin' ? `m/84'/${network === 'mainnet' ? 0 : 1}'/${account}'/0/${index}` : `m/44'/195'/0'/0/${index}`;
    if (result.path !== path || family === 'bitcoin' && result.changePath !== `m/84'/${network === 'mainnet' ? 0 : 1}'/${account}'/1/${index}`) fail('FAMILY_ACCOUNT_INVALID');
    return Object.freeze({ family, network, index, account, vaultAccount: context.account, ...result, networkVerified: false });
  }
}
