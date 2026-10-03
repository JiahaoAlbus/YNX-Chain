// Session approval is followed by an authenticated read from Video itself.
// This check does not issue, verify, or replace a Wallet action proof.
export function createVideoBusinessIdentity({read,now=()=>Date.now()}) {
  let generation=0,verified=null;
  const binding=s=>JSON.stringify([s?.account,s?.sessionBinding,s?.deviceId,s?.deviceKey,s?.expiresAt]);
  const current=s=>typeof s?.account==='string'&&!!s.account&&typeof s.sessionBinding==='string'&&!!s.sessionBinding&&Date.parse(s.expiresAt)>now();
  return {
    invalidate(){generation++;verified=null;},
    matches(session){return current(session)&&verified===binding(session);},
    async verify(session,options){
      const attempt=++generation;verified=null;
      if(!current(session))throw new Error('Video sign-in is incomplete or expired. Sign in again.');
      const expected=binding(session),reply=await read('/v1/account',options);
      if(attempt!==generation||expected!==binding(session)||!current(session))throw new DOMException('Video account changed.','AbortError');
      if(!reply||reply.schemaVersion!==1||reply.account!==session.account)throw new Error('Video returned a different account. Sign in again before using your library.');
      verified=expected;
      return reply;
    }
  };
}
