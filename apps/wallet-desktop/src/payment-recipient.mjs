import { evmAddressFromYNX, ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { getAddress } from "ethers";
import { decodeLocalQRText } from "./walletconnect-qr-decoder.mjs";
import {address as evmAddress} from './multichain-evm.mjs';
import {validateBitcoinAddress} from './multichain-bitcoin.mjs';
import {tronAddress} from './multichain-tron.mjs';

const invalid = () => { throw Object.assign(new Error("Use a valid YNX Testnet address or a YNXT receiving link for network 6423."), { code: "INVALID_PAYMENT_RECIPIENT" }); };

/** Public recipient data only. Payment input never carries an amount or approval. */
export function parsePaymentRecipient(input, { requireURI = false } = {}) {
  if (typeof input !== "string" || input.length > 512) invalid();
  const value = input.trim();
  let address = value, kind = "address";
  if (value.startsWith("ynx:")) {
    const match = /^ynx:(ynx1[023456789acdefghjklmnpqrstuvwxyz]+)\?(?:chainId=ynx_6423-1&asset=YNXT|asset=YNXT&chainId=ynx_6423-1)$/u.exec(value);
    if (!match) invalid();
    address = match[1]; kind = "receiving-link";
  } else if (requireURI) invalid();
  let account;
  try {
    if (/^ynx1[023456789acdefghjklmnpqrstuvwxyz]+$/u.test(address)) {
      account = evmAddressFromYNX(address);
      if (ynxAddressFromEVM(account) !== address) invalid();
    } else if (/^0x[0-9a-fA-F]{40}$/u.test(address)) {
      account = getAddress(address).toLowerCase();
    } else invalid();
  } catch { invalid(); }
  if(account === "0x0000000000000000000000000000000000000000") invalid();
  const ynxAccount = ynxAddressFromEVM(account);
  return Object.freeze({ account, ynxAccount, kind, chainId: "ynx_6423-1", asset: "YNXT" });
}

export function decodePaymentRecipientQR(input) {
  return parsePaymentRecipient(decodeLocalQRText(input), { requireURI: true });
}

/** Family receiving QR contains no amount or permission. Selection is bound by
 * the caller; a raw address never verifies the selected network. Run under the
 * existing family operation gate so config cannot change between snapshots. */
export async function decodeFamilyRecipientQR(input,{expected,readNetworks,getContext,getSecurity,readRecords}){
  if(!['bitcoin','tron'].includes(expected?.family)||typeof expected.account!=='string'||!expected.account||typeof expected.network!=='string'||!Number.isSafeInteger(expected.revision)||!Number.isSafeInteger(expected.configRevision))throw Error('FAMILY_RECIPIENT_INVALID');
  const verify=async()=>{
    const frame=await readNetworks();
    if(frame.revision!==expected.configRevision||!frame.networks.some(n=>n.family===expected.family&&n.network===expected.network))throw Error('FAMILY_RECIPIENT_CHANGED');
    const records=await readRecords();
    if(!Array.isArray(records)||records.some(r=>!['included','failed','cancelled'].includes(r.state)))throw Error('FAMILY_CUSTODY_CONFLICT');
    const finalFrame=await readNetworks();
    if(finalFrame.revision!==expected.configRevision||!finalFrame.networks.some(n=>n.family===expected.family&&n.network===expected.network))throw Error('FAMILY_RECIPIENT_CHANGED');
    const context=await getContext(),security=getSecurity();
    if(context.account!==expected.account||context.revision!==expected.revision||context.locked||context.authenticating||security.revision!==expected.revision||security.locked||security.authenticating||security.changing)throw Error('FAMILY_RECIPIENT_CHANGED');
  };
  await verify();
  const raw=decodeLocalQRText(input).trim();
  let account;
  if(expected.family==='bitcoin'){
    // Only the existing amount-free receiving producer's URI or a bare address.
    const address=raw.startsWith('bitcoin:')?raw.slice(8):raw;
    if(!/^(bc1|tb1)[a-zA-Z0-9]+$/i.test(address))throw Error('FAMILY_RECIPIENT_INVALID');
    account=validateBitcoinAddress(address,expected.network).address;
  }else{
    if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(raw))throw Error('FAMILY_RECIPIENT_INVALID');
    account=tronAddress(raw).base58;
  }
  await verify();
  return Object.freeze({family:expected.family,network:expected.network,account,networkVerified:false});
}

/** Bare EVM QR is only a recipient. Network fields bind the caller's selected
 * view; they are not encoded by or verified from the QR. Native stays URI-only. */
export async function decodeEVMRecipientQR(input,{expected,readSnapshot,getContext}){
  if(typeof expected?.account!=='string'||!/^0x[a-f0-9]{40}$/.test(expected.account)||typeof expected.networkId!=='string'||!expected.networkId||!Number.isSafeInteger(expected.revision)||!Number.isSafeInteger(expected.configRevision))throw Error('EVM_RECIPIENT_INVALID');
  const epoch=getContext().networkEpoch;
  const verify=async()=>{const frame=await readSnapshot(),current=getContext();if(current.locked||current.authenticating||current.changing||current.revision!==expected.revision||current.networkEpoch!==epoch||frame.account!==expected.account||frame.selected!==expected.networkId||frame.revision!==expected.configRevision)throw Error('EVM_RECIPIENT_CHANGED')};
  await verify();const raw=decodeLocalQRText(input).trim();if(!/^0x[0-9a-fA-F]{40}$/.test(raw))throw Error('EVM_RECIPIENT_INVALID');const account=evmAddress(raw);await verify();
  return Object.freeze({family:'evm',account,networkId:expected.networkId,configRevision:expected.configRevision,networkVerified:false});
}
