import {privateSessionCopy} from './private-session-copy.js';

let account=null,csrf=null,available=false,pending=null;
const suppression='ynx.quant.browser-identity.explicit-logout.v1';
const notification=typeof BroadcastChannel==='function'?new BroadcastChannel('ynx.quant.browser-identity.recheck.v1'):null;
function render(unavailable=false){
  const text=privateSessionCopy(localStorage.getItem('ynx.quant.locale')||'en');
  const signIn=document.getElementById('browser-signin'),signOut=document.getElementById('browser-signout'),status=document.getElementById('browser-identity');
  if(signIn){signIn.textContent=text.identitySignIn;signIn.disabled=!available;signIn.hidden=!!account;}
  if(signOut){signOut.textContent=text.identitySignOut;signOut.hidden=!account;}
  if(status)status.textContent=`${account||text.guest} ${unavailable?text.unavailable:''} ${text.identityBoundary}`;
}
async function request(path,init){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await fetch(path,{...init,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});const raw=await response.text();if(raw.length>16384||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))throw new Error('IDENTITY_UNAVAILABLE');return {status:response.status,data:JSON.parse(raw)};}finally{clearTimeout(timer);}
}
export function recheckBrowserIdentity(){
  if(pending)return pending;
  pending=(async()=>{
    try{
      const result=await request('/api/v1/sso/account');
      if(result.status===401||result.status===403){if(account)window.dispatchEvent(new CustomEvent('ynx:quant-wallet-context',{detail:{identityChanged:true}}));account=null;csrf=null;render();return;}
      if(result.status!==200||result.data.signedIn!==true||result.data.privateWorkspaceAuthorized!==false||!/^(ynx1)[a-z0-9]{38}$/.test(result.data.account||'')||typeof result.data.csrfToken!=='string')throw new Error('IDENTITY_UNAVAILABLE');
      if(account&&account!==result.data.account)window.dispatchEvent(new CustomEvent('ynx:quant-wallet-context',{detail:{identityChanged:true}}));
      account=result.data.account;csrf=result.data.csrfToken;render();
    }catch{render(true);} // Data/service failure does not fabricate logout.
  })().finally(()=>{pending=null;});return pending;
}
// A guest account GET is not evidence of a restorable Central family/grant.
// SilentAllowed is permission for identity-only recovery, never a requirement
// to interrupt a research draft. Existing identity cookies restore via 200;
// only the explicit fixed sign-in button may navigate to the SSO start route.
export function mountBrowserSSO(){
  document.getElementById('browser-signin')?.addEventListener('click',()=>{
    if(!available)return;localStorage.removeItem(suppression);
    const view=document.querySelector('nav [data-view].active')?.dataset.view||'research';
    location.assign('/sso/start?target='+encodeURIComponent(view));
  });
  document.getElementById('browser-signout')?.addEventListener('click',async()=>{
    if(!csrf)return;
    try{
      const result=await request('/api/v1/sso/logout',{method:'POST',headers:{'content-type':'application/json','X-YNX-SSO-CSRF':csrf},body:'{}'});
      if(result.status!==200||result.data.revoked!==true)throw new Error('IDENTITY_LOGOUT_UNCONFIRMED');
      localStorage.setItem(suppression,'true');account=null;csrf=null;
      window.dispatchEvent(new CustomEvent('ynx:quant-wallet-context',{detail:{identityChanged:true}}));notification?.postMessage('recheck');render();
    }catch{render(true);}
  });
  document.getElementById('locale')?.addEventListener('change',()=>queueMicrotask(()=>render()));
  window.addEventListener('focus',()=>{if(available)recheckBrowserIdentity();});
  notification?.addEventListener('message',()=>{if(available)recheckBrowserIdentity();});
  request('/api/v1/sso/config').then(result=>{available=result.status===200&&result.data.enabled===true;render();if(available)return recheckBrowserIdentity();}).catch(()=>render(true));
  render();
}
