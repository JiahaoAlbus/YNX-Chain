// Product orchestration only: request, storage, callbacks and proofs belong to
// the unchanged Wallet SDK. No account permission, native signing or order POST.
export const PRIVATE_READ_SCOPE='exchange:read';
const ORIGIN='https://exchange.ynxweb4.com',MAX_BODY=1024*1024;
const accountPattern=/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/;
const failure=code=>Object.assign(new Error(code),{code});
export function validateAccountSnapshot(value,account){
  if(!accountPattern.test(account)||!value||typeof value!=='object'||Array.isArray(value))throw failure('INVALID_ACCOUNT_RESPONSE');
  for(const key of ['balances','ledger','depositIntents','orders','conditionalOrders','ocoGroups','twapOrders','scaleOrders','trades','fees','deposits','withdrawals','support','ai','audit']){
    if(!Array.isArray(value[key]))throw failure('INVALID_ACCOUNT_RESPONSE');
    for(const row of value[key]){
      if(!row||typeof row!=='object'||(key==='trades'?row.buyer!==account&&row.seller!==account:row.account!==account))throw failure('ACCOUNT_BINDING_MISMATCH');
    }
  }
  if(value.security?.account!==account)throw failure('ACCOUNT_BINDING_MISMATCH');
  if(value.deadMan?.account&&value.deadMan.account!==account)throw failure('ACCOUNT_BINDING_MISMATCH');
  validateMarginSnapshot(value.margin,account);
  const source=value.sourceMetadata;
  if(source?.classification!=='testnet'||source.authority!=='YNX-owned deterministic order state'||source.version!=='exchange-public-state-v1'||source.coverage!=='account-ledger-orders-trades-fees-audit'||!['live','degraded_single_host'].includes(source.status)||!Number.isFinite(Date.parse(source.asOf))||Math.abs(Date.now()-Date.parse(source.asOf))>120000||source.status==='live'&&(source.stateBackend!=='postgres-cas-multi-instance'||source.multiInstance!==true)||source.status==='degraded_single_host'&&(source.stateBackend!=='file-cas-single-host'||source.multiInstance!==false))throw failure('INVALID_ACCOUNT_SOURCE');
  // Refuse unsafe JSON integers instead of silently rounding a venue balance.
  checkSafeAmounts(value);
  return value;
}

function checkSafeAmounts(value){if(value&&typeof value==='object')for(const [key,n]of Object.entries(value)){if(typeof n==='number'&&!Number.isSafeInteger(n))throw failure('UNSAFE_ACCOUNT_AMOUNT');if(/Micro$/.test(key)&&typeof n!=='number')throw failure('UNSAFE_ACCOUNT_AMOUNT');checkSafeAmounts(n)}}
export function validateMarginSnapshot(value,account){
  if(!value||value.account?.account!==account)throw failure('ACCOUNT_BINDING_MISMATCH');
  for(const key of ['positions','orders','trades','funding','liquidations']){
    if(!Array.isArray(value[key]))throw failure('INVALID_ACCOUNT_RESPONSE');
    for(const row of value[key])if(!row||typeof row!=='object'||(key==='trades'?row.buyer!==account&&row.seller!==account:row.account!==account))throw failure('ACCOUNT_BINDING_MISMATCH');
  }
  checkSafeAmounts(value);return value;
}
export function validateLiabilityProof(value,account){
  if(value?.account!==account||value.balance?.account!==account||value.balance?.asset!=='YNXT')throw failure('ACCOUNT_BINDING_MISMATCH');
  const hash=/^[a-f0-9]{64}$/;
  if(value.version!=='ynx-exchange-liability-v1'||typeof value.verified!=='boolean'||!Array.isArray(value.proof)||!Number.isSafeInteger(value.leafIndex)||!Number.isSafeInteger(value.leafCount)||value.leafIndex<0||value.leafCount<=value.leafIndex||!hash.test(value.leafHash)||!hash.test(value.merkleRoot)||value.proof.some(step=>!hash.test(step?.hash)||!['left','right'].includes(step?.position)))throw failure('INVALID_ACCOUNT_RESPONSE');
  checkSafeAmounts(value);return value;
}
async function readJSONResponse(response){
  if(!response.ok)throw failure([401,403].includes(response.status)?'AUTHORIZATION_REQUIRED':'PRIVATE_API_UNAVAILABLE');
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||'')||Number(response.headers.get('content-length'))>MAX_BODY||!response.body?.getReader)throw failure('INVALID_ACCOUNT_RESPONSE');
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_BODY)throw failure('INVALID_ACCOUNT_RESPONSE');chunks.push(part.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body))}catch{throw failure('INVALID_ACCOUNT_RESPONSE')}
}

// The narrow adapter seam permits offline orchestration fixtures. Production
// passes the exact same-module SDK constructor and authority in the entry file.
export function createPrivateAccountController({createAdapter,fetchImpl,origin=ORIGIN,onState=()=>{}}){
  let adapter,loading,epoch=0,closed=false,guestIntent=false,request,expiry,operation;
  let current=Object.freeze({phase:'guest',account:null,snapshot:null,route:null,code:null});
  const publish=(value)=>{current=Object.freeze({phase:'guest',account:null,snapshot:null,route:null,code:null,...value});onState(current);return current};
  const cancel=()=>{request?.abort();request=null;clearTimeout(expiry)};
  const active=token=>!closed&&token===epoch;
  async function getAdapter(){
    if(closed)throw failure('CLIENT_CLOSED');
    if(!loading)loading=Promise.resolve().then(createAdapter).then(value=>{if(closed){value.close();throw failure('CLIENT_CLOSED')}adapter=value;return value}).catch(error=>{loading=null;throw error});
    return loading;
  }
  function errorState(error){
    const code=/^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code||'')?error.code:'PRIVATE_SERVICE_UNAVAILABLE';
    return {phase:['PROOF_REQUIRED','SESSION_INACTIVE','SESSION_EXPIRED','REPLAY','ACCOUNT_BINDING_MISMATCH','AUTHORIZATION_REQUIRED'].includes(code)?'authorization-required':'degraded',code};
  }
  async function readAccount(value,token){
    const session=value.session;
    if(!session||!accountPattern.test(session.account)||session.productId!=='exchange'||session.origin!==ORIGIN||session.chainId!=='ynx_6423-1'||session.scopes?.length!==1||session.scopes[0]!==PRIVATE_READ_SCOPE)throw failure('ACCOUNT_BINDING_MISMATCH');
    if(Date.parse(session.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(session.expiresAt)))throw failure('SESSION_EXPIRED');
    const authorization=await adapter.createIntrospectionProof([PRIVATE_READ_SCOPE]);
    if(!active(token))return current;
    if(typeof authorization.proofHeader!=='string'||!authorization.proofHeader||authorization.proofHeader.length>16384)throw failure('PROOF_REQUIRED');
    const controller=new AbortController();request=controller;
    const timeout=setTimeout(()=>controller.abort(),10000);
    try{
      if(origin!==ORIGIN)throw failure('ORIGIN_NOT_ALLOWED');
      const response=await fetchImpl(new URL('/api/v1/account',origin).href,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json','X-YNX-Product-Session-Proof-V2':authorization.proofHeader}});
      if(!active(token))return current;
      const value=await readJSONResponse(response);
      const snapshot=validateAccountSnapshot(value,session.account);
      if(!active(token))return current;
      if(Date.parse(session.expiresAt)<=Date.now())throw failure('SESSION_EXPIRED');
      expiry=setTimeout(()=>{if(active(token))publish({phase:'authorization-required',code:'SESSION_EXPIRED'})},Math.min(2147483647,Date.parse(session.expiresAt)-Date.now()));
      return publish({phase:'connected',account:session.account,snapshot,expiresAt:session.expiresAt});
    }finally{clearTimeout(timeout);if(request===controller)request=null}
  }
  async function accept(value,token){
    if(!active(token))return current;
    if(value.status==='connected')return readAccount(value,token);
    if(value.status==='connecting'&&value.automatic===false&&value.installation==='unverified'&&value.route?.status==='ready'){
      // Exact SDK-owned URL. It is never auto-navigated or put in a new tab.
      const route=new URL(value.route.url);
      if(route.protocol!=='ynxwallet:'||route.hostname!=='authorize'||!route.searchParams.get('request'))throw failure('INVALID_WALLET_ROUTE');
      if(!Number.isFinite(Date.parse(value.request?.expiresAt))||Date.parse(value.request.expiresAt)<=Date.now())throw failure('SESSION_EXPIRED');
      expiry=setTimeout(()=>{if(active(token))publish({phase:'authorization-required',code:'SESSION_EXPIRED'})},Math.min(2147483647,Date.parse(value.request.expiresAt)-Date.now()));
      return publish({phase:'approval-pending',route:value.route.url,installation:'unverified'});
    }
    if(value.status==='guest'||value.status==='disconnected'||value.status==='expired')return publish({phase:'guest',code:value.revocationConfirmed===true?'PRIVATE_REVOCATION_CONFIRMED':value.status==='expired'?'SESSION_EXPIRED':value.status==='disconnected'?'PRIVATE_SESSION_DISCONNECTED':null});
    return publish({phase:'degraded',code:value.status==='revocation-pending'?'REVOCATION_PENDING':'PRIVATE_SESSION_RETRY_REQUIRED'});
  }
  async function readResource(path){
    if(!['/v1/margin/account','/v1/solvency/liability-proof?asset=YNXT'].includes(path))throw failure('PRIVATE_READ_ROUTE_UNAVAILABLE');
    if(current.phase!=='connected'||!adapter||origin!==ORIGIN)throw failure('AUTHORIZATION_REQUIRED');
    const token=epoch,account=current.account,expiresAt=current.expiresAt;
    if(Date.parse(expiresAt)<=Date.now())throw failure('SESSION_EXPIRED');
    try{
      const authorization=await adapter.createIntrospectionProof([PRIVATE_READ_SCOPE]);
      if(!active(token)||current.account!==account)throw failure('SESSION_CHANGED');
      if(typeof authorization.proofHeader!=='string'||!authorization.proofHeader||authorization.proofHeader.length>16384)throw failure('PROOF_REQUIRED');
      const response=await fetchImpl(new URL('/api'+path,origin).href,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json','X-YNX-Product-Session-Proof-V2':authorization.proofHeader}});
      const value=await readJSONResponse(response);
      if(!active(token)||current.account!==account)throw failure('SESSION_CHANGED');
      if(Date.parse(expiresAt)<=Date.now())throw failure('SESSION_EXPIRED');
      return path==='/v1/margin/account'?validateMarginSnapshot(value,account):validateLiabilityProof(value,account);
    }catch(error){if(active(token)){cancel();publish(errorState(error))}throw error}
  }
  function run(kind,action){
    if(closed)return Promise.resolve(current);
    if(operation?.kind===kind)return operation.promise;
    guestIntent=false;
    const token=++epoch;cancel();publish({phase:'loading'});
    const promise=(async()=>{try{const a=await getAdapter();if(!active(token))return current;return await accept(await action(a.client),token)}catch(error){return active(token)?publish(errorState(error)):current}})();
    operation={kind,promise};promise.finally(()=>{if(operation?.promise===promise)operation=null});return promise;
  }
  const api={
    state:()=>current,
    readResource,
    start(url){return run('restore',client=>{const target=new URL(url);if(target.origin!==ORIGIN)throw failure('ORIGIN_NOT_ALLOWED');return target.pathname==='/wallet-auth/callback'?client.handleReturn(url):client.restore()})},
    begin:()=>run('begin',client=>client.beginExplicit()),
    retry:()=>run('retry',client=>client.retryDetected()),
    refresh:()=>run('refresh',client=>client.restore()),
    disconnect:()=>run('disconnect',client=>client.disconnect()),
    guest(){guestIntent=true;++epoch;operation=null;cancel();adapter?.client.enterGuest();return publish({phase:'guest',code:'LOCAL_GUEST_NOT_REVOKED'})},
    offline(){++epoch;operation=null;cancel();adapter?.client.setNetworkAvailable(false);return guestIntent?current:publish({phase:'degraded',code:'NETWORK_UNAVAILABLE'})},
    online(){adapter?.client.setNetworkAvailable(true);return guestIntent?Promise.resolve(current):api.retry()},
    close(){closed=true;++epoch;cancel();adapter?.close();publish({phase:'closed'})},
  };
  return Object.freeze(api);
}
