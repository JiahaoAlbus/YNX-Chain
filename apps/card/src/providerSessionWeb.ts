import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter,type BrowserProductSessionAdapter} from '@ynx-chain/wallet-auth-card-provider-v2';
import registry from '../vendor/product-session-registry-b754ffc42.json';
import {cardCallbackKind} from './providerCallback';
import {discoverWalletProviders,isSharedWalletProvider} from './standardWalletSdk';

const ATTEMPT='ynx.card.provider-session.v2.attempted';
const MODE='ynx.card.provider-session.v2.scope-mode';
export const CARD_WEB_PROVIDER_SCOPES=Object.freeze(['account:read','card:application:write','card:controls:write'] as const);
let adapter:BrowserProductSessionAdapter|null=null;
let initializing:Promise<BrowserProductSessionAdapter>|null=null;
let generation=0;
let financePermissionRequested=false;
// The extension's review deadline is 120 seconds. This watchdog is only a
// five-second bridge margin, never an approval or cancellation signal.
const PRIVATE_TRANSPORT_TIMEOUT_MS=125_000;
function privateError(code:string){return Object.assign(Error(code),{code})}
async function boundedPrivateRequest(provider:{request:(input:{method:string;params:readonly unknown[]})=>Promise<unknown>},url:string){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([provider.request({method:'ynx_requestProductSessionV2',params:[url]}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(privateError('CARD_WEB_PRIVATE_TRANSPORT_TIMEOUT')),PRIVATE_TRANSPORT_TIMEOUT_MS)})])}
  finally{if(timer)clearTimeout(timer)}
}
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
  if(epoch!==generation)throw privateError('CARD_WEB_PRIVATE_CONTEXT_CHANGED');
  if(callback&&['connected','disconnected'].includes(String(result.status)))w.history.replaceState(null,'','/');
  return result;
}
export async function beginCardWebSession(financeSharing=false){
  if(initializing)await initializing;
  if(financePermissionRequested!==financeSharing){await closeCardWebSession();financePermissionRequested=financeSharing;}
  const w=browser(),mode=financeSharing?'finance':'base';
  w.localStorage.setItem(MODE,mode);
  if(w.localStorage.getItem(MODE)!==mode)throw Error('CARD_SESSION_MODE_STORAGE_FAILED');
  const epoch=++generation,selected=await cardWebSession();try{w.localStorage.setItem(ATTEMPT,'yes')}catch{}
  const result=await selected.client.beginExplicit();if(epoch!==generation)throw privateError('CARD_WEB_PRIVATE_CONTEXT_CHANGED');
  const route=result.route as {status?:string;url?:string}|undefined;
  if(result.status==='connecting'&&route?.status==='ready'&&typeof route.url==='string'){
    let url:URL;try{url=new URL(route.url)}catch{throw privateError('CARD_WALLET_ROUTE_INVALID')}
    if(url.protocol!=='ynxwallet:'||url.hostname!=='authorize'||url.username||url.password||url.hash||url.searchParams.size!==1||url.searchParams.getAll('request').length!==1||!url.searchParams.get('request'))throw privateError('CARD_WALLET_ROUTE_INVALID');
    const discovery=await discoverWalletProviders(globalThis,1600);if(epoch!==generation)throw privateError('CARD_WEB_PRIVATE_CONTEXT_CHANGED');
    const provider=discovery.ynx?.provider;
    if(!isSharedWalletProvider(provider,'ynx-wallet'))throw privateError('CARD_WEB_PRIVATE_TRANSPORT_UNAVAILABLE');
    let response:unknown;try{response=await boundedPrivateRequest(provider as {request:(input:{method:string;params:readonly unknown[]})=>Promise<unknown>},route.url)}catch(error){if(epoch===generation)generation++;throw error}
    if(epoch!==generation)throw privateError('CARD_WEB_PRIVATE_CONTEXT_CHANGED');
    if(!response||typeof response!=='object'||Array.isArray(response))throw privateError('CARD_WEB_PRIVATE_RETURN_INVALID');
    const returned=response as Record<string,unknown>;
    if(returned.version!==2||typeof returned.returnUrl!=='string'||returned.returnUrl.length<1||returned.returnUrl.length>16384)throw privateError('CARD_WEB_PRIVATE_RETURN_INVALID');
    const settled=await selected.client.handleReturn(returned.returnUrl);
    if(epoch!==generation)throw privateError('CARD_WEB_PRIVATE_CONTEXT_CHANGED');
    return settled;
  }
  return result;
}
export async function retryCardWebSession(){await cardWebSession();return beginCardWebSession(financePermissionRequested)}
export async function disconnectCardWebSession(){generation++;const selected=await cardWebSession();return selected.client.disconnect()}
export async function cardWebProof(scopes:readonly string[]){const selected=await cardWebSession();return selected.createIntrospectionProof(scopes)}
export async function closeCardWebSession(){
  generation++;
  const selected=adapter;if(!selected)return;
  // The SDK serializes disconnect behind an in-flight handleReturn and records
  // revocation before Gateway I/O. Never open a different scope namespace while
  // that old completion or revocation can still write protected session state.
  const result=await selected.client.disconnect();
  if(result.status!=='disconnected')throw privateError('CARD_WEB_PRIVATE_REVOCATION_PENDING');
  selected.close();if(adapter===selected)adapter=null;
}
