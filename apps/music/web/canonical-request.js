// Consumes A's real browser ProductSession client; it neither issues identity nor
// installs a registry. The original business controller first reads /api/me.
export const MUSIC_ORIGIN='https://music.ynxweb4.com';
export const MUSIC_SCOPES=Object.freeze(['music.creator','music.library','music.playback','music.profile']);
const id='[A-Za-z0-9_-]{1,160}';
export function musicScope(path,method){
 const routes=[['GET','/api/me','music.profile'],['PUT','/api/profile','music.profile'],['POST','/api/cases','music.profile'],['GET','/api/catalog','music.library'],['PUT','/api/library','music.library'],['POST','/api/playlists','music.library'],['GET','/api/playlists','music.library'],['GET',`/api/playlists/${id}`,'music.library'],['PUT',`/api/playlists/${id}`,'music.library'],['GET',`/api/tracks/${id}`,'music.library'],['GET',`/api/tracks/${id}/artwork`,'music.library'],['GET',`/api/tracks/${id}/media`,'music.playback'],['POST',`/api/playback/${id}/position`,'music.playback'],['POST','/api/creator/onboarding','music.creator'],['POST','/api/creator/tracks','music.creator'],['POST',`/api/creator/tracks/${id}/release`,'music.creator'],['POST','/api/creator/allocations','music.creator'],['POST','/api/creator/settlements','music.creator'],['GET','/api/ai/status','music.library'],['POST','/api/ai/proposals','music.library'],['GET',`/api/ai/proposals/${id}`,'music.library'],['GET',`/api/ai/proposals/${id}/stream`,'music.library'],['POST',`/api/ai/proposals/${id}/review`,'music.library']];
 const match=routes.find(([verb,pattern])=>verb===method&&new RegExp('^'+pattern+'$').test(path));if(!match)throw Error('Unsupported Music business route');return match[2];
}
export function createCanonicalMusicRequest({browser,fetch:send=globalThis.fetch.bind(globalThis),isCurrent=()=>true,origin=globalThis.location?.origin}){
 if(origin!==MUSIC_ORIGIN||browser?.capabilities?.productId!=='music'||browser.capabilities.origin!==MUSIC_ORIGIN||JSON.stringify(browser.capabilities.scopes)!==JSON.stringify(MUSIC_SCOPES)||typeof browser?.createBusinessProof!=='function'||typeof browser?.createBusinessProofCommitment!=='function')throw Error('Canonical Music Web client unavailable');
 const check=signal=>{if(!isCurrent())throw new DOMException('Music account changed','AbortError');signal?.throwIfAborted()};
 return async(relative,options={})=>{
  const method=(options.method||'GET').toUpperCase();
  if(typeof relative!=='string'||!relative.startsWith('api/')||relative.includes('..')||relative.includes('//')||/[\\#\r\n%]/.test(relative.split('?')[0]))throw Error('Invalid Music route');
  const url=new URL(relative,MUSIC_ORIGIN+'/'),scope=musicScope(url.pathname,method);
  if(url.search&&!(url.pathname==='/api/catalog'&&[...url.searchParams].every(([k,v])=>k==='q'&&v.length<=200&&!/[\r\n\0]/.test(v))&&url.searchParams.getAll('q').length<=1))throw Error('Invalid Music query');
  check(options.signal);const headers=new Headers(options.headers);
  for(const key of [...headers.keys()])if(key==='authorization'||key.startsWith('x-ynx-'))headers.delete(key);
  if(method==='GET'&&options.body!=null)throw Error('GET Music body is forbidden');
  // Serialize FormData exactly once: retain its FINAL generated boundary in
  // Content-Type and send these same immutable bytes after signing.
  if(options.body instanceof FormData){let total=0;for(const [name,value] of options.body){const size=typeof value==='string'?new TextEncoder().encode(value).length:value.size;total+=size;if(typeof value!=='string'&&size>(name==='artwork'?12.5:50)*1024*1024)throw Error('Music file exceeds original route limit');if(total>63.5*1024*1024)throw Error('Music request exceeds original route limit')}}
  if(typeof options.body==='string'&&new TextEncoder().encode(options.body).length>1024*1024)throw Error('Music JSON exceeds original route limit');
  if(options.body instanceof FormData)headers.delete('content-type');
  const wire=new Request(url,{method,headers,body:options.body,signal:options.signal});
  const maximum=url.pathname==='/api/creator/tracks'?50*1024*1024+50*1024*1024/4+1024*1024:1024*1024;
  const chunks=[];let length=0;const reader=wire.body?.getReader();
  if(reader)try{while(true){check(options.signal);const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>maximum)throw Error('Music request exceeds original route limit');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}check(options.signal);
  const proof=bytes.length<=16*1024*1024?await browser.createBusinessProof({method,path:url.pathname,body:bytes,requiredScopes:[scope]}):await browser.createBusinessProofCommitment({method,path:url.pathname,bodyDigest:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join(''),bodyBytes:bytes.length,requiredScopes:[scope]});
  check(options.signal);if(typeof proof?.introspection?.proofHeader!=='string'||!proof.introspection.proofHeader||typeof proof.proofHeader!=='string'||!proof.proofHeader)throw Error('Canonical business proof unavailable');
  const finalHeaders=new Headers(wire.headers);finalHeaders.set('X-YNX-Product-Session-Proof-V2',proof.introspection.proofHeader);finalHeaders.set('X-YNX-Music-Business-Proof-V2',proof.proofHeader);
  const response=await send(url.href,{...options,method,headers:finalHeaders,body:method==='GET'?undefined:bytes,credentials:'omit',redirect:'error'});check(options.signal);
  if(response.redirected||response.url&&response.url!==url.href)throw Error('Unexpected Music response location');return response;
 };
}
