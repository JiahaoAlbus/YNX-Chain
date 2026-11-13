import {secp256k1} from '@noble/curves/secp256k1.js';
import {ripemd160} from '@noble/hashes/legacy.js';
import {sha256} from '@noble/hashes/sha2.js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {validateBitcoinReadAddress,type BitcoinNetwork} from '../chain/bitcoinRead';

const NETWORKS = Object.freeze({mainnet:{coin:0,hrp:'bc'},testnet3:{coin:1,hrp:'tb'},testnet4:{coin:1,hrp:'tb'},signet:{coin:1,hrp:'tb'}});
const CHARSET='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
export type BitcoinReceiveSelection=Readonly<{vaultAccount:string;network:BitcoinNetwork;index?:number}>;
export type BitcoinOwnedReceiveAddress=Readonly<{family:'bitcoin';vaultAccount:string;network:BitcoinNetwork;path:string;index:number;publicKey:string;address:string;networkVerified:false}>;
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};
function selection(input:BitcoinReceiveSelection) {
  const {vaultAccount,network,index=0}=input;
  // Existing Native public manifest principal, never a BTC address or secret.
  if(typeof vaultAccount!=='string'||!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(vaultAccount)||!Object.hasOwn(NETWORKS,network)||!Number.isSafeInteger(index)||index<0||index>=0x80000000)return fail('BTC_RECEIVE_SELECTION_INVALID');
  return {vaultAccount,network,index};
}
/** Standard account 0, external/receive branch only. No caller-defined HD path. */
export function bitcoinOwnedReceivePath(input:BitcoinReceiveSelection):string {
  const {network,index}=selection(input);
  return `m/84'/${NETWORKS[network].coin}'/0'/0/${index}`;
}
function encodeWitnessV0(hrp:string,program:Uint8Array):string {
  const words=[0];let bits=0,acc=0;
  for(const byte of program){acc=((acc<<8)|byte)&0xffff;bits+=8;while(bits>=5){bits-=5;words.push((acc>>>bits)&31);}}
  if(bits)words.push((acc<<(5-bits))&31);
  const chars=[...hrp].map(c=>c.charCodeAt(0));let checksum=1;
  for(const word of [...chars.map(c=>c>>5),0,...chars.map(c=>c&31),...words,0,0,0,0,0,0]){
    const top=checksum>>>25;checksum=((checksum&0x1ffffff)<<5)^word;
    for(const [i,g] of GENERATORS.entries())if((top>>>i)&1)checksum^=g;
  }
  checksum^=1;
  for(let i=0;i<6;i++)words.push((checksum>>>(5*(5-i)))&31);
  return hrp+'1'+words.map(w=>CHARSET[w]).join('');
}
/** Only public projection. Ownership must be established inside the original
 * Vault before supplying the derived key; this helper does not confer it. */
export function projectBitcoinOwnedReceiveAddress(input:BitcoinReceiveSelection,publicKey:string):BitcoinOwnedReceiveAddress {
  const selected=selection(input),path=bitcoinOwnedReceivePath(selected);
  if(typeof publicKey!=='string'||! /^(02|03)[0-9a-f]{64}$/.test(publicKey))return fail('BTC_RECEIVE_PUBLIC_KEY_INVALID');
  const bytes=hexToBytes(publicKey);
  try{secp256k1.Point.fromBytes(bytes).assertValidity();}catch{return fail('BTC_RECEIVE_PUBLIC_KEY_INVALID');}
  const address=encodeWitnessV0(NETWORKS[selected.network].hrp,ripemd160(sha256(bytes)));
  validateBitcoinReadAddress(address,selected.network);
  return Object.freeze({family:'bitcoin',...selected,path,publicKey,address,networkVerified:false});
}
/** Validate the original Vault DTO against the captured view selection. This
 * checks public consistency, not proof of custody. Reject rather than strip. */
export function validateBitcoinOwnedReceiveAddress(input:BitcoinReceiveSelection,raw:unknown):BitcoinOwnedReceiveAddress {
  const keys=['family','vaultAccount','network','path','index','publicKey','address','networkVerified'];
  if(!raw||typeof raw!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(raw))||Reflect.ownKeys(raw).length!==keys.length)return fail('BTC_RECEIVE_RESULT_INVALID');
  const data:Record<string,unknown>=Object.create(null);
  for(const key of keys){const field=Object.getOwnPropertyDescriptor(raw,key);if(!field||!Object.hasOwn(field,'value'))return fail('BTC_RECEIVE_RESULT_INVALID');data[key]=field.value;}
  const expected=projectBitcoinOwnedReceiveAddress(input,data.publicKey as string);
  for(const key of keys as (keyof BitcoinOwnedReceiveAddress)[])if(data[key]!==expected[key])return fail('BTC_RECEIVE_RESULT_INVALID');
  return expected;
}
