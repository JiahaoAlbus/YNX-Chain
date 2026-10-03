// Product-owned raw wire consumer. Shared SDK/registry admission remains A's job.
function wireHeaders(headers){const result=Object.fromEntries(headers);if(result['idempotency-key']){result['Idempotency-Key']=result['idempotency-key'];delete result['idempotency-key']}return result}
const RAW_LIMIT=16*1024*1024,STREAM_LIMIT=512*1024*1024;
export async function serializeMediaBody(path,method,body,headers={},signal){
 const clean=new Headers(headers);for(const name of [...clean.keys()])if(name==='authorization'||name.startsWith('x-ynx-'))clean.delete(name);
 signal?.throwIfAborted();
 if(['GET','HEAD'].includes(method)){if(body!=null)throw Error('Read requests must have an empty body');return {body:undefined,headers:wireHeaders(clean)}}
 if(body==null)return {body:undefined,headers:wireHeaders(clean)};
 let maximum=1024*1024;
 if(path==='/v1/uploads')maximum=STREAM_LIMIT;
 else if(/^\/v1\/videos\/[A-Za-z0-9_-]+\/thumbnail$/.test(path))maximum=5*1024*1024+64*1024;
 else if(/^\/v1\/videos\/[A-Za-z0-9_-]+\/captions$/.test(path))maximum=1024*1024+64*1024;
 if(typeof body==='string'){if(new TextEncoder().encode(body).length>maximum)throw Error('Media request exceeds route limit');return {body,headers:wireHeaders(clean)}}
 if(body instanceof Uint8Array){if(body.length>maximum)throw Error('Media request exceeds route limit');return {body:body.slice(),headers:wireHeaders(clean)}}
 if(!(body instanceof FormData))throw Error('Unsupported Media request body');
 let size=0;for(const [name,value] of body){size+=typeof value==='string'?new TextEncoder().encode(value).length:value.size;if(size>maximum||typeof value!=='string'&&((name==='thumbnail'&&value.size>5*1024*1024)||(name==='captions'&&value.size>1024*1024)))throw Error('Media upload exceeds route limit')}
 clean.delete('content-type');
 const wire=new Request('https://media.invalid/',{method,body,headers:clean,signal}),reader=wire.body.getReader(),chunks=[];let total=0;
 try{while(true){signal?.throwIfAborted();const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>maximum)throw Error('Media upload exceeds final wire limit');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 signal?.throwIfAborted();const bytes=new Uint8Array(total);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length}
 return {body:bytes,headers:wireHeaders(wire.headers)};
}
export async function mediaBusinessAuthorization(browser,path,method,body,scope){
 if(typeof browser?.createBusinessProof!=='function'||typeof browser?.createBusinessProofCommitment!=='function')throw Error('Media requires the admitted business-proof SDK. Sign-in is preserved; retry after the service release.');
 if(!['GET','POST','PUT','PATCH','DELETE'].includes(method))throw Error('Unsupported private Media method');
 if(!path.startsWith('/v1/')||/[?#%\\\r\n]/.test(path)||path.includes('..')||path.includes('//'))throw Error('Invalid private Media route');
 const raw=body??'',bytes=typeof raw==='string'?new TextEncoder().encode(raw):raw;
 if(!(bytes instanceof Uint8Array)||bytes.length>STREAM_LIMIT)throw Error('Invalid Media wire bytes');
 if(method==='GET'&&bytes.length)throw Error('Read requests must have an empty body');
 const proof=bytes.length<=RAW_LIMIT?await browser.createBusinessProof({method,path,body:raw,requiredScopes:[scope]}):await browser.createBusinessProofCommitment({method,path,bodyDigest:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join(''),bodyBytes:bytes.length,requiredScopes:[scope]});
 if(typeof proof?.proofHeader!=='string'||!proof.proofHeader||typeof proof?.introspection?.proofHeader!=='string'||!proof.introspection.proofHeader)throw Error('Media business proof unavailable');
 return {'X-YNX-Product-Session-Proof-V2':proof.introspection.proofHeader,'X-YNX-Product-Session-Action-Proof-V2':proof.proofHeader};
}
