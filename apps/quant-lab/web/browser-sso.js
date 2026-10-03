import {privateSessionCopy} from './private-session-copy.js';

let account=null,csrf=null,available=false,pending=null,identityRevision=0,logoutOperation=null;
const suppression='ynx.quant.browser-identity.explicit-logout.v1';
const notification=typeof BroadcastChannel==='function'?new BroadcastChannel('ynx.quant.browser-identity.recheck.v1'):null;
function render(unavailable=false){
  const text=privateSessionCopy(localStorage.getItem('ynx.quant.locale')||'en');
  const signIn=document.getElementById('browser-signin'),signOut=document.getElementById('browser-signout'),status=document.getElementById('browser-identity');
  if(signIn){signIn.textContent=text.identitySignIn;signIn.disabled=!available;signIn.hidden=!!account;}
  if(signOut){signOut.textContent=text.identitySignOut;signOut.hidden=!account;signOut.disabled=!!logoutOperation;}
  if(status)status.textContent=`${account||text.guest} ${unavailable?text.unavailable:''} ${text.identityBoundary}`;
}
async function request(path,init){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await fetch(path,{...init,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});return {status:response.status,data:JSON.parse(await readBrowserIdentityResponse(response,controller.signal))};}finally{clearTimeout(timer);}
}
export async function readBrowserIdentityResponse(response,signal){
  const invalid=()=>new Error('IDENTITY_UNAVAILABLE'),length=response.headers.get('content-length');
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||'')||(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>16384))||!response.body?.getReader){try{Promise.resolve(response.body?.cancel?.()).catch(()=>{})}catch{}throw invalid()}
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
  const cancel=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{})}catch{}};
  signal.addEventListener('abort',cancel,{once:true});
  try{while(true){if(signal.aborted)throw invalid();const chunk=await reader.read();if(signal.aborted)throw invalid();if(chunk.done)break;if(!(chunk.value instanceof Uint8Array)||(bytes+=chunk.value.byteLength)>16384)throw invalid();text+=decoder.decode(chunk.value,{stream:true});}return text+decoder.decode();}
  catch{cancel();throw invalid()}finally{signal.removeEventListener('abort',cancel);try{reader.releaseLock()}catch{}}
}
export function recheckBrowserIdentity(){
  if(logoutOperation)return logoutOperation.promise;
  if(pending)return pending;
  const revision=++identityRevision;
  const operation=(async()=>{
    try{
      const result=await request('/api/v1/sso/account');
      if(revision!==identityRevision)return;
      if(result.status===401||result.status===403){if(account)window.dispatchEvent(new CustomEvent('ynx:quant-wallet-context',{detail:{identityChanged:true}}));account=null;csrf=null;render();return;}
      if(result.status!==200||result.data.signedIn!==true||result.data.privateWorkspaceAuthorized!==false||!/^(ynx1)[a-z0-9]{38}$/.test(result.data.account||'')||typeof result.data.csrfToken!=='string')throw new Error('IDENTITY_UNAVAILABLE');
      if(account&&account!==result.data.account)window.dispatchEvent(new CustomEvent('ynx:quant-wallet-context',{detail:{identityChanged:true}}));
      account=result.data.account;csrf=result.data.csrfToken;render();
    }catch{if(revision===identityRevision)render(true);} // Data/service failure does not fabricate logout.
  })().finally(()=>{if(pending===operation)pending=null;});pending=operation;return operation;
}
export function signOutBrowserIdentity(){
  if(logoutOperation)return logoutOperation.promise;
  if(!csrf)return Promise.resolve();
  const revision=++identityRevision,submittedCSRF=csrf;pending=null;
  const operation={promise:null};logoutOperation=operation;render();
  operation.promise=(async()=>{let unavailable=false;try{
    const result=await request('/api/v1/sso/logout',{method:'POST',headers:{'content-type':'application/json','X-YNX-SSO-CSRF':submittedCSRF},body:'{}'});
    if(revision!==identityRevision)return;
    if(result.status!==200||result.data.revoked!==true)throw new Error('IDENTITY_LOGOUT_UNCONFIRMED');
    localStorage.setItem(suppression,'true');account=null;csrf=null;
    window.dispatchEvent(new CustomEvent('ynx:quant-wallet-context',{detail:{identityChanged:true}}));notification?.postMessage('recheck');
  }catch{unavailable=true;}finally{if(logoutOperation===operation){logoutOperation=null;if(revision===identityRevision)render(unavailable);}}})();
  return operation.promise;
}
// A guest account GET is not evidence of a restorable Central family/grant.
// SilentAllowed is permission for identity-only recovery, never a requirement
// to interrupt a research draft. Existing identity cookies restore via 200;
// only the explicit fixed sign-in button may navigate to the SSO start route.
export function mountBrowserSSO(){
  document.getElementById('browser-signin')?.addEventListener('click',()=>{
    if(!available)return;++identityRevision;pending=null;localStorage.removeItem(suppression);
    const view=document.querySelector('nav [data-view].active')?.dataset.view||'research';
    location.assign('/sso/start?target='+encodeURIComponent(view));
  });
  document.getElementById('browser-signout')?.addEventListener('click',()=>void signOutBrowserIdentity());
  document.getElementById('locale')?.addEventListener('change',()=>queueMicrotask(()=>render()));
  window.addEventListener('focus',()=>{if(available)recheckBrowserIdentity();});
  notification?.addEventListener('message',()=>{if(available)recheckBrowserIdentity();});
  request('/api/v1/sso/config').then(result=>{available=result.status===200&&result.data.enabled===true;render();if(available)return recheckBrowserIdentity();}).catch(()=>render(true));
  render();
}
