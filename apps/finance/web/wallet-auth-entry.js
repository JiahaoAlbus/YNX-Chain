import {StandardWalletConnection,discoverWalletProviders} from './vendor/standard-wallet-browser-c97f85e9.mjs';
import {METAMASK_EVM_CHAIN} from '../../../packages/wallet-auth/src/metamask-evm-adapter.js';
import {toYNXAddress,toEVMAddress} from '../../../sdk/js/index.js';
import {createHostedWalletAdapter} from './vendor/hosted-wallet-adapter-19d8a9a2.js';
import {mountFinanceHostedWalletUI} from './hosted-wallet-controller.js';
import {privateFinance,bindPrivateFinanceUI} from './private-wallet-entry.js';

const ORIGIN='https://finance.ynxweb4.com';
const PROVIDER_KEY='ynx.finance.standard-wallet.provider.v2';
const DOWNLOAD='https://www.ynxweb4.com/dapp/download',METAMASK='https://metamask.io/download/';
const CHAIN=METAMASK_EVM_CHAIN;
let connection=null,hosted=null,activeTransport=null,discoveredYNX=null,unsubscribe=()=>{},intent=0,revision=0,busy=false,revoking=null;
let standard=Object.freeze({status:'disconnected',providerKind:null,account:null,chainId:null});
let lastMessage='';
function label(key){return window.YNXFinanceLocale?.text(key)??key;}
function message(code){
  const key=({WALLET_NOT_FOUND:'walletNotFound',USER_REJECTED:'walletRejected',WRONG_NETWORK:'walletWrongChain',LOCAL_DISCONNECT_ONLY:'standardDisconnected',PERMISSION_REVOKED:'walletRevoked',WALLET_DETAILS_ONLY:'walletDetailsOnly'})[code];
  return key?label(key):code?.startsWith('REVOCATION_')?label('walletRevocationUnconfirmed'):code?label('walletActionUnavailable'):'';
}
const ready=new Promise(resolve=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',resolve,{once:true}):resolve()).then(boot);
window.YNXFinanceWallet=Object.freeze({
  ready,connect:connectYNXWallet,connectMetaMask:()=>connect('metamask'),
  restoreStandardWallet,disconnectStandardWallet,revokeStandardWallet,
  getStandardWalletState:()=>standard,getStandardRevision:()=>revision,getRevision:()=>revision+privateFinance.revision(),
  signEVMLoginRequest,
  connected:privateFinance.connected,session:privateFinance.session,requireProof:privateFinance.proof,
  privateAccountMatchesSelected:privateFinance.accountMatchesSelected,
  disconnect:privateFinance.disconnect,reportPrivateFailure:privateFinance.reportFailure,
  beginPrivate:privateFinance.begin,retryPrivate:privateFinance.retry,restorePrivate:privateFinance.restore,
  guestPrivate:privateFinance.guest,getPrivateState:privateFinance.state,
});
function preference(value){try{if(value===undefined){const saved=localStorage.getItem(PROVIDER_KEY);return ['ynx-wallet','metamask'].includes(saved)?saved:null;}if(value)localStorage.setItem(PROVIDER_KEY,value);else localStorage.removeItem(PROVIDER_KEY);}catch{}return null;}
function isCurrent(value,selected=connection){if(value!==intent||selected!==connection)throw new Error('WALLET_REQUEST_SUPERSEDED');}
function detach(){unsubscribe();unsubscribe=()=>{};const old=connection;connection=null;old?.disconnect();}
function hostedStateChanged(next){
  if(activeTransport!=='hosted')return;
  busy=next.status==='connecting';
  // Account changes invalidate the old local private subject; this is not a
  // claim that Wallet/Gateway permission was revoked remotely.
  if(next.error==='HOSTED_ACCOUNT_CHANGED')privateFinance.guest();
  const connected=next.status==='connected'&&next.chainId==='0x1917'&&/^0x[0-9a-f]{40}$/.test(next.account??'');
  if(connected){
    try{if(toEVMAddress(toYNXAddress(next.account))!==next.account)throw new Error('HOSTED_ADDRESS_ROUNDTRIP_FAILED');}
    catch{void hosted?.disconnect();publish({status:'unavailable',providerKind:'ynx-wallet',account:null,chainId:null,transport:'hosted-wallet-web'},'HOSTED_ADDRESS_INVALID');return;}
  }
  publish({status:connected?'connected':next.status,providerKind:'ynx-wallet',account:connected?next.account:null,chainId:connected?next.chainId:null,transport:'hosted-wallet-web'},next.error??'');
  if(connected){document.querySelector('#wallet-choice')?.classList.add('hidden');document.querySelector('#wallet-details')?.focus();}
}
function hostedAttempt(){
  ++intent;detach();preference(null);activeTransport='hosted';busy=true;
  publish({status:'connecting',providerKind:'ynx-wallet',account:null,chainId:null,transport:'hosted-wallet-web'});
}
function connectYNXWallet(){
  const legacy=window.ethereum?.providers?.find(provider=>provider?.isYNXWallet===true)||
    (window.ethereum?.isYNXWallet===true?window.ethereum:null);
  if(discoveredYNX||legacy)return connect('ynx-wallet');
  // The browser has no selected YNX extension provider. Launch the official
  // Hosted Wallet synchronously within this user gesture, never a bare scheme.
  if(!hosted)throw new Error('HOSTED_WALLET_NOT_READY');
  hostedAttempt();return hosted.connect();
}
function publish(next,message=''){standard=Object.freeze({...next});revision++;lastMessage=message;render();window.dispatchEvent(new CustomEvent('ynx-finance-standard-state',{detail:{...standard,revision}}));}
function snapshot(selected,kind){const session=selected.current;return session?{status:session.selectedChain==='0x1917'?'connected':'wrong-chain',providerKind:kind,account:session.selectedAccount,chainId:session.selectedChain}:{status:'disconnected',providerKind:kind,account:null,chainId:null};}
function attach(provider,kind){
  const selected=new StandardWalletConnection({provider,origin:ORIGIN,metadata:{name:'YNX Finance',url:ORIGIN}});
  connection=selected;
  unsubscribe=selected.subscribe(({event})=>{
    if(selected!==connection||!['accountsChanged','chainChanged','disconnect'].includes(event))return;
    const next=snapshot(selected,kind);
    if(event==='accountsChanged'&&standard.status==='connected'&&next.account!==standard.account)privateFinance.guest();
    if(next.status==='disconnected'&&selected!==revoking)preference(null);
    if(JSON.stringify(next)!==JSON.stringify(standard))publish(next);
  });
  return selected;
}
async function ensureChain(selected,value){
  try{await selected.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN.chainId}]});}
  catch(error){isCurrent(value,selected);if(Number(error?.code)!==4902)throw error;await selected.request({method:'wallet_addEthereumChain',params:[CHAIN]});isCurrent(value,selected);await selected.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN.chainId}]});}
  isCurrent(value,selected);
  if(await selected.request({method:'eth_chainId'})!=='0x1917')throw new Error('WRONG_NETWORK');
  isCurrent(value,selected);
}
async function signEVMLoginRequest(request){
  const selected=connection,value=intent,account=standard.account;
  const useHosted=activeTransport==='hosted'&&hosted?.getState().status==='connected';
  if((!selected&&!useHosted)||standard.status!=='connected'||standard.chainId!=='0x1917'||!/^0x[0-9a-f]{40}$/.test(account||''))throw new Error('STANDARD_WALLET_NOT_CONNECTED');
  if(request?.method!=='personal_sign'||!Array.isArray(request.params)||request.params.length!==2||typeof request.message!=='string'||request.message.length>8192||!/^0x(?:[0-9a-fA-F]{2})+$/.test(request.params[0])||request.params[1]!==account)throw new Error('WALLET_LOGIN_REQUEST_INVALID');
  const exactMessageHex='0x'+Array.from(new TextEncoder().encode(request.message),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(request.params[0].toLowerCase()!==exactMessageHex)throw new Error('WALLET_LOGIN_MESSAGE_MISMATCH');
  const requestWallet=input=>useHosted?hosted.request(input):selected.request(input);
  const assertWallet=()=>{if(value!==intent||standard.account!==account||standard.status!=='connected'||(useHosted?activeTransport!=='hosted'||hosted?.getState().account!==account:selected!==connection))throw new Error('WALLET_REQUEST_SUPERSEDED')};
  if(await requestWallet({method:'eth_chainId'})!=='0x1917')throw new Error('WRONG_NETWORK');
  assertWallet();
  const signature=await requestWallet({method:'personal_sign',params:request.params});
  assertWallet();
  if(typeof signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(signature))throw new Error('WALLET_LOGIN_SIGNATURE_INVALID');
  return signature;
}
async function connect(kind){
  if(!['ynx-wallet','metamask'].includes(kind))throw new Error('WALLET_SELECTION_INVALID');
  const value=++intent;activeTransport='injected';void hosted?.disconnect();detach();preference(null);busy=true;publish({status:'connecting',providerKind:kind,account:null,chainId:null,transport:'injected'});
  try{
    const discovery=await discoverWalletProviders(window,160);isCurrent(value);
    const provider=(kind==='ynx-wallet'?discovery.ynx:discovery.metamask)?.provider;
    if(!provider){publish({status:'unavailable',providerKind:kind,account:null,chainId:null},'WALLET_NOT_FOUND');return null;}
    const selected=attach(provider,kind);
    await ensureChain(selected,value);
    await selected.connect();isCurrent(value,selected);
    const next=snapshot(selected,kind);publish(next);
    if(next.status!=='connected')throw new Error('WRONG_NETWORK');
    preference(kind);document.querySelector('#wallet-choice')?.classList.add('hidden');
    document.querySelector('#wallet-details')?.focus();return standard;
  }catch(error){if(value===intent){detach();publish({status:'disconnected',providerKind:kind,account:null,chainId:null},error?.code===4001?'USER_REJECTED':error.message||'WALLET_UNAVAILABLE');}return null;}
  finally{if(value===intent){busy=false;render();}}
}
async function restoreStandardWallet(){
  const kind=preference(),value=++intent;activeTransport=kind?'injected':null;detach();busy=false;publish({status:'disconnected',providerKind:kind,account:null,chainId:null});
  if(!kind)return null;
  try{
    const discovery=await discoverWalletProviders(window,160);isCurrent(value);
    const provider=(kind==='ynx-wallet'?discovery.ynx:discovery.metamask)?.provider;
    if(!provider){lastMessage='WALLET_NOT_FOUND';render();return null;}
    const selected=attach(provider,kind);await selected.restore();isCurrent(value,selected);
    publish(snapshot(selected,kind));if(standard.status!=='connected')preference(null);return standard;
  }catch(error){if(value===intent){detach();publish({status:'disconnected',providerKind:kind,account:null,chainId:null},error.message||'WALLET_UNAVAILABLE');}return null;}
}
function disconnectStandardWallet(){intent++;activeTransport=null;busy=false;preference(null);detach();void hosted?.disconnect();publish({status:'disconnected',providerKind:null,account:null,chainId:null},'LOCAL_DISCONNECT_ONLY');}
async function revokeStandardWallet(){
  if(activeTransport==='hosted'){
    busy=true;render();
    try{const result=await hosted.revoke();disconnectStandardWallet();return result;}
    finally{busy=false;render();}
  }
  const selected=connection,value=intent;if(!selected)return {status:'unsupported',permissionRevoked:false,locallyDisconnected:true};
  busy=true;revoking=selected;render();
  try{
    const result=await selected.revoke();
    if(value!==intent||selected!==connection)return {status:'superseded',permissionRevoked:false,locallyDisconnected:standard.status!=='connected'};
    if(result.permissionRevoked){preference(null);detach();publish({status:'disconnected',providerKind:null,account:null,chainId:null},'PERMISSION_REVOKED');}
    else {lastMessage='REVOCATION_'+result.status.toUpperCase();render();}
    return result;
  }finally{if(value===intent){busy=false;revoking=null;render();}}
}
function render(){
  const connected=standard.status==='connected';
  const status=document.querySelector('#wallet-state');
  let accountLabel=standard.account;
  if(connected&&standard.providerKind==='ynx-wallet'){
    try{const native=toYNXAddress(standard.account);if(toEVMAddress(native)===standard.account)accountLabel=`${native} · EVM ${standard.account}`;}catch{}
  }
  if(status){status.textContent=(lastMessage?message(lastMessage)+' · ':'')+(connected?(standard.providerKind==='metamask'?'MetaMask':standard.transport==='hosted-wallet-web'?'YNX Wallet Web':'YNX Wallet')+' · '+accountLabel+' · '+standard.chainId+' · '+label('standardOnly'):busy?label('standardBusy'):label('standardDisconnected'));status.title=lastMessage||'';}
  for(const element of document.querySelectorAll('.connect,#connect-metamask'))element.disabled=busy;
  for(const id of ['wallet-details','wallet-disconnect','wallet-revoke','wallet-switch']){const element=document.querySelector('#'+id);if(element)element.hidden=!(connected||id==='wallet-disconnect'&&busy);}
  const revoke=document.querySelector('#wallet-revoke');if(revoke){revoke.disabled=busy;revoke.hidden=!connected||standard.transport==='hosted-wallet-web';}
  const disconnect=document.querySelector('#wallet-disconnect');if(disconnect)disconnect.textContent=label(busy?'walletCancel':'walletDisconnect');
  const choice=document.querySelector('#wallet-choice');if(choice)choice.classList.toggle('hidden',connected);
}
async function boot(){
  hosted=mountFinanceHostedWalletUI({document,window,createHostedWalletAdapter,text:label,onAttempt:hostedAttempt,onChange:hostedStateChanged});
  window.YNXFinanceHostedWallet=hosted;
  void discoverWalletProviders(window,160).then(found=>{discoveredYNX=found.ynx?.provider??null;}).catch(()=>{});
  document.querySelector('#connect-metamask')?.addEventListener('click',()=>connect('metamask'));
  document.querySelector('#wallet-disconnect')?.addEventListener('click',disconnectStandardWallet);
  document.querySelector('#wallet-revoke')?.addEventListener('click',()=>revokeStandardWallet());
  document.querySelector('#wallet-switch')?.addEventListener('click',()=>{disconnectStandardWallet();document.querySelector('#connect-ynx')?.focus();});
  document.querySelector('#wallet-details')?.addEventListener('click',()=>{lastMessage='WALLET_DETAILS_ONLY';render();});
  document.addEventListener('finance:localechange',render);
  document.querySelector('#install-wallet')?.setAttribute('href',DOWNLOAD);
  document.querySelector('#install-metamask')?.setAttribute('href',METAMASK);
  await restoreStandardWallet();
  bindPrivateFinanceUI();
}
window.addEventListener('pagehide',()=>{intent++;activeTransport=null;detach();void hosted?.disconnect();});
window.addEventListener('pageshow',event=>{if(event.persisted)restoreStandardWallet();});
