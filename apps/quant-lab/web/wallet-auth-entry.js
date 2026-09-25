import {StandardWalletConnection,discoverWalletProviders} from '../vendor/standard-wallet-browser-c97f85e9.mjs';
import {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_RPC_PROBE_TRANSPORT} from '../node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js';
import {ensureYNXTestnet} from './ynx-testnet.js';
import {createHostedWalletAdapter} from '../vendor/hosted-wallet-adapter-19d8a9a2.js';
import {mountPrivateSession,beginPrivateSession,retryPrivateSession,revokePrivateSession,handlePrivateReturn,getPrivateSessionState,privateAccount,requireNativeExecutionProof} from './private-session.js';

const INSTALL_URL='https://www.ynxweb4.com/dapp/download',METAMASK_URL='https://metamask.io/download/';
const PROVIDER_KEY='ynx.quant.standard-wallet.v1.provider';
const QUANT_ORIGIN='https://quant.ynxweb4.com';
let standardWallet=null,standardWalletState=createStandardWalletConnectState(),standardProvider=null,standardConnection=null,hostedAdapter=null,standardTransport=null,detachProviderEvents=()=>{},walletRevision=0,walletIntent=0,walletBusy=false,revokingConnection=null;
window.YNXQuantWallet=Object.freeze({connect:beginAuthorization,connectHosted,handleCallback:handlePrivateReturn,requireProof:requireNativeExecutionProof,retry:beginAuthorization,revoke:revokePrivateSession,beginPrivateSession,retryPrivateSession,getPrivateSessionState,privateAccount,revokeStandardWallet,connectMetaMask,restoreStandardWallet,disconnectStandardWallet,getStandardWalletState:()=>standardWalletState,readPortfolio,reportRpcProbe:reportQuantRpcProbe});
window.addEventListener('DOMContentLoaded',boot,{once:true});
window.addEventListener('DOMContentLoaded',mountPrivateSession,{once:true});
window.addEventListener('DOMContentLoaded',()=>document.querySelector('#wallet-revoke')?.addEventListener('click',()=>revokeStandardWallet().catch(showError)),{once:true});
window.addEventListener('pagehide',()=>{walletIntent++;walletRevision++;walletBusy=false;detachProvider();});
window.addEventListener('pageshow',event=>{if(event.persisted)restoreStandardWallet().catch(showError);});
function randomNonce(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join('');}
async function boot(){document.querySelector('#connect-wallet')?.addEventListener('click',()=>standardWalletState.status==='connected'?showStatus(`Standard ${walletLabel()}: ${standardWalletState.account||'—'} on ${standardWalletState.chainId||'—'}. Product Session remains DEGRADED.`):beginAuthorization().catch(showError));document.querySelector('#connect-hosted')?.addEventListener('click',()=>connectHosted().catch(showError));document.querySelector('#connect-metamask')?.addEventListener('click',()=>connectMetaMask().catch(showError));document.querySelector('#wallet-details')?.addEventListener('click',()=>showStatus(`Standard ${walletLabel()}: ${standardWalletState.account||'—'} on ${standardWalletState.chainId||'—'}. Product Session remains DEGRADED.`));document.querySelector('#wallet-disconnect')?.addEventListener('click',disconnectStandardWallet);document.querySelector('#wallet-switch')?.addEventListener('click',()=>{disconnectStandardWallet();showStatus('Choose Installed YNX Wallet, YNX Wallet Web or MetaMask to switch providers. No account request was sent.');});document.querySelector('#install-wallet')?.setAttribute('href',INSTALL_URL);document.querySelector('#install-metamask')?.setAttribute('href',METAMASK_URL);await restoreStandardWallet().catch(()=>null);render();}
function walletLabel(){return standardWalletState.providerKind==='metamask'?'MetaMask':standardTransport==='hosted-wallet-web'?'YNX Wallet Web':'YNX Wallet';}
function savedProviderKind(){try{const value=localStorage.getItem(PROVIDER_KEY);return value==='ynx-wallet'||value==='metamask'?value:null;}catch{return null;}}
function rememberProvider(kind){try{if(kind)localStorage.setItem(PROVIDER_KEY,kind);else localStorage.removeItem(PROVIDER_KEY);}catch{}}
function assertCurrent(revision){if(revision!==walletRevision)throw new Error('WALLET_REQUEST_SUPERSEDED: Wallet selection changed.');}
function startConnection(){walletIntent++;walletRevision++;walletBusy=true;detachProvider();standardWallet=null;transition({type:'BEGIN',pendingIntent:randomNonce()});render();return walletRevision;}
async function beginAuthorization(){
  const revision=startConnection();
  try {
    const discovery=await discoverWalletProviders(globalThis,1500);
    assertCurrent(revision);
    if(discovery.ynx?.provider)return await connectStandardWallet(discovery.ynx.provider,'YNX Wallet',revision);
    transition({type:'FAIL',code:'WALLET_NOT_FOUND'});syncStandardWallet();showStatus('YNX Wallet is unavailable in this browser. This page remains available; use Download YNX Wallet or MetaMask.');return {status:'unavailable',download:INSTALL_URL};
  } catch(error){if(revision===walletRevision)throw error;return null;}
  finally{if(revision===walletRevision){walletBusy=false;render();}}
}
function transition(event){standardWalletState=reduceStandardWalletConnectState(standardWalletState,event);return standardWalletState;}
function providerKind(label){return label==='MetaMask'?'metamask':'ynx-wallet';}
function detachProvider(){detachProviderEvents();detachProviderEvents=()=>{};const previous=standardConnection,hosted=hostedAdapter;standardConnection=null;hostedAdapter=null;standardProvider=null;standardTransport=null;previous?.disconnect();try{Promise.resolve(hosted?.disconnect()).catch(()=>{});}catch{}}
function createProviderConnection(provider){const connection=new StandardWalletConnection({provider,origin:QUANT_ORIGIN,metadata:{name:'YNX Quant',url:QUANT_ORIGIN}});standardConnection=connection;standardProvider=provider;return connection;}
function bindProvider(provider,connection){standardProvider=provider;detachProviderEvents=connection.subscribe(({event,value})=>{if(connection!==standardConnection||!['accountsChanged','chainChanged','disconnect'].includes(event))return;const previous=[standardWalletState.status,standardWalletState.account,standardWalletState.chainId].join(':');try{if(event==='accountsChanged')transition({type:'ACCOUNTS_CHANGED',accounts:value});else if(event==='chainChanged')transition({type:'CHAIN_CHANGED',chainId:value});else if(event==='disconnect'){if(revokingConnection!==connection){disconnectStandardWallet();return;}transition({type:'DISCONNECT'});}if(previous!==[standardWalletState.status,standardWalletState.account,standardWalletState.chainId].join(':'))walletRevision++;syncStandardWallet();}catch(error){disconnectStandardWallet();showError(error);}});}
function syncStandardWallet(){if(standardWalletState.status==='connected')standardWallet=Object.freeze({provider:standardWalletState.providerKind,accounts:[standardWalletState.account],connectionState:standardWalletState});else standardWallet=null;render();}
function disconnectStandardWallet(){walletIntent++;walletRevision++;walletBusy=false;rememberProvider(null);detachProvider();transition({type:'DISCONNECT'});standardWallet=null;render();showStatus('Standard Wallet disconnected locally; wallet permissions were not revoked. Research and Paper remain available.');}
async function connectStandardWallet(provider,label,revision){
  assertCurrent(revision);
  if(!provider?.request){transition({type:'FAIL',code:'WALLET_NOT_FOUND'});syncStandardWallet();showStatus(`${label} is not installed. This does not affect Product Session status.`);return {status:'unavailable',download:label==='MetaMask'?METAMASK_URL:INSTALL_URL};}
  try {
    transition({type:'PROVIDER_SELECTED',providerKind:providerKind(label)});
    const connection=createProviderConnection(provider);standardTransport='injected';
    await ensureYNXTestnet(connection,()=>assertCurrent(revision));
    const session=await connection.connect();assertCurrent(revision);
    const account=session?.selectedAccount,chainId=session?.selectedChain;
    transition({type:'ACCOUNT_APPROVED',account});transition({type:'CHAIN_CONFIRMED',chainId});
    if(standardWalletState.status!=='connected')throw new Error('WRONG_NETWORK: Wallet did not switch to YNX Testnet.');
    rememberProvider(providerKind(label));bindProvider(provider,connection);syncStandardWallet();
    showStatus(`${label} connected (1 account) on YNX Testnet. Product Session remains DEGRADED.`);return standardWallet;
  }catch(error){if(revision===walletRevision)try{detachProvider();transition({type:'FAIL',code:'STANDARD_WALLET_CONNECT_FAILED'});syncStandardWallet();}catch{}throw error;}
}
function connectHosted(){
  // The Wallet-owned adapter must open the Hosted approval window synchronously
  // in this explicit click. Never use a custom scheme or an RPC probe here.
  const revision=startConnection();transition({type:'PROVIDER_SELECTED',providerKind:'ynx-wallet'});
  let adapter,approval;
  try{
    adapter=createHostedWalletAdapter({window});hostedAdapter=adapter;standardProvider=adapter;standardTransport='hosted-wallet-web';
    const pendingAbort=()=>{if(revision!==walletRevision||adapter!==hostedAdapter||standardWalletState.status==='connected')return;walletRevision++;walletBusy=false;detachProvider();transition({type:'DISCONNECT'});syncStandardWallet();showStatus('YNX Wallet Web approval did not complete. Research and Paper remain available.');};
    const accountsChanged=accounts=>{if(revision!==walletRevision||adapter!==hostedAdapter)return;if(standardWalletState.status!=='connected'){if(!Array.isArray(accounts)||accounts.length===0)pendingAbort();return;}if(!Array.isArray(accounts)||accounts.length!==1||accounts[0]?.toLowerCase()!==standardWalletState.account)disconnectStandardWallet();};
    const chainChanged=chainId=>{if(revision===walletRevision&&adapter===hostedAdapter&&chainId!=='0x1917'){if(standardWalletState.status==='connected')disconnectStandardWallet();else pendingAbort();}};
    const disconnected=()=>{if(revision===walletRevision&&adapter===hostedAdapter){if(standardWalletState.status==='connected')disconnectStandardWallet();else pendingAbort();}};
    for(const [event,listener] of [['accountsChanged',accountsChanged],['chainChanged',chainChanged],['disconnect',disconnected]])adapter.on(event,listener);
    detachProviderEvents=()=>{adapter.removeListener('accountsChanged',accountsChanged);adapter.removeListener('chainChanged',chainChanged);adapter.removeListener('disconnect',disconnected);};
    approval=adapter.connect();
  }catch(error){if(revision===walletRevision){detachProvider();transition({type:'FAIL',code:'HOSTED_WALLET_UNAVAILABLE'});walletBusy=false;syncStandardWallet();}return Promise.reject(error);}
  return Promise.resolve(approval).then(async accounts=>{
    assertCurrent(revision);
    if(!Array.isArray(accounts)||accounts.length!==1||!/^0x[0-9a-f]{40}$/u.test(accounts[0]))throw new Error('HOSTED_ACCOUNT_INVALID');
    const chainId=await adapter.request({method:'eth_chainId'});assertCurrent(revision);
    if(adapter.connected!==true||adapter.account!==accounts[0])throw new Error('HOSTED_APPROVAL_LOST');
    transition({type:'ACCOUNT_APPROVED',account:accounts[0]});transition({type:'CHAIN_CONFIRMED',chainId});
    if(standardWalletState.status!=='connected')throw new Error('WRONG_NETWORK: Hosted Wallet did not confirm YNX Testnet.');
    rememberProvider(null);syncStandardWallet();showStatus('YNX Wallet Web connected (1 account) on YNX Testnet. Product Session remains DEGRADED.');return standardWallet;
  }).catch(error=>{if(revision===walletRevision){detachProvider();transition({type:'FAIL',code:'HOSTED_WALLET_CONNECT_FAILED'});syncStandardWallet();throw error;}return null;}).finally(()=>{if(revision===walletRevision){walletBusy=false;render();}});
}
async function connectMetaMask(){
  const revision=startConnection();
  try{const discovery=await discoverWalletProviders(globalThis,1500);assertCurrent(revision);const provider=discovery.metamask?.provider;return await connectStandardWallet(provider,'MetaMask',revision);}
  catch(error){if(revision===walletRevision)throw error;return null;}
  finally{if(revision===walletRevision){walletBusy=false;render();}}
}
async function restoreStandardWallet(){
  const kind=savedProviderKind();walletIntent++;const revision=++walletRevision;walletBusy=false;detachProvider();standardWallet=null;transition({type:'DISCONNECT'});render();if(!kind)return null;
  try{
    const discovery=await discoverWalletProviders(globalThis,1500);assertCurrent(revision);
    const provider=(kind==='ynx-wallet'?discovery.ynx:discovery.metamask)?.provider;if(!provider?.request)return null;
    const connection=createProviderConnection(provider),session=await connection.restore();assertCurrent(revision);
    const accounts=session?[session.selectedAccount]:[],chainId=session?.selectedChain||null;
    transition({type:'RESTORE',providerKind:kind,accounts,chainId});
    if(standardWalletState.status==='connected')bindProvider(provider,connection);else detachProvider();syncStandardWallet();return standardWallet;
  }catch(error){if(revision===walletRevision){detachProvider();throw error;}return null;}
}
async function revokeStandardWallet(){
  if(standardTransport==='hosted-wallet-web')return Object.freeze({status:'unsupported',permissionRevoked:false,locallyDisconnected:false});
  const connection=standardConnection,intent=walletIntent;
  if(!connection)return Object.freeze({status:'unsupported',permissionRevoked:false,locallyDisconnected:true});
  revokingConnection=connection;walletBusy=true;render();
  try{
    const result=await connection.revoke();
    if(intent!==walletIntent||connection!==standardConnection)return Object.freeze({status:'superseded',permissionRevoked:false,locallyDisconnected:standardWalletState.status!=='connected'});
    if(result.permissionRevoked){rememberProvider(null);detachProvider();transition({type:'DISCONNECT'});standardWallet=null;}
    showStatus(result.permissionRevoked?'Wallet account access revoked and empty accounts readback confirmed. Token approvals were not changed.':`Wallet permission revocation ${result.status}; no revocation success was confirmed. Local disconnect remains available.`);
    return result;
  }finally{if(intent===walletIntent){revokingConnection=null;walletBusy=false;render();}}
}
async function readPortfolio(){
  const revision=walletRevision,provider=standardProvider,account=standardWalletState.account;
  const check=()=>{assertCurrent(revision);if(!provider||provider!==standardProvider||standardWalletState.status!=='connected'||account!==standardWalletState.account)throw new Error('WALLET_ACCOUNT_CHANGED: Refresh the selected Wallet portfolio.');};
  check();
  const blockNumber=await provider.request({method:'eth_blockNumber'});check();
  if(typeof blockNumber!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(blockNumber))throw new Error('INVALID_BLOCK: Wallet returned no verifiable block number.');
  const balance=await provider.request({method:'eth_getBalance',params:[account,blockNumber]});check();
  if(typeof balance!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(balance))throw new Error('INVALID_BALANCE: Wallet returned an invalid native balance.');
  const chainId=await provider.request({method:'eth_chainId'});check();
  const accounts=await provider.request({method:'eth_accounts'});check();
  if(chainId!=='0x1917'){walletRevision++;transition({type:'CHAIN_CHANGED',chainId});syncStandardWallet();throw new Error('WRONG_NETWORK: Portfolio requires YNX Testnet.');}
  if(!Array.isArray(accounts)||String(accounts[0]).toLowerCase()!==account){walletRevision++;transition({type:'ACCOUNTS_CHANGED',accounts:Array.isArray(accounts)?accounts:[]});syncStandardWallet();throw new Error('WALLET_ACCOUNT_CHANGED: Portfolio identity no longer matches the selected account.');}
  return Object.freeze({account,chainId,providerKind:standardWalletState.providerKind,asset:'YNXT',decimals:18,balanceBaseUnits:BigInt(balance).toString(),blockNumber:BigInt(blockNumber).toString(),source:'selected-wallet-provider',asOf:new Date().toISOString()});
}
function reportQuantRpcProbe({ready,code}){if(standardWalletState.status!=='connected')return standardWalletState;transition({type:ready?'RPC_PROBE_READY':'RPC_PROBE_DEGRADED',probeTransport:STANDARD_WALLET_RPC_PROBE_TRANSPORT,code:code||'RPC_PROBE_UNAVAILABLE'});return standardWalletState;}
function render(){const button=document.querySelector('#connect-wallet'),connected=standardWalletState.status==='connected';if(button){button.textContent='Connect Installed YNX Wallet';button.disabled=walletBusy;}for(const id of ['connect-hosted','connect-metamask']){const action=document.querySelector(`#${id}`);if(action)action.disabled=walletBusy;}for(const id of ['wallet-details','wallet-disconnect','wallet-switch','wallet-revoke']){const element=document.querySelector(`#${id}`);if(element)element.hidden=!(connected||id==='wallet-disconnect'&&walletBusy);}const revoke=document.querySelector('#wallet-revoke');if(revoke){revoke.disabled=walletBusy||standardTransport==='hosted-wallet-web';revoke.title=standardTransport==='hosted-wallet-web'?'Hosted Wallet supports local disconnect only; permission revocation is not verified.':'';}const disconnect=document.querySelector('#wallet-disconnect');if(disconnect)disconnect.textContent=walletBusy?'Cancel connection':'Disconnect wallet';const details=document.querySelector('#wallet-details-text');if(details){details.hidden=!connected;details.textContent=connected?`${walletLabel()} · ${standardWalletState.account} · ${standardWalletState.chainId}`:'';}if(standardWalletState.focusRestoreTarget==='wallet-connect-trigger')button?.focus?.();window.dispatchEvent(new CustomEvent('ynx:quant-wallet-state',{detail:standardWalletState}));}
function showStatus(message){const status=document.querySelector('#wallet-status');if(status)status.textContent=message;}
function showError(error){showStatus(error instanceof Error?error.message:'Wallet connection failed closed.');}
