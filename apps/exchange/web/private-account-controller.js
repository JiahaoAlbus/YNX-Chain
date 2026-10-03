// Product orchestration only: request, storage, callbacks and proofs belong to
// the unchanged Wallet SDK. No account permission, native signing or order POST.
import {parseMarketDocument,isVenueTimestamp} from './market-data.js';
export const PRIVATE_READ_SCOPE='exchange:read';
const ORIGIN='https://exchange.ynxweb4.com',MAX_BODY=1024*1024;
const accountPattern=/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/;
const failure=code=>Object.assign(new Error(code),{code});
export async function readAccountResponse(response,signal){
  const length=response.headers.get('content-length');
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||'')||(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>MAX_BODY))||!response.body?.getReader){try{Promise.resolve(response.body?.cancel?.()).catch(()=>{})}catch{}throw failure('INVALID_ACCOUNT_RESPONSE')}
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
  const cancel=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{})}catch{}};
  const abort=()=>cancel();signal.addEventListener('abort',abort,{once:true});
  try{
    while(true){
      if(signal.aborted)throw failure('PRIVATE_CONTEXT_CHANGED');
      const chunk=await reader.read();
      if(signal.aborted)throw failure('PRIVATE_CONTEXT_CHANGED');
      if(chunk.done)break;
      if(!(chunk.value instanceof Uint8Array)||(bytes+=chunk.value.byteLength)>MAX_BODY)throw failure('INVALID_ACCOUNT_RESPONSE');
      text+=decoder.decode(chunk.value,{stream:true});
    }
    text+=decoder.decode();return text;
  }catch(error){cancel();if(['PRIVATE_CONTEXT_CHANGED','INVALID_ACCOUNT_RESPONSE'].includes(error?.code))throw error;throw failure('INVALID_ACCOUNT_RESPONSE')}
  finally{signal.removeEventListener('abort',abort);try{reader.releaseLock()}catch{}}
}
export function validateAccountSnapshot(value,account){
  if(!accountPattern.test(account)||!value||typeof value!=='object'||Array.isArray(value))throw failure('INVALID_ACCOUNT_RESPONSE');
  for(const key of ['balances','ledger','depositIntents','orders','trades','fees','deposits','withdrawals','support','ai','audit']){
    if(!Array.isArray(value[key]))throw failure('INVALID_ACCOUNT_RESPONSE');
    for(const row of value[key]){
      if(!row||typeof row!=='object'||(key==='trades'?row.buyer!==account&&row.seller!==account:row.account!==account))throw failure('ACCOUNT_BINDING_MISMATCH');
    }
  }
  if(value.security?.account!==account)throw failure('ACCOUNT_BINDING_MISMATCH');
  const source=value.sourceMetadata;
  const observed=isVenueTimestamp(source?.asOf)?Date.parse(source.asOf):NaN,now=Date.now();
  if(source?.classification!=='testnet'||source.authority!=='YNX-owned deterministic order state'||source.version!=='exchange-public-state-v1'||source.coverage!=='account-ledger-orders-trades-fees-audit'||!['live','degraded_single_host'].includes(source.status)||!Number.isFinite(observed)||observed>now+5000||now-observed>120000||source.status==='live'&&(source.stateBackend!=='postgres-cas-multi-instance'||source.multiInstance!==true)||source.status==='degraded_single_host'&&(source.stateBackend!=='file-cas-single-host'||source.multiInstance!==false))throw failure('INVALID_ACCOUNT_SOURCE');
  // Refuse unsafe JSON integers instead of silently rounding a venue balance.
  const check=(v)=>{if(v&&typeof v==='object')for(const [key,n]of Object.entries(v)){if(typeof n==='number'&&!Number.isSafeInteger(n))throw failure('UNSAFE_ACCOUNT_AMOUNT');if(/Micro$/.test(key)&&typeof n!=='number')throw failure('UNSAFE_ACCOUNT_AMOUNT');check(n)}};check(value);
  // Validate business records before rendering or summing them. Signed ledger
  // deltas are valid; balances, fills and fees are not signed deltas. Do not
  // deduplicate silently: that would invent an apparently verified total.
  const text=v=>typeof v==='string'&&v.trim().length>0;
  const amounts=(row,keys)=>{for(const key of keys)if(!Number.isSafeInteger(row[key])||row[key]<0)throw failure('UNSAFE_ACCOUNT_AMOUNT')};
  for(const key of ['balances','ledger','depositIntents','orders','trades','fees','deposits','withdrawals','support','ai','audit']){
    const seen=new Set();
    for(const row of value[key]){
      const id=key==='balances'?row.asset:row.id;
      if(!text(id)||seen.has(id))throw failure('INVALID_ACCOUNT_RESPONSE');seen.add(id);
      if(key==='balances')amounts(row,['availableMicro','reservedMicro']);
      if(key==='ledger')for(const field of ['availableDelta','reservedDelta'])if(!Number.isSafeInteger(row[field]))throw failure('UNSAFE_ACCOUNT_AMOUNT');
      if(key==='orders'){
        amounts(row,['priceMicro','amountMicro','filledMicro','reservedMicro']);
        if(row.filledMicro>row.amountMicro)throw failure('UNSAFE_ACCOUNT_AMOUNT');
      }
      if(key==='trades')amounts(row,['priceMicro','amountMicro','buyerFeeMicro','sellerFeeMicro']);
      if(key==='fees'||key==='deposits')amounts(row,['amountMicro']);
      if(key==='withdrawals'){
        amounts(row,['amountMicro','feeMicro','receiveMicro']);
        if(BigInt(row.receiveMicro)+BigInt(row.feeMicro)!==BigInt(row.amountMicro))throw failure('UNSAFE_ACCOUNT_AMOUNT');
      }
    }
  }
  if(typeof value.security.withdrawalLock!=='boolean'||!Number.isSafeInteger(value.security.sessionTtlMinutes)||value.security.sessionTtlMinutes<15||value.security.sessionTtlMinutes>480)throw failure('INVALID_ACCOUNT_RESPONSE');
  return value;
}

// The narrow adapter seam permits offline orchestration fixtures. Production
// passes the exact same-module SDK constructor and authority in the entry file.
export function createPrivateAccountController({createAdapter,fetchImpl,origin=ORIGIN,onState=()=>{},wallet,setTimer=setTimeout,clearTimer=clearTimeout}){
  let adapter,loading,epoch=0,closed=false,guestIntent=false,request,expiry,operation;
  let pendingRetirement=null,selectionBinding=null;
  let current=Object.freeze({phase:'guest',account:null,snapshot:null,route:null,code:null});
  const publish=(value)=>{current=Object.freeze({phase:'guest',account:null,snapshot:null,route:null,code:null,...value});onState(current);return current};
  const cancel=()=>{request?.abort();request=null;clearTimer(expiry)};
  const active=token=>!closed&&token===epoch;
  async function getAdapter(){
    if(closed)throw failure('CLIENT_CLOSED');
    if(!loading)loading=Promise.resolve().then(createAdapter).then(value=>{if(closed){value.close();throw failure('CLIENT_CLOSED')}adapter=value;return value}).catch(error=>{loading=null;throw error});
    return loading;
  }
  function errorState(error){
    const code=error?.code===4001?'USER_REJECTED':/^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code||'')?error.code:'PRIVATE_SERVICE_UNAVAILABLE';
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
    // Bound the full HTTP/body wait even if the transport ignores abort.
    let rejectAborted;
    const aborted=new Promise((_,reject)=>{rejectAborted=()=>reject(failure('PRIVATE_API_UNAVAILABLE'))});
    controller.signal.addEventListener('abort',rejectAborted,{once:true});
    const timeout=setTimer(()=>controller.abort(),10000);
    try{
      if(origin!==ORIGIN)throw failure('ORIGIN_NOT_ALLOWED');
      // Bind this Web read to its actual host-only browser identity when one
      // exists. Omitting that cookie incorrectly selects the independent native
      // channel and prevents central logout/account isolation from applying.
      const body=await Promise.race([(async()=>{
        const response=await fetchImpl(new URL('/api/v1/account',origin).href,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json','X-YNX-Product-Session-Proof-V2':authorization.proofHeader}});
        if(!active(token))return null;
        if(!response.ok)throw failure([401,403].includes(response.status)?'AUTHORIZATION_REQUIRED':'PRIVATE_API_UNAVAILABLE');
        return readAccountResponse(response,controller.signal);
      })(),aborted]);
      if(!active(token))return current;
      let value;try{value=parseMarketDocument(body)}catch{throw failure('INVALID_ACCOUNT_RESPONSE')}
      const snapshot=validateAccountSnapshot(value,session.account);
      if(!active(token))return current;
      if(Date.parse(session.expiresAt)<=Date.now())throw failure('SESSION_EXPIRED');
      const observed=wallet?.getPrivateWalletContext?.();
      if(!selectionBinding&&observed?.status==='connected')selectionBinding=observed;
      expiry=setTimer(()=>{if(active(token))publish({phase:'authorization-required',code:'SESSION_EXPIRED'})},Math.min(2147483647,Date.parse(session.expiresAt)-Date.now()));
      return publish({phase:'connected',account:session.account,snapshot,expiresAt:session.expiresAt});
    }finally{clearTimer(timeout);controller.signal.removeEventListener('abort',rejectAborted);if(request===controller)request=null}
  }
  async function accept(value,token){
    if(!active(token))return current;
    if(value.status==='connected')return readAccount(value,token);
    if(value.status==='connecting'&&value.automatic===false&&value.installation==='unverified'&&value.route?.status==='ready'){
      // Exact SDK-owned URL. It is never auto-navigated or put in a new tab.
      const route=new URL(value.route.url);
      if(route.protocol!=='ynxwallet:'||route.hostname!=='authorize'||!route.searchParams.get('request'))throw failure('INVALID_WALLET_ROUTE');
      if(!Number.isFinite(Date.parse(value.request?.expiresAt))||Date.parse(value.request.expiresAt)<=Date.now())throw failure('SESSION_EXPIRED');
      expiry=setTimer(()=>{if(active(token))publish({phase:'authorization-required',code:'SESSION_EXPIRED'})},Math.min(2147483647,Date.parse(value.request.expiresAt)-Date.now()));
      return publish({phase:'approval-pending',route:value.route.url,installation:'unverified'});
    }
    if(value.status==='guest'||value.status==='disconnected'||value.status==='expired')return publish({phase:'guest',code:value.revocationConfirmed===true?'PRIVATE_REVOCATION_CONFIRMED':value.status==='expired'?'SESSION_EXPIRED':value.status==='disconnected'?'PRIVATE_SESSION_DISCONNECTED':null});
    return publish({phase:'degraded',code:value.status==='revocation-pending'?'REVOCATION_PENDING':'PRIVATE_SESSION_RETRY_REQUIRED'});
  }
  function run(kind,action){
    if(closed)return Promise.resolve(current);
    if(operation?.kind===kind)return operation.promise;
    guestIntent=false;
    const token=++epoch;cancel();publish({phase:'loading'});
    const promise=(async()=>{try{if(pendingRetirement)await pendingRetirement;const a=await getAdapter();if(!active(token))return current;return await accept(await action(a.client,token),token)}catch(error){return active(token)?publish(errorState(error)):current}})();
    operation={kind,promise};promise.finally(()=>{if(operation?.promise===promise)operation=null});return promise;
  }
  function retirePending(client){
    if(!pendingRetirement){const pending=Promise.resolve().then(()=>client.disconnect()).catch(()=>({status:'revocation-pending'}));pendingRetirement=pending;pending.finally(()=>{if(pendingRetirement===pending)pendingRetirement=null})}
    return pendingRetirement;
  }
  async function beginSelected(client,token){
    const selected=wallet?.getPrivateWalletContext?.();
    const native=selected?.status==='connected'&&selected.providerKind==='ynx-wallet'&&selected.chainId==='0x1917'&&selected.provider;
    if(!native)return client.beginExplicit();
    selectionBinding=selected;
    const assert=()=>{const now=wallet.getPrivateWalletContext();if(!active(token)||now.provider!==selected.provider||now.revision!==selected.revision||now.account!==selected.account||now.chainId!==selected.chainId||now.status!=='connected')throw failure('PRIVATE_CONTEXT_CHANGED')};
    let retirement;
    const retire=()=>retirement??=retirePending(client);
    if(operation)operation.nativeCancel=retire;
    try{
      assert();const value=await client.beginExplicit();assert();
      if(value.status!=='connecting'||value.route?.status!=='ready')return value;
      const url=new URL(value.route.url);if(url.protocol!=='ynxwallet:'||url.hostname!=='authorize'||!url.searchParams.get('request'))throw failure('INVALID_WALLET_ROUTE');
      const remaining=Date.parse(value.request?.expiresAt)-Date.now();if(!Number.isFinite(remaining)||remaining<=0)throw failure('SESSION_EXPIRED');
      publish({phase:'approval-pending',route:null,installation:'selected-provider'});
      let timer;const response=await Promise.race([wallet.requestProductSessionV2(value.route.url),new Promise((_,reject)=>{timer=setTimer(()=>reject(failure('SESSION_EXPIRED')),Math.min(remaining,60000))})]).finally(()=>clearTimer(timer));assert();
      if(response?.version!==2||typeof response.returnUrl!=='string'||Object.keys(response).sort().join(',')!=='returnUrl,version')throw failure('PRIVATE_RETURN_INVALID');
      const result=await client.handleReturn(response.returnUrl);assert();return result;
    }catch(error){await retire();throw error}
  }
  const api={
    state:()=>current,
    start(url){return run('restore',client=>{const target=new URL(url);if(target.origin!==ORIGIN)throw failure('ORIGIN_NOT_ALLOWED');return target.pathname==='/wallet-auth/callback'?client.handleReturn(url):client.restore()})},
    begin:()=>current.phase==='connected'?api.refresh():run('begin',beginSelected),
    retry:()=>run('retry',client=>client.retryDetected()),
    refresh:()=>run('refresh',client=>client.restore()),
    disconnect:()=>run('disconnect',client=>client.disconnect()),
    walletChanged(context){
      // This binds transport continuity only, never EVM/native identity mapping.
      // A cold restored native session remains server-verified independently.
      if(!selectionBinding){if(current.phase==='connected'&&context?.status==='connected')selectionBinding=context;return current}
      const same=context?.provider===selectionBinding.provider&&context.account===selectionBinding.account&&context.chainId===selectionBinding.chainId;
      if(same&&(context.status==='connected'||context.status==='transport-unavailable'))return current;
      api.guest();if(adapter)retirePending(adapter.client);return current;
    },
    guest(){guestIntent=true;++epoch;selectionBinding=null;operation?.nativeCancel?.();operation=null;cancel();adapter?.client.enterGuest();return publish({phase:'guest',code:'LOCAL_GUEST_NOT_REVOKED'})},
    offline(){++epoch;operation?.nativeCancel?.();operation=null;cancel();adapter?.client.setNetworkAvailable(false);return guestIntent?current:publish({phase:'degraded',code:'NETWORK_UNAVAILABLE'})},
    online(){adapter?.client.setNetworkAvailable(true);return guestIntent?Promise.resolve(current):api.retry()},
    close(){closed=true;++epoch;const retirement=operation?.nativeCancel?.(),previous=adapter;cancel();if(retirement)retirement.finally(()=>previous?.close());else previous?.close();publish({phase:'closed'})},
  };
  return Object.freeze(api);
}
