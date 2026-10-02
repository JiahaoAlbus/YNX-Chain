import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const identitySource=source.slice(source.indexOf('const financeText='),source.indexOf('function renderWalletIdentity'));
const activitySource=source.slice(source.indexOf('async function attestBrowserIdentityActivity'));
const submitSource=source.slice(source.indexOf('async function submitForm'),source.indexOf("$('#category-form')"));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
function fixture(fetch,api=async()=>{},navigate=()=>{throw Error('unexpected quiet navigation')}){
 const nodes=new Map(),listeners=new Map(),calls=[];let disconnects=0,loads=0,clear=0;
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:'',dataset:{}});return nodes.get(id)};
 const document={addEventListener:(name,fn)=>listeners.set(name,fn)};
 const wallet={getStandardWalletState:()=>({status:'disconnected'}),getPrivateState:()=>({status:'disconnected'}),session:()=>null,browserIdentityMatchesSelected:()=>true,disconnect:async()=>{disconnects++}};
 class Channel{postMessage(){}}
 const run=new Function('$','document','window','BroadcastChannel','fetch','AbortController','setTimeout','clearTimeout','crypto','btoa','state','location','clearLoginIntent','clearPrivateView','loginIntent','loginTarget','notify','api','load','notifyFailure',identitySource+'\n'+activitySource+'\n'+submitSource+`\nreturn {recheckBrowserIdentity,logoutBrowserIdentity,attestBrowserIdentityActivity,submitForm,initializeBrowserIdentity,enable:()=>{browserSSOEnabled=true;browserSSOFinite=true},set:(value)=>{++browserSSORevision;++browserSSOIntentGeneration;browserIdentity=value},revision:()=>browserSSOIntentGeneration,read:()=>({browserIdentity,browserIdentityLogoutPending,browserSSORevision}),click:()=>document};`);
 const controller=run($,document,{YNXFinanceWallet:wallet,YNXFinanceLocale:{text:k=>k}},Channel,async(url,options)=>{calls.push({url,options});return fetch(url,options)},AbortController,setTimeout,clearTimeout,webcrypto,value=>Buffer.from(value,'binary').toString('base64'),{context:0},{hash:'#overview',assign:navigate},()=>{},()=>{clear++},null,()=>'overview',()=>{},api,async()=>{loads++},()=>{});
 return {...controller,$,listeners,calls,count:()=>({disconnects,loads,clear})};
}
const identity=account=>({account,csrfToken:'fixture-csrf',serverNow:new Date().toISOString(),scopes:['identity:read'],privateWorkspaceAuthorized:false});
test('logout invalidates the read epoch before await and keeps failed revoke retryable without reconnecting',async()=>{
 const read=defer(),logout=defer();let logoutCalls=0;const c=fixture(url=>url.endsWith('/account')?read.promise:++logoutCalls===1?logout.promise:Promise.resolve(response({revoked:true})));
 c.enable();c.set(identity('account-a'));const checking=c.recheckBrowserIdentity();const exiting=c.logoutBrowserIdentity();assert.equal(c.read().browserIdentity,null);assert.ok(c.read().browserIdentityLogoutPending);
 read.resolve(response(identity('account-a')));await checking;assert.equal(c.read().browserIdentity,null);
 logout.resolve(response({code:'SSO_REVOKE_UNCONFIRMED'},503));await exiting;assert.ok(c.read().browserIdentityLogoutPending);assert.equal(c.$('#browser-signin-logout').hidden,false);await c.recheckBrowserIdentity();assert.equal(c.calls.filter(x=>x.url.endsWith('/account')).length,1);
 await c.logoutBrowserIdentity();assert.equal(c.read().browserIdentityLogoutPending,null);assert.equal(c.$('#browser-signin-logout').hidden,true);assert.equal(c.count().disconnects,1);
});
test('activity is opt-in, genuine bounded user action only; rechecks never attest or navigate',async()=>{
 const c=fixture(url=>Promise.resolve(response(url.endsWith('/account')?identity('account-a'):{accepted:true})));c.set(identity('account-a'));
 await c.attestBrowserIdentityActivity('navigate',{isTrusted:true});assert.equal(c.calls.length,0);c.enable();
 await c.attestBrowserIdentityActivity('navigate',{isTrusted:false});await c.attestBrowserIdentityActivity('poll',{isTrusted:true});assert.equal(c.calls.length,0);
 await c.recheckBrowserIdentity();assert.equal(c.calls.length,1);assert.equal(c.calls[0].url,'/api/sso/account');
 await c.attestBrowserIdentityActivity('navigate',{isTrusted:true});const request=c.calls.at(-1);assert.equal(request.url,'/api/sso/activity');const body=JSON.parse(request.options.body);assert.equal(body.action,'navigate');assert.equal(body.eventId.length,43);assert.equal(request.options.headers['X-YNX-SSO-CSRF'],'fixture-csrf');
 const click=c.listeners.get('click');click({isTrusted:true,defaultPrevented:false,target:{closest:()=>({closest:()=>true,getAttribute:()=> '#planning'})}});await new Promise(r=>setImmediate(r));assert.equal(c.calls.at(-1).url,'/api/sso/activity');
 const count=c.calls.length;click({isTrusted:true,defaultPrevented:false,target:{closest:()=>({closest:()=>true,getAttribute:()=> '#overview'})}});click({isTrusted:false,target:{closest(){throw Error('synthetic event reached DOM')}}});assert.equal(c.calls.length,count);
});
test('old account action and read cannot revive or attest after a newer account result',async()=>{
 const a=defer();let reads=0;const c=fixture(url=>url.endsWith('/account')?++reads===1?a.promise:Promise.resolve(response(identity('account-b'))):Promise.resolve(response({accepted:true})));
 c.enable();c.set(identity('account-a'));const oldGeneration=c.revision();const first=c.recheckBrowserIdentity();await c.recheckBrowserIdentity();a.resolve(response(identity('account-a')));await first;
 assert.equal(c.read().browserIdentity.account,'account-b');await c.attestBrowserIdentityActivity('save',{isTrusted:true},oldGeneration);assert.equal(c.calls.some(x=>x.url.endsWith('/activity')),false);
});
test('actual success-only form path calls activity after the private API; polling/loading alone is not activity',async()=>{
 for(const fails of [false,true]){let resets=0;const c=fixture(()=>Promise.resolve(response({accepted:true})),async()=>{if(fails)throw Error('private session expired')});c.enable();c.set(identity('account-a'));await c.submitForm({reset(){resets++}},'/api/budgets',{}, {isTrusted:true});await new Promise(r=>setImmediate(r));assert.equal(c.calls.filter(x=>x.url.endsWith('/activity')).length,fails?0:1);assert.equal(resets,fails?0:1);}

 assert.match(submitSource,/await api\(path[\s\S]*void attestBrowserIdentityActivity\('save',event,identityRevision\)/);
 assert.match(source,/submitForm\(e.currentTarget,'\/api\/budgets',[^\n]*,e\)/);
 assert.doesNotMatch(source.slice(source.indexOf("window.addEventListener('focus'"),source.indexOf("document.addEventListener('finance:localechange',renderAccountSession)")),/attestBrowserIdentityActivity/);
});
test('confirmed invalid family requires explicit sign-in; uncertain revocation restores only logout retry',async()=>{
 for(const data of [{code:'SSO_GRANT_INVALID',silentRestoreAllowed:false},{code:'SSO_FAMILY_INVALID',silentRestoreAllowed:false},{code:'SSO_GENERATION_REVOKED',silentRestoreAllowed:false}]){const c=fixture(()=>Promise.resolve(response(data,401)));c.enable();c.set(identity('account-a'));await c.recheckBrowserIdentity();assert.equal(c.read().browserIdentity,null);assert.equal(c.count().disconnects,1);assert.equal(c.calls.length,1);}
 const c=fixture(url=>Promise.resolve(response(url.endsWith('/account')?{code:'SSO_REVOKE_UNCONFIRMED',revocationPending:true,csrfToken:'retry-csrf'}:{revoked:true},url.endsWith('/account')?503:200)));c.enable();await c.recheckBrowserIdentity();assert.equal(c.read().browserIdentity,null);assert.equal(c.read().browserIdentityLogoutPending.csrfToken,'retry-csrf');assert.equal(c.$('#browser-signin-logout').hidden,false);await c.logoutBrowserIdentity();assert.equal(c.calls.at(-1).options.headers['X-YNX-SSO-CSRF'],'retry-csrf');assert.equal(c.read().browserIdentityLogoutPending,null);
 const network=fixture(()=>Promise.resolve(response({code:'SSO_FAMILY_UNAVAILABLE'},503)));network.enable();network.set(identity('account-a'));await network.recheckBrowserIdentity();assert.equal(network.read().browserIdentity.account,'account-a');assert.equal(network.count().disconnects,0);
});

test('first finite product visit can silently use approved Central identity; expired or signed-out product cannot',async()=>{
 for(const blocked of [false,true]){const navigations=[];const c=fixture(url=>Promise.resolve(url.endsWith('/account')?response({code:'SSO_LOGIN_REQUIRED',silentRestoreAllowed:!blocked},401):response({enabled:true,silentRestoreAllowed:true})),undefined,url=>navigations.push(url));c.enable();await c.recheckBrowserIdentity();assert.equal(navigations.length,blocked?0:1);if(!blocked)assert.equal(navigations[0],'/sso/start?prompt=none&target=overview');}
 const navigations=[];const c=fixture(url=>Promise.resolve(url.endsWith('/account')?response({code:'SSO_LOGIN_REQUIRED',silentRestoreAllowed:true},401):response({enabled:true,silentRestoreAllowed:false})),undefined,url=>navigations.push(url));c.enable();await c.recheckBrowserIdentity();assert.deepEqual(navigations,[]);
 const network=fixture(()=>Promise.resolve(response({code:'SSO_UNAVAILABLE'},503)),undefined,url=>navigations.push(url));network.enable();await network.recheckBrowserIdentity();assert.deepEqual(navigations,[]);
});
