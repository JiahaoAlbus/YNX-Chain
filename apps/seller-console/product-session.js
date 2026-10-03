import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter,evmAddressFromYNX} from '@ynx-chain/wallet-auth';
import registry from './product-session-registry.json' with {type:'json'};
import {ContextChangedError} from './request-context.js';

// Consumer orchestration only. Authority, device storage, approval validation,
// recovery, signing and durable revocation are provided by the approved SDK.
export function createPrivateSessionController({productId,scopes,purpose,endpoint,environment=globalThis,createClient=createBrowserProductSessionClient}) {
 let resource=null,initializing=null,revision=0,session=null,signoutPending=false;
 const listeners=new Set();
 const publish=()=>{for(const listener of listeners)listener(session)};
 const capture=()=>{const at=revision;return()=>{if(at!==revision)throw new ContextChangedError()}};
 async function client(){
  if(resource)return resource;
  if(!initializing)initializing=(async()=>{
   const url=endpoint();
   if(!url)throw new Error('Product Session Gateway is unavailable.');
   const gateway=new ProductSessionGatewayFetchAdapter({endpoint:url,fetch:environment.fetch.bind(environment),walletInstalled:()=>false,schemeRegistered:()=>false,timeoutMs:15000});
   resource=await createClient({registry,productId,scopes:[...scopes],purpose,gateway,environment});
   return resource;
  })().finally(()=>{initializing=null});
  return initializing;
 }
 function adopt(state,expectedAccount){
  if(state.status!=='connected'||!state.session){session=null;publish();return null}
  if(expectedAccount&&evmAddressFromYNX(state.session.account).toLowerCase()!==expectedAccount.toLowerCase())throw new Error('Approved private account differs from the connected Wallet.');
  session=Object.freeze({...state.session});publish();return session;
 }
 const current=()=>{
  if(session&&(signoutPending||resource?.client.current.status!=='connected'||Date.parse(session.expiresAt)<=Date.now())){session=null;publish()}
  return session;
 };
 async function clear(){
  revision++;signoutPending=true;session=null;publish();
  // Retain the SDK resource and protected revocation intent for Retry. A late
  // initialization must also receive sign-out before it can grant authority.
  const target=resource??(initializing?await initializing:null);
  if(!target){signoutPending=false;return null}
  const state=await target.client.disconnect();
  signoutPending=!['disconnected','expired'].includes(state.status);
  return state;
 }
 return Object.freeze({current,onChange(listener){listeners.add(listener);return()=>listeners.delete(listener)},clear,
  async begin(){const assert=capture();const target=await client();assert();if(signoutPending){const state=await clear();throw new Error(state?.message||'Retry the pending sign-out before a new approval.')}const state=await target.client.beginExplicit();assert();session=null;publish();return state},
  async recover(url,expectedAccount){const assert=capture();const target=await client();assert();if(signoutPending)throw new Error('Sign-out confirmation is pending.');const state=new URL(url).searchParams.has('result')?await target.client.handleReturn(url):await target.client.restore();assert();try{return adopt(state,expectedAccount)}catch(error){await clear();throw error}},
  async authorize(url,options={},requiredScopes=scopes){
   const assert=capture(),subject=current();if(!subject)throw new Error('An approved private Product Session is required.');
   const target=await client();assert();const resolved=new URL(url,environment.location.href);
   if(resolved.origin!==environment.location.origin)throw new Error('Commerce business requests must stay on the registered product origin.');
   const method=(options.method||'GET').toUpperCase(),body=options.body??'';
   if(typeof body!=='string'&&!(body instanceof Uint8Array))throw new Error('Business proof requires final HTTP body bytes.');
   if(!Array.isArray(requiredScopes)||!requiredScopes.length||new Set(requiredScopes).size!==requiredScopes.length||requiredScopes.some(scope=>!scopes.includes(scope)))throw new Error('The route requires an unapproved private capability.');
   const proof=await target.createBusinessProof({method,path:resolved.pathname,body,requiredScopes:[...requiredScopes]});
   assert();if(current()!==subject)throw new ContextChangedError();
   const headers=new Headers(options.headers);headers.delete('Authorization');
   headers.set('X-YNX-Product-Session-Proof-V2',proof.introspection.proofHeader);
   headers.set('X-YNX-Product-Session-Action-Proof-V2',proof.proofHeader);
   return {...options,method,headers,...(method==='GET'?{body:undefined}:{body:proof.body})};
  },get state(){return resource?.client.current??null},get signoutPending(){return signoutPending}
 });
}
