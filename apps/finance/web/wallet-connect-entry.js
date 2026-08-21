// The v2 package root currently exports Node-only Gateway modules; import its
// browser-safe launcher module from the same vendored, hash-pinned package.
import {launchWebAuthorization} from './node_modules/@ynx-chain/wallet-auth/src/authorize-launcher.js';
import {
  createStandardWalletConnectState,
  reduceStandardWalletConnectState,
  STANDARD_WALLET_CHAIN_ID,
  STANDARD_WALLET_CONNECT_STATUS,
  STANDARD_WALLET_RPC_PROBE_TRANSPORT,
} from './node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js';

const YNX_CHAIN_HEX=STANDARD_WALLET_CHAIN_ID;
const DOWNLOADS=Object.freeze({ynxWallet:'https://www.ynxweb4.com/dapp/download',metaMask:'https://metamask.io/download/'});
let walletState=createStandardWalletConnectState();
let boundProvider=null;
let boundListeners=null;

function transition(event){walletState=reduceStandardWalletConnectState(walletState,event);window.dispatchEvent(new CustomEvent('ynx-finance-standard-wallet-state',{detail:walletState}));return walletState}
function stateResult(status=walletState.status){return Object.freeze({status,account:walletState.account,chainId:walletState.chainId,providerKind:walletState.providerKind,authority:walletState.authority,connectionState:walletState,downloads:DOWNLOADS})}
function pendingIntent(){return crypto.randomUUID().replaceAll('-','')}
function safeCode(error){const value=String(error?.code||'WALLET_CONNECT_FAILED').toUpperCase().replace(/[^A-Z0-9_]/g,'_');return /^[A-Z][A-Z0-9_]{2,63}$/.test(value)?value:'WALLET_CONNECT_FAILED'}
function detachProvider(){if(!boundProvider||!boundListeners)return;for(const [event,listener] of Object.entries(boundListeners)){try{if(typeof boundProvider.removeListener==='function')boundProvider.removeListener(event,listener);else if(typeof boundProvider.off==='function')boundProvider.off(event,listener)}catch{}}boundProvider=null;boundListeners=null}
function bindProvider(provider){if(boundProvider===provider)return;detachProvider();const accountsChanged=accounts=>{try{transition({type:'ACCOUNTS_CHANGED',accounts})}catch{}};const chainChanged=chainId=>{try{transition({type:'CHAIN_CHANGED',chainId})}catch{}};const disconnect=()=>{try{transition({type:'PROVIDER_DISCONNECT'})}catch{}};for(const [event,listener] of Object.entries({accountsChanged,chainChanged,disconnect})){try{provider.on?.(event,listener)}catch{}}boundProvider=provider;boundListeners={accountsChanged,chainChanged,disconnect}}

async function discover(){
  // v2 Web launcher performs provider discovery only: it never builds or navigates a custom-scheme URL.
  return launchWebAuthorization(undefined,{scope:window,waitMs:160});
}

async function connect(){
  if(walletState.status===STANDARD_WALLET_CONNECT_STATUS.CONNECTED)return stateResult('standard-connected');
  transition({type:'BEGIN',pendingIntent:pendingIntent()});
  const launch=await discover();
  if(launch.status!=='provider-ready'||!launch.providerCandidate?.provider){
    transition({type:'CLOSE_CHOOSER'});
    return Object.freeze({status:'unsupported',detail:launch.detail,downloads:DOWNLOADS,connectionState:walletState});
  }
  const provider=launch.providerCandidate.provider;
  transition({type:'PROVIDER_SELECTED',providerKind:launch.providerCandidate.kind});
  try{
    try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_CHAIN_HEX}]});}
    catch(error){if(error?.code!==4902)throw error;await provider.request({method:'wallet_addEthereumChain',params:[{chainId:YNX_CHAIN_HEX,chainName:'YNX Testnet',nativeCurrency:{name:'YNXT',symbol:'YNXT',decimals:18},rpcUrls:['https://rpc.ynxweb4.com/'],blockExplorerUrls:['https://explorer.ynxweb4.com/']} ]});await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_CHAIN_HEX}]});}
    const chainId=await provider.request({method:'eth_chainId'});
    const accounts=await provider.request({method:'eth_requestAccounts'});
    if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||accounts[0].length===0)throw Object.assign(new Error('The selected standard Wallet returned no account.'),{code:'WALLET_NOT_AUTHORIZED'});
    transition({type:'ACCOUNT_APPROVED',account:accounts[0]});
    transition({type:'CHAIN_CONFIRMED',chainId});
    if(walletState.status!==STANDARD_WALLET_CONNECT_STATUS.CONNECTED)return stateResult('wrong-chain');
    bindProvider(provider);
    return stateResult('standard-connected');
  }catch(error){transition({type:'FAIL',code:safeCode(error)});throw error}
}

async function restore(){
  const launch=await discover();
  if(launch.status!=='provider-ready'||!launch.providerCandidate?.provider)return stateResult('not-restored');
  const provider=launch.providerCandidate.provider;
  try{
    const [accounts,chainId]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);
    transition({type:'RESTORE',providerKind:launch.providerCandidate.kind,accounts,chainId});
    if(walletState.status===STANDARD_WALLET_CONNECT_STATUS.CONNECTED)bindProvider(provider);
    return stateResult(walletState.status===STANDARD_WALLET_CONNECT_STATUS.CONNECTED?'standard-connected':'wrong-chain');
  }catch(error){return Object.freeze({status:'not-restored',detail:safeCode(error),connectionState:walletState,downloads:DOWNLOADS})}
}

function reportAcceptedRpcProbe(status,code){return transition({type:status==='ready'?'RPC_PROBE_READY':'RPC_PROBE_DEGRADED',probeTransport:STANDARD_WALLET_RPC_PROBE_TRANSPORT,...(status==='ready'?{}:{code:safeCode({code})})})}
function disconnect(){detachProvider();return transition({type:'DISCONNECT'})}

window.YNXFinanceWebWallet=Object.freeze({connect,discover,restore,disconnect,reportAcceptedRpcProbe,state:()=>walletState,downloads:DOWNLOADS});
