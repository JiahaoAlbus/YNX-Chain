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
  async function post(route,input){
    if(!['resolve','authorize'].includes(route))fail('Unsupported audience route');
    const view=capture();guard(view);
    // Do not restore a new permission selection over an old grant automatically.
    if(session.current?.status!=='connected'||!SCOPES.every(scope=>session.current.session?.scopes?.includes(scope)))
      fail('Approve the explicit Social publishing permission first; the old chat grant was not upgraded');
    const live=await session.restore();guard(view);
    if(live.status!=='connected'||live.session.account!==view.account||!SCOPES.every(scope=>live.session.scopes.includes(scope)))
      fail('Current publishing permission does not match this account');
    const csrf=await csrfToken(view);guard(view);
    if(typeof csrf!=='string'||!csrf)fail('Current browser actor binding is required');
    const body=JSON.stringify(ordered(input));
    const proof=await session.createSocialAudienceProof({path:ROOT+route,body});guard(view);
    if(proof?.body!==body||typeof proof.proofHeader!=='string'||!proof.proofHeader||
        typeof proof.introspection?.proofHeader!=='string'||!proof.introspection.proofHeader)
      fail('The business proof did not preserve the original submitted bytes');
    const response=await fetcher(ROOT+route,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
      headers:{'Content-Type':'application/json','X-YNX-SSO-CSRF':csrf,
        'X-YNX-Product-Session-Proof-V2':proof.introspection.proofHeader,
        'X-YNX-Product-Session-Action-Proof-V2':proof.proofHeader},body:proof.body});
    guard(view);
    if(!response.ok)fail(`Audience authorization unavailable (${response.status}); original draft is retained`);
    const metadata=await response.json();guard(view);
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
    return metadata;
  }
  return Object.freeze({
    resolve:selection=>post('resolve',selection),
    authorize:(expected,operation)=>{
      if(!operation?.action||!operation.transactionId)fail('Original action and transaction identity required');
      const input={action:operation.action,transactionId:operation.transactionId,expected};
      if(operation.eventId)input.eventId=operation.eventId;
      if(operation.parentEventId)input.parentEventId=operation.parentEventId;
      return post('authorize',input);
    },
  });
}
