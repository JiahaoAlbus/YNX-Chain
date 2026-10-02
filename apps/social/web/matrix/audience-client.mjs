import {createBoundedOperation} from './bounded-operation.mjs';
const ROOT='/social/v3/matrix/audience/';
const SCOPES=['social.contacts','social.feed','social.messaging','social.profile'];
const fail=message=>{throw new Error(message)};

// DTO serialization only. The actual shared SDK/verifier remains responsible
// for canonical-byte validation, Unicode/safe integer rules and signatures.
function ordered(value){
  if(Array.isArray(value))return value.map(ordered);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])]));
  return value;
}
export function createSocialAudienceHTTPClient({session,capture,guard,csrfToken,fetcher=fetch}){
  async function post(route,input,{signal=null,assertCurrent=()=>{}}={}){
    if(!['resolve','authorize'].includes(route))fail('Unsupported audience route');
    const view=capture(),bounded=createBoundedOperation({signal});
    const current=()=>{bounded.guard();guard(view);assertCurrent()};
    try{current();
    // Do not restore a new permission selection over an old grant automatically.
    if(session.current?.status!=='connected'||!SCOPES.every(scope=>session.current.session?.scopes?.includes(scope)))
      fail('Approve the explicit Social publishing permission first; the old chat grant was not upgraded');
    const live=await bounded.wait(()=>session.restore());current();
    if(live.status!=='connected'||live.session.account!==view.account||!SCOPES.every(scope=>live.session.scopes.includes(scope)))
      fail('Current publishing permission does not match this account');
    const csrf=await bounded.wait(()=>csrfToken(view));current();
    if(typeof csrf!=='string'||!csrf)fail('Current browser actor binding is required');
    const body=JSON.stringify(ordered(input));
    const proof=await bounded.wait(()=>session.createSocialAudienceProof({path:ROOT+route,body}));current();
    if(proof?.body!==body||typeof proof.proofHeader!=='string'||!proof.proofHeader||
        typeof proof.introspection?.proofHeader!=='string'||!proof.introspection.proofHeader)
      fail('The business proof did not preserve the original submitted bytes');
    const response=await bounded.wait(()=>fetcher(ROOT+route,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:bounded.signal,
      headers:{'Content-Type':'application/json','X-YNX-SSO-CSRF':csrf,
        'X-YNX-Product-Session-Proof-V2':proof.introspection.proofHeader,
        'X-YNX-Product-Session-Action-Proof-V2':proof.proofHeader},body:proof.body}));
    current();
    if(!response.ok)fail(`Audience authorization unavailable (${response.status}); original draft is retained`);
    const metadata=await bounded.wait(()=>response.json());current();
    const keys=['kind','members','owner','protocol','revision','roomId'];
    if(!metadata||JSON.stringify(Object.keys(metadata).sort())!==JSON.stringify(keys)||
        metadata.protocol!=='ynx-social-matrix-moment/v1'||!['contacts','group','selected','private'].includes(metadata.kind)||
        typeof metadata.owner!=='string'||!metadata.owner.startsWith('@')||
        typeof metadata.roomId!=='string'||!metadata.roomId.startsWith('!')||
        typeof metadata.revision!=='string'||!/^[a-f0-9]{64}$/.test(metadata.revision)||
        !Array.isArray(metadata.members)||!metadata.members.length||metadata.members.length>256||
        metadata.members.some(member=>typeof member!=='string'||!member.startsWith('@'))||
        new Set(metadata.members).size!==metadata.members.length||!metadata.members.includes(metadata.owner))
      fail('Verified audience metadata is invalid');
    return {protocol:metadata.protocol,kind:metadata.kind,revision:metadata.revision,owner:metadata.owner,roomId:metadata.roomId,members:[...metadata.members].sort()};
    }finally{bounded.dispose()}
  }
  return Object.freeze({
    async indexes(after='',{signal=null,assertCurrent=()=>{}}={}){
      if(after&&!/^[a-f0-9]{64}$/.test(after))fail('Invalid private index cursor');
      const view=capture(),bounded=createBoundedOperation({signal});
      const current=()=>{bounded.guard();guard(view);assertCurrent()};
      try{current();
      if(session.current?.status!=='connected'||!SCOPES.every(scope=>session.current.session?.scopes?.includes(scope)))fail('Approve the explicit Social publishing permission first');
      const live=await bounded.wait(()=>session.restore());current();
      if(live.status!=='connected'||live.session.account!==view.account||!SCOPES.every(scope=>live.session.scopes.includes(scope)))fail('Current private permission does not match this account');
      const proof=await bounded.wait(()=>session.proof(SCOPES));current();
      const response=await bounded.wait(()=>fetcher(ROOT+'indexes'+(after?'?after='+encodeURIComponent(after):''),{credentials:'same-origin',redirect:'error',cache:'no-store',signal:bounded.signal,headers:{'X-YNX-Product-Session-Proof-V2':proof.proofHeader}}));current();
      if(!response.ok)fail(`Encrypted index reader unavailable (${response.status}); no plaintext fallback`);
      const feed=await bounded.wait(()=>response.json());current();
      if(!feed||!Array.isArray(feed.indexes)||feed.indexes.length>40||Object.keys(feed).some(key=>!['indexes','after'].includes(key))||feed.after!==undefined&&!/^[a-f0-9]{64}$/.test(feed.after))fail('Invalid private index response');
      const indexes=feed.indexes.map(row=>{
        const keys=['actor','eventId','kind','members','owner','protocol','revision','roomId','sender','transactionId'];
        if(!row||Object.keys(row).some(key=>!keys.includes(key)&&key!=='parentEventId')||keys.some(key=>!(key in row))||typeof row.actor!=='string'||!/^ynx1[0-9a-z]{38}$/.test(row.actor)||typeof row.sender!=='string'||!row.sender.startsWith('@')||typeof row.eventId!=='string'||!/^\$[^\s\x00-\x1f]{1,254}$/.test(row.eventId)||typeof row.transactionId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(row.transactionId)||row.parentEventId!==undefined&&!/^\$[^\s\x00-\x1f]{1,254}$/.test(row.parentEventId)||row.protocol!=='ynx-social-matrix-moment/v1'||!['contacts','group','selected','private'].includes(row.kind)||!/^![^\s]+$/.test(row.roomId)||!/^@[\S]+$/.test(row.owner)||!/^[a-f0-9]{64}$/.test(row.revision)||!Array.isArray(row.members)||!row.members.length||row.members.length>256||row.members.some(member=>typeof member!=='string'||!member.startsWith('@'))||new Set(row.members).size!==row.members.length||!row.members.includes(row.owner)||!row.members.includes(row.sender))fail('Invalid authorized index metadata');
        return {audience:{protocol:row.protocol,kind:row.kind,revision:row.revision,owner:row.owner,roomId:row.roomId,members:[...row.members].sort()},eventId:row.eventId,transactionId:row.transactionId,sender:row.sender,parentEventId:row.parentEventId};
      });
      return {indexes,after:feed.after};
      }finally{bounded.dispose()}
    },
    resolve:(selection,options)=>post('resolve',selection,options),
    authorize:(expected,operation,options)=>{
      if(!operation?.action||!operation.transactionId)fail('Original action and transaction identity required');
      const input={action:operation.action,transactionId:operation.transactionId,expected};
      if(operation.eventId)input.eventId=operation.eventId;
      if(operation.parentEventId)input.parentEventId=operation.parentEventId;
      return post('authorize',input,options);
    },
  });
}
