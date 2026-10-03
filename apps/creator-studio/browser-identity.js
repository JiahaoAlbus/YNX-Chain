// Product consumer contract for A's original BrowserSSO handlers. Cookies stay
// HttpOnly; an identity display response never supplies private product scopes.
const origins=Object.freeze({video:'https://video.ynxweb4.com','creator-studio':'https://creator.ynxweb4.com'});
export function createMediaBrowserIdentity({productId,environment=globalThis,now=()=>Date.now(),onExpiry=()=>{}}={}){
 const origin=origins[productId];if(!origin)throw Error('Unregistered Media browser identity');
 let revision=0,identity=null,expiryTimer;
 const remember=value=>{clearTimeout(expiryTimer);identity=Object.freeze({...value,scopes:Object.freeze([...value.scopes])});const original=identity;expiryTimer=setTimeout(()=>{if(identity===original){revision++;identity=null;onExpiry();}},Math.max(1,Date.parse(value.expiresAt)-now()+1));};
 const required=()=>{if(environment.location?.origin!==origin)throw Error('Open the registered Media site to sign in.');};
 const valid=value=>value&&Object.keys(value).sort().join(',')==='account,csrfToken,expiresAt,generation,privateWorkspaceAuthorized,scopes,signedIn,subject'&&value.signedIn===true&&typeof value.account==='string'&&value.account.length>0&&value.account.length<=128&&value.subject===value.account&&Number.isSafeInteger(value.generation)&&value.generation>0&&Number.isFinite(Date.parse(value.expiresAt))&&Date.parse(value.expiresAt)>now()&&Array.isArray(value.scopes)&&value.scopes.length===1&&value.scopes[0]==='identity:read'&&value.privateWorkspaceAuthorized===false&&typeof value.csrfToken==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(value.csrfToken);
 async function read(path,init={}){
  required();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await environment.fetch(origin+path,{...init,credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,headers:{accept:'application/json',...init.headers}});
   if(response.redirected||response.url&&response.url!==origin+path||!/^application\/json(?:;.*)?$/i.test(response.headers.get('content-type')||'')||!/(^|,)\s*no-store\s*(,|$)/i.test(response.headers.get('cache-control')||''))throw Error('YNX account response could not be verified.');
   const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>16384))throw Error('YNX account response exceeds its limit.');
   const reader=response.body?.getReader();let raw='';
   if(reader){const chunks=[];let total=0;try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>16384)throw Error('YNX account response exceeds its limit.');chunks.push(part.value)}const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
   else{raw=await response.text();if(new TextEncoder().encode(raw).length>16384)throw Error('YNX account response exceeds its limit.');}
   let value;try{value=JSON.parse(raw)}catch{throw Error('YNX account response could not be verified.')}
   if(!response.ok)throw Object.assign(Error(response.status===401?'Sign in to your YNX account, then retry your saved product sign-in.':'YNX account service is unavailable. Retry when connected.'),{code:response.status===401?'MEDIA_BROWSER_LOGIN_REQUIRED':'MEDIA_BROWSER_UNAVAILABLE',status:response.status});return value;
  }finally{clearTimeout(timer)}
 }
 return Object.freeze({
  invalidate(){revision++;identity=null;clearTimeout(expiryTimer);},
  signIn(target){required();const allowed=productId==='video'?['discover','subscriptions','playlists','history','settings','channel']:['overview','channel','team','rights','content','upload','assets','earn','moderation','disputes','ai'];if(!allowed.includes(target))throw Error('Unknown Media return page');environment.location.assign(origin+'/sso/start?target='+encodeURIComponent(target));},
  async status(){const original=revision;const value=await read('/api/sso/account');if(original!==revision)throw new DOMException('YNX account changed.','AbortError');if(!valid(value))throw Error('YNX account identity is incomplete. Retry sign in.');remember(value);return Object.freeze({account:identity.account,expiresAt:identity.expiresAt});},
  async authorization(session,proof,assertCurrent=()=>{}){
   required();const original=revision,privateSnapshot=JSON.stringify(session);
   const check=()=>{assertCurrent();if(original!==revision||JSON.stringify(session)!==privateSnapshot||!session?.account||Date.parse(session.expiresAt)<=now()||!Number.isFinite(Date.parse(session.expiresAt)))throw new DOMException('Media account changed.','AbortError');};check();
   if(!valid(identity)){const value=await read('/api/sso/account');check();if(!valid(value))throw Error('YNX account identity is incomplete. Retry sign in.');remember(value);}
   const browser=identity;if(browser.account!==session.account)throw Object.assign(Error('Your YNX account and product approval belong to different accounts. Choose the same account and retry.'),{code:'MEDIA_BROWSER_ACCOUNT_MISMATCH'});
   const headers=await proof();check();if(identity!==browser||!valid(browser))throw new DOMException('YNX account changed.','AbortError');
   return {...headers,'X-YNX-SSO-CSRF':browser.csrfToken};
  },
  async logout(){const original=++revision;identity=null;clearTimeout(expiryTimer);const value=await read('/api/sso/account');if(original!==revision||!valid(value))throw Error('Original YNX account must be checked before sign out.');const result=await read('/api/sso/logout',{method:'POST',headers:{'content-type':'application/json','X-YNX-SSO-CSRF':value.csrfToken},body:'{}'});if(original!==revision||result.revoked!==true)throw Error('YNX account sign out is not confirmed. Retry.');return {revoked:true};},
 });
}
