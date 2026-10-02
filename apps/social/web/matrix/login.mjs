// Standard Matrix legacy SSO consumer. This module is not an OP or a token issuer.
export const MATRIX_LOGIN_PROTOCOL='ynx-social-matrix-login/v1';
export const MATRIX_LOGIN_CALLBACK='/matrix/login/callback';
const SOCIAL_ORIGIN='https://social.ynxweb4.com';
const consumedCallbacks=new WeakSet();
const fail=(code,message)=>Object.assign(new Error(message),{code});
const devicePattern=/^[A-Za-z0-9._-]{3,64}$/;
function secureRoot(value,localQA){
 let url;try{url=new URL(value)}catch{throw fail('MATRIX_UNSAFE_ORIGIN','A fixed secure homeserver is required')}
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(localQA&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw fail('MATRIX_UNSAFE_ORIGIN','A fixed secure homeserver is required');
 return url;
}
function productOrigin(value,localQA){const url=secureRoot(value,localQA);if(url.origin!==SOCIAL_ORIGIN&&!(localQA&&['localhost','127.0.0.1'].includes(url.hostname)))throw fail('MATRIX_CALLBACK_ORIGIN','The registered Social callback is required');return url.origin}
export function validMatrixUserId(userId,serverName){
 if(typeof userId!=='string'||userId.length>255||typeof serverName!=='string'||!/^[a-zA-Z0-9.-]+(:[0-9]{1,5})?$/.test(serverName)||!userId.startsWith('@')||!userId.endsWith(':'+serverName))return false;
 const localpart=userId.slice(1,-serverName.length-1);return !!localpart&&!/[:\s\x00-\x1f\x7f-\uffff]/.test(localpart);
}
export function validateMatrixLoginMetadata(input,account,{localQA=false}={}){
 const keys=['account','homeserver','protocol','serverName','userId'];
 if(!input||Object.keys(input).sort().join(',')!==keys.join(',')||input.protocol!==MATRIX_LOGIN_PROTOCOL||input.account!==account||!/^ynx1[0-9a-z]{38}$/.test(account)||!validMatrixUserId(input.userId,input.serverName))throw fail('MATRIX_LOGIN_METADATA_INVALID','Verified Matrix identity metadata is unavailable');
 const homeserver=secureRoot(input.homeserver,localQA).href;
 return Object.freeze({...input,homeserver});
}
export async function fetchMatrixLoginMetadata({account,deviceId,client,csrfToken,guard,signal,fetcher=globalThis.fetch}){
 guard();if(!devicePattern.test(deviceId)||typeof csrfToken!=='string'||!csrfToken)throw fail('MATRIX_LOGIN_METADATA_INVALID','Existing device and Social identity are required');
 const permission=await client.restore();guard();
 if(permission.status!=='connected'||permission.session?.account!==account||!['social.profile','social.contacts','social.messaging'].every(scope=>permission.session?.scopes?.includes(scope)))throw fail('MATRIX_PERMISSION_REQUIRED','Existing explicit Social approval is required');
 const proof=await client.proof(['social.contacts','social.messaging']);guard();
 let response;try{response=await fetcher('/social/v3/matrix/login-metadata',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{'Content-Type':'application/json','X-YNX-Product-Session-Proof-V2':proof.proofHeader,'X-YNX-SSO-CSRF':csrfToken},body:JSON.stringify({deviceId})})}catch{guard();throw fail('MATRIX_LOGIN_METADATA_UNAVAILABLE','Matrix login metadata temporarily unavailable')}
 guard();if(!response.ok){
  if(response.status===401||response.status===403)throw fail('MATRIX_PERMISSION_REQUIRED','Social chat approval is unavailable or expired. Return to Social and approve explicitly; your encrypted history is retained.');
  if(response.status===409)throw fail('MATRIX_IDENTITY_MAPPING_REQUIRED','Your existing Matrix identity must be linked by the service operator. No new account or device was created; your encrypted history is retained.');
  if(response.status===429)throw fail('MATRIX_LOGIN_METADATA_UNAVAILABLE','Too many connection attempts. Wait briefly and retry explicitly; your encrypted history is retained.');
  throw fail('MATRIX_LOGIN_METADATA_UNAVAILABLE','Matrix sign-in is temporarily unavailable. Retry explicitly when the service is restored; your encrypted history is retained.');
 }
 const metadata=await response.json();guard();return validateMatrixLoginMetadata(metadata,account);
}
// A must serve this route without request-query logging or external resources,
// with Cache-Control: no-store and Referrer-Policy: no-referrer before this runs.
export function handleMatrixLoginCallback({environment=globalThis,callbackOrigin=SOCIAL_ORIGIN,localQA=false,callbackHref=environment.location.href}={}){
 const url=new URL(callbackHref),current=new URL(environment.location.href),origin=productOrigin(callbackOrigin,localQA);
 if(url.origin!==origin||url.pathname!==MATRIX_LOGIN_CALLBACK||current.origin!==origin||current.pathname!==MATRIX_LOGIN_CALLBACK)return false;
 const token=url.searchParams.get('loginToken'),state=url.searchParams.get('state');
 const valid=url.searchParams.getAll('loginToken').length===1&&url.searchParams.getAll('state').length===1&&typeof token==='string'&&token.length>0&&token.length<=8192&&/^[a-f0-9]{64}$/.test(state??'');
 environment.history.replaceState(null,'',MATRIX_LOGIN_CALLBACK);
 const status=environment.document?.getElementById?.('callback-status')??environment.document?.body;
 if(consumedCallbacks.has(environment)){if(status)status.textContent='This sign-in callback has already been used. Return to Social and retry.';return true}
 consumedCallbacks.add(environment);
 if(valid&&environment.opener){if(status)status.textContent='Sign-in returned to Social. You can close this window.';environment.opener.postMessage({type:'ynx-social-matrix-login-token',state,loginToken:token},origin);environment.close()}
 else if(status)status.textContent='Matrix sign-in callback is unavailable or expired. Return to Social and retry.';
 return true;
}
export function createMatrixLoginController({container,environment=globalThis,callbackOrigin=SOCIAL_ORIGIN,localQA=false,timeoutMs=120000}={}){
 const origin=productOrigin(callbackOrigin,localQA);let active=null;
 function cancel(){active?.finish(fail('MATRIX_LOGIN_CANCELLED','Matrix sign-in cancelled; encrypted storage is retained'))}
 function request({metadata,deviceId,guard,validateIdentity}){
  if(active)return Promise.reject(fail('MATRIX_LOGIN_BUSY','Another Matrix sign-in is active'));
  return new Promise((resolve,reject)=>{
   const controller=new AbortController();let done=false,processing=false,popup=null,panel=null,poll=null;
   const operation={finish};active=operation;
   const nonce=[...environment.crypto.getRandomValues(new Uint8Array(32))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
   const deadline=environment.setTimeout(()=>finish(fail('MATRIX_LOGIN_EXPIRED','Matrix sign-in expired; retry explicitly')),timeoutMs);
   function finish(error,binding){if(done)return;done=true;environment.clearTimeout(deadline);if(poll!==null)environment.clearInterval(poll);environment.removeEventListener('message',message);controller.abort();try{popup?.close()}catch{}panel?.remove();if(active===operation)active=null;error?reject(error):resolve(binding)}
   function check(){if(done||controller.signal.aborted||active!==operation)throw fail('UI_STALE_VIEW','Previous Matrix sign-in was discarded');guard()}
   async function current(){check();await validateIdentity();check()}
   async function json(url,options={}){
    check();let response;try{response=await environment.fetch(url,{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',...options,signal:controller.signal})}catch{check();throw fail('MATRIX_LOGIN_NETWORK','Matrix sign-in authority temporarily unavailable')}
    check();if(!response.ok)throw fail('MATRIX_LOGIN_REJECTED','Matrix sign-in was not accepted by the homeserver');
    let result;try{result=await response.json()}catch{check();throw fail('MATRIX_LOGIN_RESPONSE','Invalid Matrix sign-in response')}
    check();return result;
   }
   async function message(event){
    const data=event.data;if(done||processing||!popup||event.origin!==origin||event.source!==popup||data?.type!=='ynx-social-matrix-login-token'||data.state!==nonce||typeof data.loginToken!=='string'||!data.loginToken||data.loginToken.length>8192)return;
    processing=true;try{
     await current();const login=await json(new URL('/_matrix/client/v3/login',metadata.homeserver).href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'m.login.token',token:data.loginToken,device_id:deviceId,initial_device_display_name:'YNX Social'})});
     if(login.user_id!==metadata.userId||login.device_id!==deviceId||typeof login.access_token!=='string'||!login.access_token||login.access_token.length>8192)throw fail('MATRIX_ACCOUNT_MISMATCH','Homeserver returned a different account or device');
     await current();const who=await json(new URL('/_matrix/client/v3/account/whoami',metadata.homeserver).href,{headers:{Authorization:`Bearer ${login.access_token}`}});
     if(who.user_id!==metadata.userId||who.device_id!==deviceId)throw fail('MATRIX_ACCOUNT_MISMATCH','Matrix user or device readback differs');
     await current();finish(null,{protocol:'ynx-social-matrix/v1',account:metadata.account,homeserver:metadata.homeserver,serverName:metadata.serverName,userId:metadata.userId,deviceId,accessToken:login.access_token});
    }catch(error){finish(error)}
   }
   void (async()=>{
    try{
     metadata=validateMatrixLoginMetadata(metadata,metadata?.account,{localQA});if(!devicePattern.test(deviceId))throw fail('MATRIX_INVALID_BINDING','The original Matrix device is required');
     await current();const flows=await json(new URL('/_matrix/client/v3/login',metadata.homeserver).href);
     if(!Array.isArray(flows.flows)||!['m.login.sso','m.login.token'].every(type=>flows.flows.some(flow=>flow.type===type)))throw fail('MATRIX_SSO_UNAVAILABLE','This homeserver has not offered standard SSO and token login');
     await current();const callback=new URL(MATRIX_LOGIN_CALLBACK,origin);callback.searchParams.set('state',nonce);const redirect=new URL('/_matrix/client/v3/login/sso/redirect',metadata.homeserver);redirect.searchParams.set('redirectUrl',callback.href);
     panel=environment.document.createElement('section');const label=environment.document.createElement('p'),start=environment.document.createElement('button'),stop=environment.document.createElement('button');
     label.textContent='Sign in to the fixed Matrix homeserver with your existing YNX identity. Your original encrypted device and history are retained.';start.type=stop.type='button';start.textContent='Continue to Matrix sign-in';stop.textContent='Cancel Matrix sign-in';panel.append(label,start,stop);container.append(panel);
     stop.onclick=cancel;start.onclick=()=>{if(popup||done)return;try{check();popup=environment.open(redirect.href,`ynx-social-matrix-${nonce}`,'popup,width=560,height=720');if(!popup)throw fail('MATRIX_POPUP_BLOCKED','Allow the Matrix sign-in popup and retry');start.disabled=true;poll=environment.setInterval(()=>{try{check();if(!processing&&popup.closed)cancel()}catch(error){finish(error)}},100)}catch(error){finish(error)}};
     environment.addEventListener('message',message);
    }catch(error){finish(error)}
   })();
  });
 }
 return {request,cancel};
}
