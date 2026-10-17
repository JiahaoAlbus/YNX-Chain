import QRCode from "qrcode";
import { evmAddressFromYNX } from "@ynx-chain/wallet-auth";
import {chainQuantity} from './multichain-config.mjs';

const fail = () => { throw Object.assign(new Error("The receiving account could not be verified. Reopen Receive from your selected account."), { code: "RECEIVE_ACCOUNT_UNAVAILABLE" }); };

/** Encode only the selected public identity. No key access, RPC or image service. */
export async function createReceiveCode(expectedAccount, readAccountStatus) {
  const status = await readAccountStatus();
  try {
    if (!status?.initialized || typeof expectedAccount !== "string" || expectedAccount !== status.ynxAccount ||
        evmAddressFromYNX(expectedAccount) !== status.account) fail();
  } catch { fail(); }
  const uri = `ynx:${expectedAccount}?chainId=ynx_6423-1&asset=YNXT`;
  const { modules } = QRCode.create(uri, { errorCorrectionLevel: "M" });
  const current = await readAccountStatus();
  if (!current?.initialized || current.ynxAccount !== expectedAccount || current.account !== status.account) fail();
  return { account: expectedAccount, chainId: "ynx_6423-1", asset: "YNXT", uri, size: modules.size, modules: Array.from(modules.data) };
}

export async function createEVMReceiveCode(input,{readSnapshot,getContext}){
  const fields=['family','account','revision','networkId','configRevision','chainId','genesis','rpcUrl'],expected=Object.fromEntries(fields.map(key=>[key,bitcoinField(input,key)]));
  if(Object.keys(input).length!==fields.length||expected.family!=='evm'||!/^0x[a-f0-9]{40}$/.test(expected.account)||/^0x0{40}$/.test(expected.account)||!Number.isSafeInteger(expected.revision)||!Number.isSafeInteger(expected.configRevision)||typeof expected.networkId!=='string'||!expected.networkId||chainQuantity(expected.chainId)!==expected.chainId||!/^0x[a-f0-9]{64}$/.test(expected.genesis)||typeof expected.rpcUrl!=='string'||!expected.rpcUrl.startsWith('https://'))throw Error('EVM_RECEIVE_INVALID');
  const initialEpoch=getContext().networkEpoch;
  const verify=async()=>{const frame=await readSnapshot(),current=getContext(),network=frame.networks.find(n=>n.id===expected.networkId);if(current.locked||current.authenticating||current.changing||current.revision!==expected.revision||current.networkEpoch!==initialEpoch||frame.account!==expected.account||frame.selected!==expected.networkId||frame.revision!==expected.configRevision||!network||network.chainId!==expected.chainId||network.genesis!==expected.genesis||network.rpcUrl!==expected.rpcUrl)throw Error('EVM_RECEIVE_CHANGED');};
  await verify();const {modules}=QRCode.create(expected.account,{errorCorrectionLevel:'M'});await verify();
  return {...expected,payload:expected.account,networkVerified:false,size:modules.size,modules:Array.from(modules.data)};
}
function bitcoinField(object,key){const d=object&&typeof object==='object'&&Object.getOwnPropertyDescriptor(object,key);if(!d||!Object.hasOwn(d,'value'))throw Error('BTC_RECEIVE_INVALID');return d.value;}
function bitcoinReceiveNetwork(snapshot,network){
  const revision=bitcoinField(snapshot,'revision'),networks=bitcoinField(snapshot,'networks');
  if(!Number.isSafeInteger(revision)||revision<0||!Array.isArray(networks)||!['mainnet','testnet3','testnet4','signet'].includes(network))throw Error('BTC_RECEIVE_INVALID');
  const row=networks.find(n=>bitcoinField(n,'family')==='bitcoin'&&bitcoinField(n,'network')===network);if(!row)throw Error('FAMILY_NETWORK_REQUIRED');
  const rpcUrl=bitcoinField(row,'rpcUrl'),genesis=bitcoinField(row,'genesis');if(genesis!==null||typeof rpcUrl!=='string'||!rpcUrl.startsWith('https://'))throw Error('BTC_RECEIVE_INVALID');
  return {configRevision:revision,rpcUrl,genesis};
}
/** Selected owned BIP84 public identity only. QR is not a network attestation
 * or a grant to sign. Protected mnemonic custody remains in existing caller. */
export async function createBitcoinReceiveCode(input,{readAccount,readNetworks,getContext}){
  const keys=['family','network','vaultAccount','address','revision'];if(!input||Reflect.ownKeys(input).length!==keys.length)throw Error('BTC_RECEIVE_INVALID');
  const request=Object.fromEntries(keys.map(key=>[key,bitcoinField(input,key)]));
  const {validateBitcoinAddress,bitcoinDerivationPath}=await import('./multichain-bitcoin.mjs');
  if(request.family!=='bitcoin'||validateBitcoinAddress(request.address,request.network).address!==request.address)throw Error('BTC_RECEIVE_INVALID');
  const live=c=>c.account&&!c.locked&&!c.authenticating&&c.account===request.vaultAccount&&c.revision===request.revision;
  if(!live(await getContext()))throw Error('FAMILY_ACCOUNT_CHANGED');
  const config=bitcoinReceiveNetwork(await readNetworks(),request.network);
  const account=await readAccount({family:'bitcoin',network:request.network,index:0,account:0});
  for(const key of ['family','network','vaultAccount','address'])if(bitcoinField(account,key)!==request[key])throw Error('FAMILY_ACCOUNT_CHANGED');
  const path=bitcoinDerivationPath(request.network,{account:0,change:0,index:0});
  if(bitcoinField(account,'index')!==0||bitcoinField(account,'account')!==0||bitcoinField(account,'path')!==path)throw Error('BTC_RECEIVE_INVALID');
  const payload=`bitcoin:${request.address}`,qr=QRCode.create(payload,{errorCorrectionLevel:'M'});
  if(!live(await getContext())||JSON.stringify(config)!==JSON.stringify(bitcoinReceiveNetwork(await readNetworks(),request.network))||!live(await getContext()))throw Error('FAMILY_ACCOUNT_CHANGED');
  return Object.freeze({...request,...config,path,payload,size:qr.modules.size,modules:Array.from(qr.modules.data),networkVerified:false});
}
