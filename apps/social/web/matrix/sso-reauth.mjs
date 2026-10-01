// Consumer of standard Matrix UIA fallback, not an OIDC provider or issuer.
const error=(code,message)=>Object.assign(new Error(message),{code});
export function waitForSsoPopup({environment=globalThis,popup,origin,guard,validateIdentity,signal,timeoutMs=120000}){
 return new Promise((resolve,reject)=>{let done=false,completing=false;const finish=(failure)=>{if(done)return;done=true;environment.removeEventListener('message',message);signal?.removeEventListener('abort',abort);clearTimeout(deadline);clearInterval(poll);try{popup.close()}catch{}failure?reject(failure):resolve()};
 const abort=()=>finish(error('MATRIX_REAUTH_CANCELLED','Device removal cancelled; no device was revoked'));
 const message=async event=>{if(done||completing||event.origin!==origin||event.source!==popup||event.data!=='authDone')return;completing=true;try{guard();await validateIdentity();guard();if(signal?.aborted)throw error('MATRIX_REAUTH_CANCELLED','Device removal cancelled');finish()}catch(e){finish(e)}};
 const deadline=setTimeout(()=>finish(error('MATRIX_REAUTH_EXPIRED','Reauthentication expired; start device removal again')),timeoutMs);
 const poll=setInterval(()=>{try{guard();if(!completing&&popup.closed)abort()}catch(e){finish(e)}},100);
 environment.addEventListener('message',message);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
}
export function createSsoReauthController({container,environment=globalThis,capture,guard,validateIdentity,timeoutMs=120000,localQA=false}){
 let active=null;
 function cancel(){active?.abort()}
 async function request(input){
  if(active)throw error('MATRIX_REAUTH_BUSY','Another device confirmation is active');
  if(!input.challenge.flows.some(flow=>flow.stages.includes('m.login.sso')))throw error('MATRIX_DEVICE_REAUTH_REQUIRED','This server has not offered YNX single sign-on reauthentication');
  const operation=capture();guard(operation);await validateIdentity(operation);guard(operation);
  const base=new URL(input.homeserver);if(base.username||base.password||!(base.protocol==='https:'||(localQA&&base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname))))throw error('MATRIX_UNSAFE_ORIGIN','A fixed HTTPS homeserver is required');
  if(input.account!==operation.binding.account||input.userId!==operation.binding.userId||input.homeserver!==operation.binding.homeserver)throw error('MATRIX_ACCOUNT_MISMATCH','Device removal identity changed');
  const url=new URL('/_matrix/client/v3/auth/m.login.sso/fallback/web',base);url.searchParams.set('session',input.challenge.session);
  const controller=new AbortController();active=controller;
  const panel=environment.document.createElement('section'),label=environment.document.createElement('p'),start=environment.document.createElement('button'),stop=environment.document.createElement('button');
  label.textContent=`Confirm removal of device ${input.deviceId} using your existing YNX identity. Nothing is removed until the server accepts.`;start.type=stop.type='button';start.textContent='Continue with YNX identity';stop.textContent='Cancel device removal';panel.append(label,start,stop);container.append(panel);
  try{return await new Promise((resolve,reject)=>{let launched=false;const expiry=setTimeout(()=>controller.abort(),timeoutMs);const aborted=()=>{if(!launched)reject(error('MATRIX_REAUTH_CANCELLED','Device removal cancelled or expired'))};controller.signal.addEventListener('abort',aborted,{once:true});stop.onclick=()=>controller.abort();start.onclick=()=>{if(launched)return;try{guard(operation);if(controller.signal.aborted)throw error('MATRIX_REAUTH_EXPIRED','Device confirmation expired');const popup=environment.open(url.href,'ynx-social-device-reauth','popup,width=560,height=720');if(!popup)throw error('MATRIX_POPUP_BLOCKED','Allow the YNX identity confirmation popup, then retry device removal');launched=true;start.disabled=true;void waitForSsoPopup({environment,popup,origin:base.origin,guard:()=>guard(operation),validateIdentity:()=>validateIdentity(operation),signal:controller.signal,timeoutMs}).then(()=>resolve({completedStage:'m.login.sso',auth:{session:input.challenge.session}}),reject)}catch(e){reject(e)}};const clear=()=>{clearTimeout(expiry);controller.signal.removeEventListener('abort',aborted)};controller.signal.addEventListener('abort',clear,{once:true});panel._clear=clear})}finally{panel._clear?.();panel.remove();if(active===controller)active=null}
 }
 return {request,cancel};
}
