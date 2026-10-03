import {ContextChangedError} from './request-context.js';

// Only local CSRF and identity hints leave the HttpOnly cookie boundary. The
// backend makes the joint private/Browser decision for the exact request.
export function createShopBusinessAuthorization({current,authorize,fetcher=(...args)=>globalThis.fetch(...args),environment=globalThis}) {
 return async function authorizeBusinessRequest(url,options={}) {
  const subject=current();if(!subject)throw new Error('Approve your private Shop session first.');
  const target=new URL(url,environment.location.href);
  if(target.origin!==environment.location.origin)throw new Error('Shop business requests must remain on the registered origin.');
  const assert=()=>{if(current()!==subject||Date.parse(subject.expiresAt)<=Date.now())throw new ContextChangedError()};
  const response=await fetcher(new URL('/api/sso/account',target.origin).href,{method:'GET',credentials:'same-origin',cache:'no-store',signal:options.signal,headers:{Accept:'application/json'}});
  const identity=await response.json();assert();
  if(!response.ok||identity.signedIn!==true||typeof identity.csrfToken!=='string'||identity.csrfToken.length<32){throw Object.assign(new Error('Sign in with the same YNX identity to continue your private Shop session.'),{code:'ORIGINAL_BROWSER_REQUIRED',signinURL:'/sso/start?target=overview'})}
  if(identity.account!==subject.account||typeof identity.subject!=='string'||!Number.isSafeInteger(identity.generation)||Date.parse(identity.expiresAt)<=Date.now())throw Object.assign(new Error('The browser identity differs from your approved Shop session.'),{code:'BROWSER_IDENTITY_MISMATCH'});
  const path=target.pathname.replace(/^\/shop-api-staging\/api(?=\/)/,'/api'),method=(options.method||'GET').toUpperCase();
  let scopes=['account:read','shop:orders:write','shop:profile:write'];
  if(['/api/profile','/api/privacy/export','/api/privacy/delete'].includes(path))scopes=['account:read','shop:profile:write'];
  else if(path==='/api/cart'||(path==='/api/orders'&&method==='POST')||path==='/api/orders/intent-lookup'||/^\/api\/orders\/[^/]+\/(pay-handoff|confirm-payment)$/.test(path))scopes=['account:read','shop:orders:write'];
  const wire=await authorize(url,options,scopes);assert();
  const headers=new Headers(wire.headers);if(method!=='GET')headers.set('X-YNX-SSO-CSRF',identity.csrfToken);
  return {...wire,headers,credentials:'same-origin',cache:'no-store'};
 };
}
