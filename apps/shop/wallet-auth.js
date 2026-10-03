import {createShopBusinessAuthorization} from './browser-business.js';
import {decodeBase64url} from '@ynx-chain/wallet-auth';
import {discoverWalletProviders,WALLET_PROVIDER_KIND} from './wallet-provider-discovery.js';
import {StandardWalletConnection} from '@ynx-chain/wallet-auth/standard-wallet-connection';
import {createPrivateSessionController} from '../seller-console/product-session.js';
const controller=createPrivateSessionController({productId:'shop',scopes:['account:read','shop:orders:write','shop:profile:write'],purpose:'Manage my YNX Shop profile, cart, and orders on ynx_6423-1.',endpoint:()=>globalThis.__YNX_SHOP_RUNTIME__?.endpoints?.appGateway?.status==='AVAILABLE'?globalThis.__YNX_SHOP_RUNTIME__.endpoints.appGateway.url:null});
let callbackSeller=null;
let sessionRevision=0,connectionRevision=0;
export const onPrivateSessionChange=controller.onChange;
export const privateSession=controller.current;
// The session binding identifies UI context; it is never sent as a bearer.
export const token=()=>controller.current()?.sessionBinding||'';
export const authorizeBusinessRequest=createShopBusinessAuthorization({current:controller.current,authorize:controller.authorize});
export const privateSignoutPending=()=>controller.signoutPending||Boolean(callbackSeller?.signoutPending);
function discardPrivateSession(){sessionRevision++;connectionRevision++;return clearPrivateSession()}
export const expirePrivateSession=discardPrivateSession;
const pendingConnections=new Set();
export function cancelWalletConnection(){connectionRevision++;for(const connection of pendingConnections)connection.disconnect();pendingConnections.clear()}
export const startPrivateSession=()=>controller.begin();
export async function clearPrivateSession(){const states=await Promise.all([controller.clear().catch(()=>null),callbackSeller?.clear().catch(()=>null)]);return states.find(state=>state&&!['disconnected','expired'].includes(state.status))||states[0]}
let standard = null;
let activeConnection = null;
let removeProviderListeners = null;
const standardListeners = new Set();

const YNX_CHAIN = Object.freeze({
  chainId: '0x1917',
  chainName: 'YNX Testnet',
  nativeCurrency: Object.freeze({ name: 'YNX Testnet', symbol: 'YNXT', decimals: 18 }),
  rpcUrls: Object.freeze(['https://evm.ynxweb4.com']),
  blockExplorerUrls: Object.freeze(['https://explorer.ynxweb4.com']),
});
export const OFFICIAL_YNX_WALLET_DOWNLOAD_URL = 'https://www.ynxweb4.com/dapp/download';
export const STANDARD_METAMASK_DOWNLOAD_URL = 'https://metamask.io/download/';

export const standardConnection = () => standard;
export const onStandardConnectionChange = listener => {
  if (typeof listener !== 'function') throw new TypeError('Wallet connection listener must be a function.');
  standardListeners.add(listener);
  return () => standardListeners.delete(listener);
};

export async function startWalletAuth(_surface, options = {}) {
  const revision = sessionRevision;
  const attempt = ++connectionRevision;
  const assertCurrent = () => { if (revision !== sessionRevision || attempt !== connectionRevision) throw walletError('COMMERCE_CONTEXT_CHANGED', 'Wallet connection was cancelled.'); };
  const discovery = await discoverWalletProviders(options.scope ?? globalThis, options.waitMs ?? 180);
  assertCurrent();
  if (discovery.ambiguities.length || discovery.conflictedAnnouncements) throw walletError('WALLET_PROVIDER_AMBIGUOUS', 'Multiple conflicting wallet providers were detected. Disable duplicate extensions and try again.');
  const preferred = options.wallet === 'metamask' ? WALLET_PROVIDER_KIND.METAMASK : WALLET_PROVIDER_KIND.YNX;
  const selected = preferred === WALLET_PROVIDER_KIND.YNX ? discovery.ynx : discovery.metamask;
  if (!selected) {
    const error = walletError(preferred === WALLET_PROVIDER_KIND.YNX ? 'YNX_WALLET_NOT_FOUND' : 'METAMASK_NOT_FOUND', preferred === WALLET_PROVIDER_KIND.YNX ? 'YNX Wallet is not installed in this browser.' : 'MetaMask is not installed in this browser.');
    error.fallbackURL = preferred === WALLET_PROVIDER_KIND.YNX ? OFFICIAL_YNX_WALLET_DOWNLOAD_URL : STANDARD_METAMASK_DOWNLOAD_URL;
    throw error;
  }
  const connection = createStandardConnection(selected, options);
  pendingConnections.add(connection);
  try {
    const connected = await connection.connect();
    assertCurrent();
    const account = connected.selectedAccount;
    const assertAccount = () => { assertCurrent(); if (connection.current?.selectedAccount !== account) throw walletError('COMMERCE_CONTEXT_CHANGED', 'Wallet account changed during connection.'); };
    await ensureYNXChain(connection, assertAccount);
    assertAccount();
    const confirmed = await connection.restore();
    assertAccount();
    if (confirmed?.selectedChain !== YNX_CHAIN.chainId) throw walletError('WRONG_CHAIN', 'The wallet did not confirm YNX Testnet.');
    setStandardConnection(connection, selected.kind);
    try { sessionStorage.setItem('ynx_shop_wallet_kind', selected.kind); } catch {}
    return standard;
  } catch (error) { connection.disconnect(); assertCurrent(); throw error; }
  finally { pendingConnections.delete(connection); }
}

function createStandardConnection(selected, options) {
  const origin=options.scope?.location?.origin??globalThis.location?.origin??'https://shop.ynxweb4.com';
  return new StandardWalletConnection({provider:selected.provider,origin,metadata:{name:'YNX Shop',url:origin}});
}

export async function restoreStandardConnection(options = {}) {
  const revision = sessionRevision;
  const attempt = connectionRevision;
  const discovery = await discoverWalletProviders(options.scope ?? globalThis, options.waitMs ?? 180);
  if (revision !== sessionRevision || attempt !== connectionRevision || discovery.ambiguities.length || discovery.conflictedAnnouncements) return null;
  let remembered = '';
  try { remembered = sessionStorage.getItem('ynx_shop_wallet_kind') || ''; } catch {}
  const candidates = [discovery.ynx, discovery.metamask].filter(Boolean);
  const selected = candidates.find(candidate => candidate.kind === remembered) || (!remembered && candidates.length === 1 ? candidates[0] : null);
  if (!selected) return null;
  const connection=createStandardConnection(selected,options);
  pendingConnections.add(connection);
  try {
    const restored=await connection.restore();
    if (revision !== sessionRevision || attempt !== connectionRevision || !restored || restored.selectedChain !== YNX_CHAIN.chainId) { connection.disconnect(); return null; }
    setStandardConnection(connection,selected.kind);
    return standard;
  } catch { connection.disconnect(); return null; }
  finally { pendingConnections.delete(connection); }
}

function sellerCallbackController(){callbackSeller??=createPrivateSessionController({productId:'shop',scopes:['account:read','shop:seller:operate'],purpose:'Operate only my authorized YNX Shop seller records on ynx_6423-1.',endpoint:()=>globalThis.__YNX_SHOP_RUNTIME__?.endpoints?.appGateway?.status==='AVAILABLE'?globalThis.__YNX_SHOP_RUNTIME__.endpoints.appGateway.url:null});return callbackSeller}
export async function completeWalletCallback(){
 if(new URL(location.href).searchParams.has('response'))throw new Error('Legacy Shop approval requires a fresh canonical approval. Original recovery data was retained.');
 const url=new URL(location.href);
 // The decoded scopes select a local handler only. The approved SDK still
 // validates the original pending nonce/state/device, signature and authority.
 if(url.searchParams.get('result')==='approved'){
  let hint;try{const encoded=url.searchParams.get('approval');if(encoded?.length<=16384)hint=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64url(encoded)))}catch{}
  if(JSON.stringify(hint?.scopes)===JSON.stringify(['account:read','shop:seller:operate'])){
   sellerCallbackController();
   const seller=await callbackSeller.recover(location.href,standard?.account);
   if(seller){history.replaceState({},'',location.pathname+location.hash);return Object.freeze({account:seller.account,expiresAt:seller.expiresAt,continuation:'seller',entry:'https://shop.ynxweb4.com/seller/'})}
   throw new Error(callbackSeller.state?.message||'The original Seller approval was not verified.');
  }
 }
 if(url.searchParams.get('result')==='rejected'){
  let buyerError;try{await controller.recover(location.href,standard?.account)}catch(error){buyerError=error}
  if(!buyerError&&controller.state?.status==='disconnected'){history.replaceState({},'',location.pathname+location.hash);return Object.freeze({continuation:'buyer-rejected'})}
  const selected=sellerCallbackController();await selected.recover(location.href,standard?.account);
  if(selected.state?.status==='disconnected'){history.replaceState({},'',location.pathname+location.hash);return Object.freeze({continuation:'seller',entry:'https://shop.ynxweb4.com/seller/',rejected:true})}
  if(buyerError)throw buyerError;
  return null;
 }
 const session=await controller.recover(location.href,standard?.account);
 if(!session&&url.searchParams.get('result')==='approved')throw new Error(controller.state?.message||'The original Shop approval was not verified.');
 if(session&&new URL(location.href).searchParams.has('result'))history.replaceState({},'',location.pathname+location.hash);
 return session;
}
export function clearWalletSession(){discardPrivateSession();clearStandardConnection();try{sessionStorage.removeItem('ynx_shop_wallet_kind')}catch{}}
function setStandardConnection(connection, wallet) {
  const account=connection.current.selectedAccount;
  if (standard?.account?.toLowerCase() !== account.toLowerCase()) discardPrivateSession();
  removeProviderListeners?.();
  activeConnection?.disconnect();
  activeConnection = connection;
  standard = Object.freeze({ account, chainId: YNX_CHAIN.chainId, wallet, transport: 'eip-1193' });
  removeProviderListeners=connection.subscribe(({event})=>{
    if(activeConnection!==connection)return;
    const current=connection.current;
    if(!current || current.selectedChain!==YNX_CHAIN.chainId){clearStandardConnection();return;}
    if(event==='accountsChanged'){
      if(standard?.account!==current.selectedAccount)discardPrivateSession();
      standard=Object.freeze({...standard,account:current.selectedAccount});
      emitStandardConnection();
    }
  });
  emitStandardConnection();
}

function clearStandardConnection() {
  discardPrivateSession();
  cancelWalletConnection();
  removeProviderListeners?.();
  removeProviderListeners = null;
  const previous=activeConnection;
  activeConnection = null;
  previous?.disconnect();
  standard = null;
  emitStandardConnection();
}

function emitStandardConnection() {
  for (const listener of standardListeners) listener(standard);
}

async function ensureYNXChain(provider, assertCurrent) {
  let chainId = await provider.request({ method: 'eth_chainId' });
  assertCurrent();
  if (String(chainId).toLowerCase() === YNX_CHAIN.chainId) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: YNX_CHAIN.chainId }] });
  } catch (error) {
    assertCurrent();
    if (error?.code !== 4902 && error?.data?.originalError?.code !== 4902) throw walletError('CHAIN_SWITCH_REJECTED', 'Switching to YNX Testnet was rejected or failed.', error);
    await provider.request({ method: 'wallet_addEthereumChain', params: [YNX_CHAIN] });
    assertCurrent();
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: YNX_CHAIN.chainId }] });
  }
  chainId = await provider.request({ method: 'eth_chainId' });
  assertCurrent();
  if (String(chainId).toLowerCase() !== YNX_CHAIN.chainId) throw walletError('WRONG_CHAIN', 'The wallet is not connected to YNX Testnet.');
}

function walletError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}
