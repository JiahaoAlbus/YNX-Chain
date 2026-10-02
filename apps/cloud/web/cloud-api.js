// File operations use fresh device-bound proofs. A standard account is never a credential.
export function createCloudAPI({session,fetch=globalThis.fetch,base='/api/v1',randomUUID=()=>crypto.randomUUID(),failed=()=>{}}){
 const writes=new Map();
 return async function api(path,options={}){
  const {token,...request}=options;
  if(token)throw Object.assign(new Error('This operation needs a separate available permission.'),{code:'V2_ROUTE_NOT_ENABLED'});
  const method=(request.method||'GET').toUpperCase(),auth=await session.authorization(path,method);
  const headers={...(request.headers||{})};for(const name of Object.keys(headers))if(['authorization','x-ynx-product-session-proof-v2','idempotency-key'].includes(name.toLowerCase()))delete headers[name];Object.assign(headers,auth.headers);
  if(request.body&&!(request.body instanceof FormData))headers['Content-Type']='application/json';
  const digest=method==='GET'?'':Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(request.body||''))),x=>x.toString(16).padStart(2,'0')).join('');const key=JSON.stringify([auth.account,method,path,digest]);if(!session.isCurrent(auth.generation))throw Object.assign(new Error('The selected Cloud account changed.'),{code:'PRIVATE_CONTEXT_CHANGED'});
  if(method!=='GET'){
   if(!writes.has(key)){if(writes.size>=16)throw Object.assign(new Error('Resolve earlier unconfirmed changes before retrying.'),{code:'CLOUD_WRITE_LIMIT'});writes.set(key,randomUUID());}
   headers['Idempotency-Key']=writes.get(key);
  }
  let response,body;
  try{response=await fetch(`${base}${path}`,{...request,method,headers,credentials:'omit',cache:'no-store'});const type=response.headers.get('content-type')||'';body=type.includes('json')?await response.json():await response.blob()}catch(error){throw Object.assign(new Error('Connection interrupted. Retry the same change to check its result.'),{code:method==='GET'?'NETWORK_UNAVAILABLE':'CLOUD_WRITE_UNCONFIRMED',cause:error})}
  if(!session.isCurrent(auth.generation))throw Object.assign(new Error('The selected Cloud account changed.'),{code:'PRIVATE_CONTEXT_CHANGED'});
  if(!response.ok){const code=body?.code||body?.error?.code||'CLOUD_REQUEST_FAILED';if(response.status===401)session.invalidate(code);failed(code,response.status);throw Object.assign(new Error('Cloud could not complete this action. Check your connection or approve access again.'),{code,status:response.status})}
  if(method!=='GET')writes.delete(key);
  return body;
 };
}
