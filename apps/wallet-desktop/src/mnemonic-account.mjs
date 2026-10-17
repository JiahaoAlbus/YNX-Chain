import {randomBytes} from 'node:crypto';
import {HDNodeWallet,Mnemonic,wordlists} from 'ethers';
import {walletIdentity,evmAddressFromYNX} from '@ynx-chain/wallet-auth';

export const MNEMONIC_ACCOUNT_PATH="m/44'/60'/0'/0/0";
const lengths=new Set([16,20,24,28,32]);
function invalid(code='MNEMONIC_INVALID') {
  throw Object.assign(new Error(code==='MNEMONIC_PASSPHRASE_UNSUPPORTED'?'BIP39 passphrase wallets are not supported by this version. Do not omit their passphrase.':'Enter a valid English BIP39 recovery phrase with its checksum.'),{code,data:{code}});
}
/** Local custody data only. Never log this result or return it through public account IPC. */
export function mnemonicAccountFromEntropy(entropyHex,guard=()=>{}) {
  guard();
  if(typeof entropyHex!=='string'||!/^[0-9a-f]+$/.test(entropyHex)||!lengths.has(entropyHex.length/2))invalid();
  const mnemonic=Mnemonic.fromEntropy(`0x${entropyHex}`,'',wordlists.en);
  const wallet=HDNodeWallet.fromMnemonic(mnemonic,MNEMONIC_ACCOUNT_PATH);
  const secretHex=wallet.privateKey.slice(2),identity=walletIdentity(secretHex);
  guard();
  return {entropyHex,phrase:mnemonic.phrase,secretHex,path:MNEMONIC_ACCOUNT_PATH,wordCount:mnemonic.phrase.split(' ').length,account:evmAddressFromYNX(identity.account),ynxAccount:identity.account,publicKey:identity.accountPublicKey};
}
export function importMnemonicAccount({phrase,passphrase=''}={},guard=()=>{}) {
  guard();
  if(passphrase!=='')invalid('MNEMONIC_PASSPHRASE_UNSUPPORTED');
  if(typeof phrase!=='string'||phrase.length>512||!phrase.isWellFormed())invalid();
  const normalized=phrase.normalize('NFKD').trim().split(/\s+/u).join(' ');
  if(!Mnemonic.isValidMnemonic(normalized,wordlists.en))invalid();
  const mnemonic=Mnemonic.fromPhrase(normalized,'',wordlists.en);
  return mnemonicAccountFromEntropy(mnemonic.entropy.slice(2),guard);
}
export function createMnemonicAccount({wordCount=12}={},guard=()=>{}) {
  guard();
  if(wordCount!==12&&wordCount!==24)invalid();
  const bytes=randomBytes(wordCount===12?16:32);
  try{return mnemonicAccountFromEntropy(bytes.toString('hex'),guard)}finally{bytes.fill(0)}
}
