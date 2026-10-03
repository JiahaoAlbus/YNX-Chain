import {createNativeProductSessionClient,ProductSessionGatewayFetchAdapter,productPlatformBinding} from '../../music/web/vendor/wallet-auth-5c5e8a23/artifacts/product-session-native.mjs';
import {creatorScope} from '../product-session.js';
import {serializeMediaBody,mediaBusinessAuthorization} from '../business-wire.js';

const definitions=Object.freeze({
 'creator-studio':{origin:'https://creator.ynxweb4.com',apiBase:'https://creator.ynxweb4.com/video/api',account:'/v1/account',scopes:['creator:account','creator:publish','creator:revenue'],scope:creatorScope},
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
  ({body,headers}=await serializeMediaBody(path,method,options.body,options.headers,options.signal));
  check(c,options.signal);
  let proof;
  proof=await mediaBusinessAuthorization(client,path,method,body,scope);
  check(c,options.signal);
  const response=await send(definition.apiBase+path,{...options,method,headers:{...headers,...proof},body:method==='GET'?undefined:body,credentials:'omit',redirect:'error'});
  check(c,options.signal);
  if(response.redirected||response.url&&response.url!==definition.apiBase+path)throw Error('Unexpected native Media response location');
  return response;
 }
 // The trusted OS sender hashes its FINAL immutable wire bytes, including any
 // multipart boundary. The backend separately hashes the delivered stream. A
 // commitment is never proof that those bytes reached the original service.
 async function prepareRequest({method,path,bodyDigest,bodyBytes}){
  const c=capture();if(verified!==c.state)throw Error('Original Media account readback required');
  if(typeof path!=='string'||/[?#%\\\r\n]/.test(path)||path.includes('..')||path.includes('//'))throw Error('Invalid native Media route');
  method=String(method).toUpperCase();const scope=definition.scope(path,method),maximum=path==='/v1/uploads'?512*1024*1024:/^\/v1\/videos\/[A-Za-z0-9_-]+\/thumbnail$/.test(path)?5*1024*1024+65536:/^\/v1\/videos\/[A-Za-z0-9_-]+\/captions$/.test(path)?1024*1024+65536:1024*1024;
  if(!/^[0-9a-f]{64}$/.test(bodyDigest)||!Number.isSafeInteger(bodyBytes)||bodyBytes<0||bodyBytes>maximum)throw Error('Invalid final native wire commitment');
  check(c);const proof=await client.createBusinessProofCommitment({method,path,bodyDigest,bodyBytes,requiredScopes:[scope]});check(c);
  if(!proof?.introspection?.proofHeader||!proof.proofHeader)throw Error('Native business proof unavailable');
  return Object.freeze({identityHeader:proof.introspection.proofHeader,actionHeader:proof.proofHeader,bodyDigest,bodyBytes,account:c.state.session.account,sessionBinding:c.state.session.sessionBinding});
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
  const c=capture(),reply=await readJSON(definition.account,{},c),account=reply?.account;
  check(c);if(account!==state.session.account||reply.schemaVersion!==1)throw Error('Media returned a different account');
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
  prepareRequest,
  disconnect(){invalidate();return client.disconnect()},
  close(){closed=true;invalidate();client.close()},
 });
}
