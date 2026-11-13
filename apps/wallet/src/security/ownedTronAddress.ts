import {computeAddress, HDNodeWallet, Mnemonic, wordlists} from 'ethers';
import {tronPublicAddress, type TronReadConfig} from '../chain/tronRead';
import type {WalletRepository} from '../storage/walletRepository';
import type {WalletOperationScope} from './operationLifecycle';

const RECEIVE_PATH = "m/44'/195'/0'/0/0";
export type TronReceiveSelection = Readonly<{vaultAccount:string; network:TronReadConfig['network']}>;
export type OwnedTronAddress = Readonly<TronReceiveSelection & {
  family:'tron'; address:string; hexAddress:string; path:typeof RECEIVE_PATH; index:0; networkVerified:false;
}>;

function failure(code:string, message:string):never {
  throw Object.assign(new Error(message), {code});
}

/** Call only after an explicit Receive action. The original authenticated
 * mnemonic repository read owns key access; no seed or key crosses into UI. A
 * chain label is not RPC/network proof; pass only address to the read adapter. */
export async function readOwnedTronAddress({scope, repository, assertSelectionCurrent, checkBiometrics}: {
  scope:WalletOperationScope;
  repository:Pick<WalletRepository,'accountMnemonic'>;
  assertSelectionCurrent:(selection:TronReceiveSelection)=>void;
  checkBiometrics:(assertCurrent:()=>void)=>Promise<void>;
}, input:TronReceiveSelection):Promise<OwnedTronAddress> {
  const {vaultAccount, network} = input;
  if (typeof vaultAccount !== 'string' || !vaultAccount || !['mainnet','shasta','nile'].includes(network)) {
    failure('TRON_RECEIVE_SELECTION_INVALID', 'Select a Wallet account and a TRON network.');
  }
  const selection = Object.freeze({vaultAccount, network});
  const lease = scope.begin({account:vaultAccount, requireUnlocked:true});
  const assertCurrent = () => { lease.assert(); assertSelectionCurrent(selection); lease.assert(); };
  try {
    assertCurrent();
    await lease.step(() => checkBiometrics(assertCurrent));
    assertCurrent();
    const material = await lease.step(() => repository.accountMnemonic(vaultAccount, assertCurrent));
    assertCurrent();
    if (material.account !== vaultAccount) failure('TRON_RECEIVE_ACCOUNT_CHANGED', 'The selected Wallet account changed.');
    // The mobile recovery repository supplies only empty-passphrase English
    // BIP39 material. Never infer a phrase from an old raw private key.
    let publicAddress:ReturnType<typeof tronPublicAddress>;
    try {
      const mnemonic = Mnemonic.fromPhrase(material.phrase, '', wordlists.en);
      const count = mnemonic.phrase.split(' ').length;
      if (mnemonic.entropy.slice(2) !== material.entropyHex || count !== material.wordCount || (count !== 12 && count !== 24)) {
        failure('TRON_RECEIVE_MNEMONIC_INVALID', 'The protected recovery phrase could not be verified.');
      }
      const node = HDNodeWallet.fromMnemonic(mnemonic, RECEIVE_PATH);
      publicAddress = tronPublicAddress('41' + computeAddress(node.publicKey).slice(2));
    } catch {
      failure('TRON_RECEIVE_MNEMONIC_INVALID', 'The protected recovery phrase could not be verified.');
    }
    assertCurrent();
    return Object.freeze({...selection, family:'tron', address:publicAddress.address, hexAddress:publicAddress.hex,
      path:RECEIVE_PATH, index:0, networkVerified:false});
  } finally {
    lease.finish();
  }
}
