import {createNativeProductSessionClient,ProductSessionGatewayFetchAdapter,productPlatformBinding} from '../../music/web/vendor/wallet-auth-5c5e8a23/artifacts/product-session-native.mjs';
import {videoScope} from '../product-session.js';
import {creatorScope} from '../../creator-studio/product-session.js';
import {musicScope} from '../../music/web/canonical-request.js';
import {serializeMediaBody,mediaBusinessAuthorization} from '../business-wire.js';

const definitions=Object.freeze({
 video:{origin:'https://video.ynxweb4.com',account:'/v1/account',scopes:['video:account','video:library','video:playback'],scope:videoScope},
 'creator-studio':{origin:'https://creator.ynxweb4.com',account:'/v1/account',scopes:['creator:account','creator:publish','creator:revenue'],scope:creatorScope},
 music:{origin:'https://music.ynxweb4.com',account:'/api/me',scopes:['music.creator','music.library','music.playback','music.profile'],scope:musicScope},
});
// The platform owner supplies the real protected runtime and Fetch bridge.
// This consumer never enrolls an account, exports a key or migrates old storage.
export async function createNativeMediaSession({productId,platform,registry,runtime,fetch:send,walletInstalled,schemeRegistered,clock=()=>new Date()}){
 const definition=definitions[productId];
 if(!definition||!['android','ios','macos'].includes(platform)||typeof send!=='function'||typeof walletInstalled!=='function'||typeof schemeRegistered!=='function')throw Error('Registered Media native runtime and transport required');
 const binding=productPlatformBinding(registry,productId,platform);
 const scopes=[...definition.scopes];if(scopes.some(scope=>!binding.scopes.includes(scope)))throw Error('Media native scopes are not registered');
 const gateway=new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:send,walletInstalled,schemeRegistered,timeoutMs:15000});
 const client=await createNativeProductSessionClient({registry,productId,platform,scopes,purpose:'Access my Media account and original library, playback and creator operations',gateway,runtime,clock});
 let revision=0,verified=null,closed=false;
 const active=state=>state.status==='connected'&&Date.parse(state.session?.expiresAt)>+clock();
 const abort=()=>new DOMException('Media account or native context changed','AbortError');
 function capture(){const state=client.current;if(closed||!active(state))throw abort();return {revision,state,context:JSON.stringify(runtime.readContext())}}
 function check(c,signal){signal?.throwIfAborted();if(closed||!active(c.state)||revision!==c.revision||client.current!==c.state||JSON.stringify(runtime.readContext())!==c.context)throw abort()}
 function invalidate(){revision++;verified=null}
 async function wire(path,options,c){
  const method=(options.method||'GET').toUpperCase();
  if(typeof path!=='string'||/[?#%\\\r\n]/.test(path)||path.includes('..')||path.includes('//'))throw Error('Invalid native Media route');
  const scope=definition.scope(path,method);check(c,options.signal);
  let body,headers;
  if(productId==='music'){
   const clean=new Headers(options.headers);for(const k of [...clean.keys()])if(k==='authorization'||k.startsWith('x-ynx-'))clean.delete(k);
   if(method==='GET'&&options.body!=null)throw Error('Read body forbidden');
   if(options.body instanceof FormData)clean.delete('content-type');
   const maximum=path==='/api/creator/tracks'?64*1024*1024:1024*1024;
   if(options.body instanceof FormData){let size=0;for(const [name,value] of options.body){const length=typeof value==='string'?new TextEncoder().encode(value).length:value.size;size+=length;if(size>maximum||typeof value!=='string'&&length>(name==='artwork'?12.5:50)*1024*1024)throw Error('Music file exceeds original route limit')}}
   const request=new Request(definition.origin+path,{method,headers:clean,body:options.body}),reader=request.body?.getReader(),chunks=[];let total=0;
   try{if(reader)while(true){check(c,options.signal);const {value,done}=await reader.read();check(c,options.signal);if(done)break;total+=value.length;if(total>maximum)throw Error('Music request exceeds route limit');chunks.push(value)}}finally{if(reader){await reader.cancel().catch(()=>{});reader.releaseLock()}}
   body=new Uint8Array(total);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length}headers=Object.fromEntries(request.headers);
  }else({body,headers}=await serializeMediaBody(path,method,options.body,options.headers,options.signal));
  check(c,options.signal);
  let proof;
  if(productId==='music'){
   const signed=body.length<=16*1024*1024?await client.createBusinessProof({method,path,body,requiredScopes:[scope]}):await client.createBusinessProofCommitment({method,path,bodyDigest:[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(x=>x.toString(16).padStart(2,'0')).join(''),bodyBytes:body.length,requiredScopes:[scope]});
   if(!signed?.introspection?.proofHeader||!signed.proofHeader)throw Error('Music proof unavailable');
   proof={'X-YNX-Product-Session-Proof-V2':signed.introspection.proofHeader,'X-YNX-Music-Business-Proof-V2':signed.proofHeader};
  }else proof=await mediaBusinessAuthorization(client,path,method,body,scope);
  check(c,options.signal);
  const response=await send(definition.origin+path,{...options,method,headers:{...headers,...proof},body:method==='GET'?undefined:body,credentials:'omit',redirect:'error'});
  check(c,options.signal);
  if(response.redirected||response.url&&response.url!==definition.origin+path)throw Error('Unexpected native Media response location');
  return response;
 }
 async function readJSONBody(path,options,c){
  const response=await wire(path,options,c);if(!response.ok)throw Error('Media business read failed ('+response.status+')');
  const reader=response.body?.getReader(),chunks=[];let total=0;
  try{if(reader)while(true){check(c,options.signal);const {value,done}=await reader.read();check(c,options.signal);if(done)break;total+=value.length;if(total>2*1024*1024)throw Error('Media JSON response exceeds limit');chunks.push(value)}}finally{if(reader){await reader.cancel().catch(()=>{});reader.releaseLock()}}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}check(c,options.signal);
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }
 async function readJSON(path,options,c){
  const controller=new AbortController(),external=options.signal;
  const relay=()=>controller.abort(external.reason||abort());external?.addEventListener('abort',relay,{once:true});if(external?.aborted)relay();
  let timer;const work=readJSONBody(path,{...options,signal:controller.signal},c);
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort(new DOMException('Media request timed out','TimeoutError'));reject(controller.signal.reason)},30000)})])}
  finally{clearTimeout(timer);external?.removeEventListener('abort',relay)}
 }
 async function accept(state,attempt){
  if(attempt!==revision||closed)throw abort();
  if(state.status!=='connected')return state;
  const c=capture(),reply=await readJSON(definition.account,{},c),account=productId==='music'?reply?.profile?.account:reply?.account;
  check(c);if(account!==state.session.account||productId!=='music'&&reply.schemaVersion!==1)throw Error('Media returned a different account');
  verified=state;return state;
 }
 async function operation(action){invalidate();const attempt=revision;return accept(await action(),attempt)}
 return Object.freeze({binding:client.binding,capabilities:client.capabilities,
  get current(){const state=client.current;return Object.freeze({state,businessVerified:!closed&&active(state)&&verified===state})},
  async connect(){invalidate();const attempt=revision,result=await client.connect();if(attempt!==revision||closed)throw abort();return result},
  restore:(online=true)=>operation(()=>client.restore(online)),
  resumeWallet:()=>{invalidate();return client.resumeWallet()},
  handleReturn:url=>operation(()=>client.handleReturn(url)),
  async json(path,options={}){const c=capture();if(verified!==c.state)throw Error('Original Media account readback required');return readJSON(path,options,c)},
  disconnect(){invalidate();return client.disconnect()},
  close(){closed=true;invalidate();client.close()},
 });
}
