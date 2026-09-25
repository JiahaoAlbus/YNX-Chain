import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter,type BrowserProductSessionAdapter} from '@ynx-chain/wallet-auth-card-provider-v2';
import registry from '../vendor/product-session-registry-b754ffc42.json';
import {cardCallbackKind} from './providerCallback';

const ATTEMPT='ynx.card.provider-session.v2.attempted';
const MODE='ynx.card.provider-session.v2.scope-mode';
export const CARD_WEB_PROVIDER_SCOPES=Object.freeze(['account:read','card:application:write','card:controls:write'] as const);
let adapter:BrowserProductSessionAdapter|null=null;
let initializing:Promise<BrowserProductSessionAdapter>|null=null;
let generation=0;
let financePermissionRequested=false;
function browser(){if(typeof window==='undefined'||window.location.origin!=='https://card.ynxweb4.com'||window.isSecureContext!==true)throw Error('CARD_WEB_ORIGIN_UNAVAILABLE');return window}
export async function cardWebSession(){
  const w=browser();if(adapter)return adapter;
  // This selects a stored SDK namespace only. The SDK still verifies every
  // session and grant; a local preference cannot authorize the extra scope.
  const savedMode=w.localStorage.getItem(MODE);
  if(savedMode!==null&&savedMode!=='base'&&savedMode!=='finance')throw Error('CARD_SESSION_MODE_INVALID');
  financePermissionRequested=savedMode==='finance';
  if(!initializing)initializing=createBrowserProductSessionClient({registry,productId:'card',scopes:financePermissionRequested?[...CARD_WEB_PROVIDER_SCOPES,'card:finance:share']:CARD_WEB_PROVIDER_SCOPES,purpose:financePermissionRequested?'Allow Card to manage your separately selected read-only sharing with YNX Finance. This grants no payment or trading authority.':'Read Card TEST records and request explicit application or freeze controls. This does not create a card or transfer funds.',gateway:new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:globalThis.fetch.bind(globalThis),walletInstalled:async()=>false,schemeRegistered:async()=>false,timeoutMs:10_000})}).then(value=>adapter=value).finally(()=>{initializing=null});
  return initializing;
}
export function cardWebSessionCurrent(){return adapter?.client.current??null}
export async function restoreCardWebSession(){
  const w=browser();const kind=cardCallbackKind(w.location.href);
  if(kind==='invalid')throw Error('CARD_WALLET_CALLBACK_INVALID');
  const callback=kind==='session';
  let attempted=false;try{attempted=w.localStorage.getItem(ATTEMPT)==='yes'}catch{}
  if(!attempted&&!callback)return null;
  const epoch=++generation,selected=await cardWebSession();const result=callback?await selected.client.handleReturn(w.location.href):await selected.client.restore(w.navigator.onLine);
  if(epoch!==generation)return selected.client.current;
  if(callback&&['connected','disconnected'].includes(String(result.status)))w.history.replaceState(null,'','/');
  return result;
}
export async function beginCardWebSession(financeSharing=false){
  if(initializing)await initializing;
  if(financePermissionRequested!==financeSharing){closeCardWebSession();financePermissionRequested=financeSharing;}
  const w=browser(),mode=financeSharing?'finance':'base';
  w.localStorage.setItem(MODE,mode);
  if(w.localStorage.getItem(MODE)!==mode)throw Error('CARD_SESSION_MODE_STORAGE_FAILED');
  const epoch=++generation,selected=await cardWebSession();try{w.localStorage.setItem(ATTEMPT,'yes')}catch{}
  const result=await selected.client.beginExplicit();if(epoch!==generation)return selected.client.current;
  const route=result.route as {status?:string;url?:string}|undefined;
  if(result.status==='connecting'&&route?.status==='ready'&&typeof route.url==='string'){
    const url=new URL(route.url);if(url.protocol!=='ynxwallet:'||url.hostname!=='authorize'||url.username||url.password||url.hash)throw Error('CARD_WALLET_ROUTE_INVALID');
    // The accepted Web launcher forbids custom schemes, including explicit
    // Product Session requests. Preserve the pending request and original page;
    // a standard EVM account is not a substitute for this private approval.
    throw Object.assign(Error('CARD_WEB_PRIVATE_TRANSPORT_UNAVAILABLE'),{code:'CARD_WEB_PRIVATE_TRANSPORT_UNAVAILABLE'});
  }
  return result;
}
export async function retryCardWebSession(){const selected=await cardWebSession();return selected.client.retryDetected()}
export async function disconnectCardWebSession(){generation++;const selected=await cardWebSession();return selected.client.disconnect()}
export async function cardWebProof(scopes:readonly string[]){const selected=await cardWebSession();return selected.createIntrospectionProof(scopes)}
export function closeCardWebSession(){generation++;adapter?.close();adapter=null}
