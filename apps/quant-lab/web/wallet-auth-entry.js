import {canonicalJSON} from '../node_modules/@ynx-chain/wallet-auth/src/canonical.js';
import {StandardWalletConnection,discoverWalletProviders} from '../vendor/standard-wallet-browser-c97f85e9.mjs';
import {parseAuthorizationRequest} from '../node_modules/@ynx-chain/wallet-auth/src/protocol.js';
import {parseAuthorizationCallbackURL} from '../node_modules/@ynx-chain/wallet-auth/src/deep-link.js';
import {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_RPC_PROBE_TRANSPORT} from '../node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js';
import {quantWalletAuthorizationRegistry} from './product-session-registry.js';
import {ensureYNXTestnet} from './ynx-testnet.js';

const INSTALL_URL='https://www.ynxweb4.com/dapp/download',METAMASK_URL='https://metamask.io/download/',PENDING_KEY='ynx.quant.canonical-authorize.pending.v1',REQUEST_TTL_MS=5*60*1000;
const PROVIDER_KEY='ynx.quant.standard-wallet.v1.provider';
const QUANT_ORIGIN='https://quant.ynxweb4.com';
let configuredDevice=null,standardWallet=null,standardWalletState=createStandardWalletConnectState(),standardProvider=null,standardConnection=null,detachProviderEvents=()=>{},walletRevision=0,walletIntent=0,walletBusy=false,revokingConnection=null;
window.YNXQuantWallet=Object.freeze({connect:beginAuthorization,configure:configureQuantAuthorization,handleCallback:handleAuthorizationCallback,requireProof,retry:beginAuthorization,revoke:revokePrivateSession,revokeStandardWallet,connectMetaMask,restoreStandardWallet,disconnectStandardWallet,getStandardWalletState:()=>standardWalletState,readPortfolio,reportRpcProbe:reportQuantRpcProbe});
window.addEventListener('DOMContentLoaded',boot,{once:true});
window.addEventListener('DOMContentLoaded',()=>document.querySelector('#wallet-revoke')?.addEventListener('click',()=>revokeStandardWallet().catch(showError)),{once:true});
window.addEventListener('pagehide',()=>{walletIntent++;walletRevision++;walletBusy=false;detachProvider();});
window.addEventListener('pageshow',event=>{if(event.persisted)restoreStandardWallet().catch(showError);});
function unavailable(){return new Error('PRIVATE_SERVICE_DEGRADED: Product Session is unavailable. Standard Wallet, Research and Paper remain available.');}
function deviceUnavailable(){return new Error('PRIVATE_SERVICE_DEGRADED: Canonical YNX authorization requires a platform-proven P-256 device public key. No local key or session was fabricated.');}
function randomNonce(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join('');}
function readPending(){const value=localStorage.getItem(PENDING_KEY);if(!value)return null;try{return parseAuthorizationRequest(JSON.parse(value),{registry:quantWalletAuthorizationRegistry});}catch{localStorage.removeItem(PENDING_KEY);return null;}}
function writePending(request){localStorage.setItem(PENDING_KEY,canonicalJSON(request));}
function requestFor(publicKey,scopes=['quant:account','quant:mandate:create','quant:mandate:execute','quant:mandate:revoke']){const issuedAt=new Date();return parseAuthorizationRequest({version:'1',nonce:randomNonce(),chainId:'ynx_6423-1',requestingProduct:'quant',productClientId:'ynx-quant-v1',bundleId:'com.ynxweb4.quant',productDeviceAlgorithm:'p256-sha256',productDeviceKey:publicKey,callback:'https://quant.ynxweb4.com/wallet-auth/callback',scopes,purpose:'Connect YNX Quant for research, paper, and explicitly previewed Testnet actions.',issuedAt:issuedAt.toISOString(),expiresAt:new Date(issuedAt.getTime()+REQUEST_TTL_MS).toISOString()},{registry:quantWalletAuthorizationRegistry,now:issuedAt});}
/** Accepts only a platform-proven public key; endpoint, origin, callback and scopes are fixed above. */
export function configureQuantAuthorization(capabilities){const publicKey=capabilities?.device?.publicKey;if(typeof publicKey!=='string')throw deviceUnavailable();requestFor(publicKey,['quant:account']);configuredDevice=Object.freeze({publicKey});return configuredDevice;}
async function boot(){document.querySelector('#connect-wallet')?.addEventListener('click',()=>standardWalletState.status==='connected'?showStatus(`Standard ${standardWalletState.providerKind==='metamask'?'MetaMask':'YNX Wallet'}: ${standardWalletState.account||'—'} on ${standardWalletState.chainId||'—'}. Product Session remains DEGRADED.`):beginAuthorization().catch(showError));document.querySelector('#connect-metamask')?.addEventListener('click',()=>connectMetaMask().catch(showError));document.querySelector('#wallet-details')?.addEventListener('click',()=>showStatus(`Standard ${standardWalletState.providerKind==='metamask'?'MetaMask':'YNX Wallet'}: ${standardWalletState.account||'—'} on ${standardWalletState.chainId||'—'}. Product Session remains DEGRADED.`));document.querySelector('#wallet-disconnect')?.addEventListener('click',disconnectStandardWallet);document.querySelector('#wallet-switch')?.addEventListener('click',()=>{disconnectStandardWallet();showStatus('Choose YNX Wallet or MetaMask to switch providers. No account request was sent.');});document.querySelector('#install-wallet')?.setAttribute('href',INSTALL_URL);document.querySelector('#install-metamask')?.setAttribute('href',METAMASK_URL);await restoreCallbackFromLocation().catch(showError);await restoreStandardWallet().catch(()=>null);render();}
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
async function restoreCallbackFromLocation(){if(!location.href.includes('response='))return null;return handleAuthorizationCallback(location.href);}
export function handleAuthorizationCallback(url){const request=readPending();if(!request)throw new Error('AUTHORIZATION_PENDING_REQUEST_MISSING: callback was rejected because no matching persisted request exists.');const result=parseAuthorizationCallbackURL(url,request);localStorage.removeItem(PENDING_KEY);if(result.decision==='rejected'){showStatus('Wallet authorization was rejected. Standard Wallet remains unchanged.');return result;}showStatus('Wallet approval received. Product Session remains DEGRADED; no strategy or order authority was granted.');return result;}
function transition(event){standardWalletState=reduceStandardWalletConnectState(standardWalletState,event);return standardWalletState;}
function providerKind(label){return label==='MetaMask'?'metamask':'ynx-wallet';}
function detachProvider(){detachProviderEvents();detachProviderEvents=()=>{};const previous=standardConnection;standardConnection=null;standardProvider=null;previous?.disconnect();}
function createProviderConnection(provider){const connection=new StandardWalletConnection({provider,origin:QUANT_ORIGIN,metadata:{name:'YNX Quant',url:QUANT_ORIGIN}});standardConnection=connection;standardProvider=provider;return connection;}
function bindProvider(provider,connection){standardProvider=provider;detachProviderEvents=connection.subscribe(({event,value})=>{if(connection!==standardConnection||!['accountsChanged','chainChanged','disconnect'].includes(event))return;const previous=[standardWalletState.status,standardWalletState.account,standardWalletState.chainId].join(':');try{if(event==='accountsChanged')transition({type:'ACCOUNTS_CHANGED',accounts:value});else if(event==='chainChanged')transition({type:'CHAIN_CHANGED',chainId:value});else if(event==='disconnect'){if(revokingConnection!==connection){disconnectStandardWallet();return;}transition({type:'DISCONNECT'});}if(previous!==[standardWalletState.status,standardWalletState.account,standardWalletState.chainId].join(':'))walletRevision++;syncStandardWallet();}catch(error){disconnectStandardWallet();showError(error);}});}
function syncStandardWallet(){if(standardWalletState.status==='connected')standardWallet=Object.freeze({provider:standardWalletState.providerKind,accounts:[standardWalletState.account],connectionState:standardWalletState});else standardWallet=null;render();}
function disconnectStandardWallet(){walletIntent++;walletRevision++;walletBusy=false;rememberProvider(null);detachProvider();transition({type:'DISCONNECT'});standardWallet=null;render();showStatus('Standard Wallet disconnected locally; wallet permissions were not revoked. Research and Paper remain available.');}
async function connectStandardWallet(provider,label,revision){
  assertCurrent(revision);
  if(!provider?.request){transition({type:'FAIL',code:'WALLET_NOT_FOUND'});syncStandardWallet();showStatus(`${label} is not installed. This does not affect Product Session status.`);return {status:'unavailable',download:label==='MetaMask'?METAMASK_URL:INSTALL_URL};}
  try {
    transition({type:'PROVIDER_SELECTED',providerKind:providerKind(label)});
    const connection=createProviderConnection(provider);
    await ensureYNXTestnet(connection,()=>assertCurrent(revision));
    const session=await connection.connect();assertCurrent(revision);
    const account=session?.selectedAccount,chainId=session?.selectedChain;
    transition({type:'ACCOUNT_APPROVED',account});transition({type:'CHAIN_CONFIRMED',chainId});
    if(standardWalletState.status!=='connected')throw new Error('WRONG_NETWORK: Wallet did not switch to YNX Testnet.');
    rememberProvider(providerKind(label));bindProvider(provider,connection);syncStandardWallet();
    showStatus(`${label} connected (1 account) on YNX Testnet. Product Session remains DEGRADED.`);return standardWallet;
  }catch(error){if(revision===walletRevision)try{detachProvider();transition({type:'FAIL',code:'STANDARD_WALLET_CONNECT_FAILED'});syncStandardWallet();}catch{}throw error;}
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
async function requireProof(scope){if(!['quant:mandate:create','quant:mandate:execute'].includes(scope))throw new Error('SCOPE_NOT_ALLOWED: Quant execution scope is not registered.');throw unavailable();}
async function revokePrivateSession(){localStorage.removeItem(PENDING_KEY);showStatus('Pending private authorization cleared. Standard Wallet remains connected.');return null;}
function render(){const button=document.querySelector('#connect-wallet'),connected=standardWalletState.status==='connected';if(button){button.textContent=connected?'Wallet details':'Connect YNX Wallet';button.disabled=walletBusy;}const metaMask=document.querySelector('#connect-metamask');if(metaMask)metaMask.disabled=walletBusy;for(const id of ['wallet-details','wallet-disconnect','wallet-switch','wallet-revoke']){const element=document.querySelector(`#${id}`);if(element)element.hidden=!(connected||id==='wallet-disconnect'&&walletBusy);}const revoke=document.querySelector('#wallet-revoke');if(revoke)revoke.disabled=walletBusy;const disconnect=document.querySelector('#wallet-disconnect');if(disconnect)disconnect.textContent=walletBusy?'Cancel connection':'Disconnect wallet';const details=document.querySelector('#wallet-details-text');if(details){details.hidden=!connected;details.textContent=connected?`${standardWalletState.providerKind==='metamask'?'MetaMask':'YNX Wallet'} · ${standardWalletState.account} · ${standardWalletState.chainId}`:'';}if(standardWalletState.focusRestoreTarget==='wallet-connect-trigger')button?.focus?.();window.dispatchEvent(new CustomEvent('ynx:quant-wallet-state',{detail:standardWalletState}));}
function showStatus(message){const status=document.querySelector('#wallet-status');if(status)status.textContent=message;}
function showError(error){showStatus(error instanceof Error?error.message:'Wallet connection failed closed.');}
