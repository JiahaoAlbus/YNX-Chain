import {StandardWalletConnection,discoverWalletProviders} from './vendor/standard-wallet-browser-c97f85e9.mjs';

const ORIGIN='https://finance.ynxweb4.com';
const PROVIDER_KEY='ynx.finance.standard-wallet.provider.v2';
const DOWNLOAD='https://www.ynxweb4.com/dapp/download',METAMASK='https://metamask.io/download/';
const CHAIN=Object.freeze({chainId:'0x1917',chainName:'YNX Testnet',nativeCurrency:{name:'YNX Testnet',symbol:'YNXT',decimals:18},rpcUrls:['https://rpc.ynxweb4.com/evm'],blockExplorerUrls:['https://explorer.ynxweb4.com']});
let connection=null,unsubscribe=()=>{},intent=0,revision=0,busy=false,revoking=null;
let standard=Object.freeze({status:'disconnected',providerKind:null,account:null,chainId:null});
let lastMessage='';
const ready=new Promise(resolve=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',resolve,{once:true}):resolve()).then(boot);
window.YNXFinanceWallet=Object.freeze({
  ready,connect:()=>connect('ynx-wallet'),connectMetaMask:()=>connect('metamask'),
  restoreStandardWallet,disconnectStandardWallet,revokeStandardWallet,
  getStandardWalletState:()=>standard,getRevision:()=>revision,
  connected:()=>false,session:()=>null,requireProof:privateUnavailable,
  disconnect:disconnectPrivate,reportPrivateFailure,
});
function privateUnavailable(){throw new Error('PRIVATE_SERVICE_DEGRADED: Private Finance requires its separate Product Session v2 approval. Standard Wallet and public information remain available.');}
async function disconnectPrivate(){reportPrivateFailure();return {status:'unavailable',revoked:false};}
function reportPrivateFailure(){window.dispatchEvent(new CustomEvent('ynx-finance-private-state',{detail:{status:'degraded',session:null}}));}
function preference(value){try{if(value===undefined){const saved=localStorage.getItem(PROVIDER_KEY);return ['ynx-wallet','metamask'].includes(saved)?saved:null;}if(value)localStorage.setItem(PROVIDER_KEY,value);else localStorage.removeItem(PROVIDER_KEY);}catch{}return null;}
function isCurrent(value,selected=connection){if(value!==intent||selected!==connection)throw new Error('WALLET_REQUEST_SUPERSEDED');}
function detach(){unsubscribe();unsubscribe=()=>{};const old=connection;connection=null;old?.disconnect();}
function publish(next,message=''){standard=Object.freeze({...next});revision++;lastMessage=message;render();window.dispatchEvent(new CustomEvent('ynx-finance-standard-state',{detail:{...standard,revision}}));}
function snapshot(selected,kind){const session=selected.current;return session?{status:session.selectedChain==='0x1917'?'connected':'wrong-chain',providerKind:kind,account:session.selectedAccount,chainId:session.selectedChain}:{status:'disconnected',providerKind:kind,account:null,chainId:null};}
function attach(provider,kind){
  const selected=new StandardWalletConnection({provider,origin:ORIGIN,metadata:{name:'YNX Finance',url:ORIGIN}});
  connection=selected;
  unsubscribe=selected.subscribe(({event})=>{
    if(selected!==connection||!['accountsChanged','chainChanged','disconnect'].includes(event))return;
    const next=snapshot(selected,kind);
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
async function connect(kind){
  if(!['ynx-wallet','metamask'].includes(kind))throw new Error('WALLET_SELECTION_INVALID');
  const value=++intent;detach();preference(null);busy=true;publish({status:'connecting',providerKind:kind,account:null,chainId:null});
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
  const kind=preference(),value=++intent;detach();busy=false;publish({status:'disconnected',providerKind:kind,account:null,chainId:null});
  if(!kind)return null;
  try{
    const discovery=await discoverWalletProviders(window,160);isCurrent(value);
    const provider=(kind==='ynx-wallet'?discovery.ynx:discovery.metamask)?.provider;
    if(!provider){lastMessage='WALLET_NOT_FOUND';render();return null;}
    const selected=attach(provider,kind);await selected.restore();isCurrent(value,selected);
    publish(snapshot(selected,kind));if(standard.status!=='connected')preference(null);return standard;
  }catch(error){if(value===intent){detach();publish({status:'disconnected',providerKind:kind,account:null,chainId:null},error.message||'WALLET_UNAVAILABLE');}return null;}
}
function disconnectStandardWallet(){intent++;busy=false;preference(null);detach();publish({status:'disconnected',providerKind:null,account:null,chainId:null},'LOCAL_DISCONNECT_ONLY');}
async function revokeStandardWallet(){
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
  if(status)status.textContent=(lastMessage?lastMessage+' · ':'')+(connected?(standard.providerKind==='metamask'?'MetaMask':'YNX Wallet')+' · '+standard.account+' · '+standard.chainId+' · Standard connection only.':busy?'Waiting for the selected wallet. You may cancel.':'Standard Wallet not connected. Choose YNX Wallet or MetaMask; public information remains available.');
  for(const element of document.querySelectorAll('.connect,#connect-metamask'))element.disabled=busy;
  for(const id of ['wallet-details','wallet-disconnect','wallet-revoke','wallet-switch']){const element=document.querySelector('#'+id);if(element)element.hidden=!(connected||id==='wallet-disconnect'&&busy);}
  const revoke=document.querySelector('#wallet-revoke');if(revoke)revoke.disabled=busy;
  const disconnect=document.querySelector('#wallet-disconnect');if(disconnect)disconnect.textContent=busy?'Cancel connection':'Disconnect wallet';
  const choice=document.querySelector('#wallet-choice');if(choice)choice.classList.toggle('hidden',connected);
}
async function boot(){
  document.querySelector('#connect-metamask')?.addEventListener('click',()=>connect('metamask'));
  document.querySelector('#wallet-disconnect')?.addEventListener('click',disconnectStandardWallet);
  document.querySelector('#wallet-revoke')?.addEventListener('click',()=>revokeStandardWallet());
  document.querySelector('#wallet-switch')?.addEventListener('click',()=>{disconnectStandardWallet();document.querySelector('#connect-ynx')?.focus();});
  document.querySelector('#wallet-details')?.addEventListener('click',()=>{lastMessage='Standard Wallet does not authorize private Finance, sign or move assets.';render();});
  document.querySelector('#install-wallet')?.setAttribute('href',DOWNLOAD);
  document.querySelector('#install-metamask')?.setAttribute('href',METAMASK);
  await restoreStandardWallet();
}
window.addEventListener('pagehide',()=>{intent++;detach();});
window.addEventListener('pageshow',event=>{if(event.persisted)restoreStandardWallet();});
