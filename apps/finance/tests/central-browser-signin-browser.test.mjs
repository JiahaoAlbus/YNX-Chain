import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {secp256k1} from '../../../packages/wallet-auth/node_modules/@noble/curves/secp256k1.js';
import {sha256} from '../../../packages/wallet-auth/node_modules/@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,utf8ToBytes} from '../../../packages/wallet-auth/node_modules/@noble/hashes/utils.js';
import {walletIdentity,evmAddressFromYNX} from '../../../packages/wallet-auth/src/crypto.js';
import {ProductSessionGatewayNodeHost} from '../../../packages/wallet-auth/src/product-session-gateway-node-host.js';
import {centralBrowserConsentSignBytes} from '../../../packages/wallet-auth/src/central-browser-session-contract.js';
import {canonicalJSON} from '../../../packages/wallet-auth/src/canonical.js';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHostedWalletAdapter} from '../../../packages/wallet-auth/src/vendor/hosted-wallet-adapter-4bccefef.js';
const {build}=createRequire(new URL('../web/package.json',import.meta.url))('esbuild');
const registry=JSON.parse(await readFile(new URL('../../../packages/wallet-auth/product-session-registry.json',import.meta.url)));
const issuer='https://wallet-auth.ynxweb4.com',key='1'.padStart(64,'0'),identity=walletIdentity(key),token=()=>randomBytes(32).toString('base64url');
test('accepted Hosted central adapter bytes restrict the issuer to identity/lifecycle, never EVM or product permissions',async()=>{
  const bytes=await readFile(new URL('../../../packages/wallet-auth/src/vendor/hosted-wallet-adapter-4bccefef.js',import.meta.url));assert.equal(bytes.length,12659);assert.equal(createHash('sha256').update(bytes).digest('hex'),'2567f4ec0958852ef27ee382067b6b104e33fe5dc3feba3aa94d710caa7f2c0a');
  assert.throws(()=>createHostedWalletAdapter({window:{location:{origin:'https://unknown.ynxweb4.com'}}}),error=>error.code==='HOSTED_ORIGIN_UNREGISTERED');
  const adapter=createHostedWalletAdapter({window:{location:{origin:issuer},addEventListener(){},removeEventListener(){}}});
  for(const method of ['personal_sign','eth_signTypedData_v4','eth_sendTransaction','ynx_requestProductSessionV2'])await assert.rejects(adapter.request({method,params:[]}),error=>error.code==='HOSTED_IDENTITY_ONLY');
  await adapter.detach();
});
// Isolated Wallet page fixture for the real accepted adapter's cross-window
// channel. It is not the released vault, installed Wallet or public approval.
function hostedPage(mode){return `<script>
const mode=${JSON.stringify(mode)},request=JSON.parse(atob(location.hash.slice('#connect='.length).replace(/-/g,'+').replace(/_/g,'/')));
const send=(type,extra={})=>opener.postMessage({protocol:'ynx-hosted-wallet/v1',requestId:request.requestId,nonce:request.nonce,messageId:crypto.randomUUID().replaceAll('-',''),expiresAt:Math.min(request.expiresAt,Date.now()+30000),type,...extra},'https://wallet-auth.ynxweb4.com');
addEventListener('message',async event=>{if(event.source!==opener||event.origin!=='https://wallet-auth.ynxweb4.com')return;const input=event.data;if(input.requestId!==request.requestId||input.nonce!==request.nonce)return;
if(input.type==='hello'){if(mode==='hosted-connect-reject')send('rejected',{replyTo:input.messageId});else send('connected',{replyTo:input.messageId,account:${JSON.stringify(evmAddressFromYNX(identity.account))},chainId:'0x1917',sessionExpiresAt:Math.min(request.expiresAt,Date.now()+60000)});}
else if(input.type==='ping')send('pong');else if(input.type==='request'){if(input.method==='wallet_disconnect'){close();return;}if(input.method!=='ynx_requestCentralBrowserSignIn')throw new Error('wrong fixture method');if(mode==='hosted-reject')send('response',{replyTo:input.messageId,ok:false,code:'USER_REJECTED'});else send('response',{replyTo:input.messageId,ok:true,result:await window.qaApproval(input.params[0])});}});send('ready');
</script>`;}
test('Finance preserves Klein blue and white under both OS color-scheme preferences',async()=>{
  const styles=await readFile(new URL('../web/styles.css',import.meta.url),'utf8');
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent(`<style>${styles}</style><body><div class="source-metrics"><div>Source</div></div></body>`);
    for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});assert.deepEqual(await page.evaluate(()=>({blue:getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(),background:getComputedStyle(document.body).backgroundColor,source:getComputedStyle(document.querySelector('.source-metrics>div')).backgroundColor})),{blue:'#002FA7',background:'rgb(255, 255, 255)',source:'rgb(255, 255, 255)'});}
  }finally{await browser.close();}
});
test('central guest page uses explicit selected native RPC, actual backend consent and original PKCE callback; cancellation has no code',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ynx-central-page-'));
  const host=new ProductSessionGatewayNodeHost(registry,{now:()=>new Date(),statePath:join(directory,'gateway'),tokenFactory:token,centralBrowser:true});
  const server=createServer(host.handler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  // This fixture replaces only SignClient network transport at build time.
  // Production uses the official locked SDK; this is not a Relay/Wallet receipt.
  const pairFixture=await build({entryPoints:[fileURLToPath(new URL('../../../packages/wallet-auth/src/central-browser-session-browser.js',import.meta.url))],bundle:true,write:false,platform:'browser',format:'iife',plugins:[{name:'isolated-signclient-fixture',setup(build){build.onResolve({filter:/^@walletconnect\/sign-client$/},()=>({path:'fixture',namespace:'qa'}));build.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:`export default {async init(){if(window.qaPairMode==='pair-error')throw Object.assign(new Error('wc:private-qa-marker?secret=never-render'),{code:'YNX_PAIR_TIMEOUT'});window.qaPairCalls=[];const topic='a'.repeat(64);return {on(){},session:{getAll:()=>[]},core:{pairing:{disconnect:async()=>window.qaPairCalls.push('cancel')}},async connect(){window.qaPairCalls.push('connect');if(window.qaPairMode==='pair-wait-cancel')return new Promise(()=>{});return {uri:'wc:'+topic+'@2?relay-protocol=irn&symKey='+'2'.repeat(64),approval:()=>new Promise(resolve=>window.qaPairApprove=()=>resolve({topic,expiry:Math.floor(Date.now()/1000)+300,peer:{metadata:{url:'https://wallet.ynxweb4.com'}},namespaces:{eip155:{accounts:['eip155:6423:'+window.qaPairAccount],methods:['ynx_requestCentralBrowserSignIn'],chains:['eip155:6423']}}}))}},async request(input){window.qaPairCalls.push(input.request.method);return window.qaApproval(input.request.params[0]);},async disconnect(){window.qaPairCalls.push('disconnect');}}}};`,loader:'js'}));}}]});
  // Isolate only consumer UI settlement order. The official shared lifecycle
  // is covered by the real SignClient fixture above and its separate tests.
  const pairRaceFixture=await build({entryPoints:[fileURLToPath(new URL('../../../packages/wallet-auth/src/central-browser-session-browser.js',import.meta.url))],bundle:true,write:false,platform:'browser',format:'iife',plugins:[{name:'late-pair-consumer-settlement',setup(build){build.onLoad({filter:/walletconnect-dapp-connection\.js$/},()=>({loader:'js',contents:`export class WalletConnectDAppConnection{constructor(){window.qaRaceRejects=[];}on(){}async restore(){return null;}async cancel(){}connect({onURI}){return new Promise((resolve,reject)=>{const n=window.qaRaceRejects.length;window.qaRaceRejects.push(()=>reject(Object.assign(new Error('YNX_PAIR_CANCELLED'),{code:'YNX_PAIR_CANCELLED'})));onURI('wc:'+(n?'b':'a').repeat(64)+'@2?relay-protocol=irn&symKey='+'2'.repeat(64));});}}` }));}}]});
  try{for(const mode of ['approve','switch-4902','cancel','cancel-complete','account-rpc','account-complete','chain-complete','timeout-rpc','timeout-connect','timeout-accountread','pair-approve','pair-cancel','pair-wait-cancel','pair-race-cancel','pair-error','expired-cancel','reject-string','hosted-approve','hosted-reject','hosted-connect-reject','hosted-blocked']){
    const cancel=mode.startsWith('cancel')||mode==='pair-cancel'||mode==='pair-wait-cancel'||mode==='pair-race-cancel'||mode==='reject-string'||mode==='hosted-reject'||mode==='hosted-connect-reject'||mode==='hosted-blocked',negative=mode.startsWith('account')||mode.startsWith('chain');let completedCookie=null,releaseComplete;
    const completion=new Promise(resolve=>releaseComplete=resolve);let notifyComplete;
    const completeReached=new Promise(resolve=>notifyComplete=resolve);
    const context=await browser.newContext();const page=await context.newPage();
    if(mode.startsWith('timeout'))await page.clock.install();
    let completeCalls=0;
    await context.route(`${issuer}/**`,async route=>{const url=new URL(route.request().url());if(url.pathname==='/sso/browser.js')return route.fulfill({body:(mode==='pair-race-cancel'?pairRaceFixture:pairFixture).outputFiles[0].text,contentType:'text/javascript'});if(url.pathname.endsWith('/complete'))completeCalls++;const response=await route.fetch({url:`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`,maxRedirects:0,timeout:5000});
      if(mode.endsWith('-complete')&&url.pathname.endsWith('/complete')){completedCookie=response.headers()['set-cookie'].split(';')[0];notifyComplete();await Promise.race([completion,new Promise(resolve=>setTimeout(resolve,5000))]);}
      await route.fulfill({response}).catch(()=>{});
    });
    await context.route('https://finance.ynxweb4.com/**',route=>route.fulfill({body:'Returned to Finance'}));
    await context.route('https://wallet.ynxweb4.com/**',route=>route.fulfill({contentType:'text/html',body:hostedPage(mode)}));
    await context.exposeFunction('qaApproval',challenge=>({challengeId:challenge.challengeId,...identity,walletSignature:bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,identity.account,identity.accountPublicKey))),hexToBytes(key),{prehash:false,format:'compact',lowS:true}))}));
    await page.addInitScript(({account,mode})=>{
      window.qaPairAccount=account;window.qaPairMode=mode;if(mode==='hosted-blocked')window.open=()=>null;
      const listeners=new Map(),emit=(event,value)=>{for(const listener of listeners.get(event)??[])listener(value);};
      let chain=mode==='switch-4902'?'0x1':'0x1917',known=mode!=='switch-4902';window.qaEmit=emit;
      window.qaCalls=[];window.ethereum={isYNXWallet:true,providerInfo:{rdns:'com.ynx.wallet'},on(event,listener){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(listener);},removeListener(event,listener){listeners.get(event)?.delete(listener);},async request({method,params}){window.qaCalls.push(method);
        if(mode==='timeout-rpc'&&method==='ynx_requestCentralBrowserSignIn'||mode==='timeout-connect'&&method==='eth_requestAccounts'||mode==='timeout-accountread'&&method==='eth_accounts'){const late=method==='ynx_requestCentralBrowserSignIn'?await window.qaApproval(params[0]):[account];return new Promise(resolve=>window.qaRelease=()=>resolve(late));}
        if(method==='eth_requestAccounts'){emit('connect',{chainId:chain});emit('accountsChanged',[account]);emit('chainChanged',chain);return [account];}if(method==='eth_accounts')return [account];if(method==='eth_chainId')return chain;
        if(method==='wallet_switchEthereumChain'){if(!known)throw Object.assign(new Error('unknown chain'),{code:4902});chain='0x1917';emit('chainChanged',chain);return null;}
        if(method==='wallet_addEthereumChain'){known=true;return null;}
        if(method==='ynx_requestCentralBrowserSignIn'){if(mode==='reject-string')throw Object.assign(new Error('private-qa-marker'),{code:'USER_REJECTED'});const result=await window.qaApproval(params[0]);if(mode==='account-rpc')emit('accountsChanged',['0x'+'2'.repeat(40)]);return result;}throw new Error('unsupported');}};
    },{account:evmAddressFromYNX(identity.account),mode});
    const state=token(),verifier=token(),query=new URLSearchParams({clientId:'ynx-finance-v1-sso-v1',origin:'https://finance.ynxweb4.com',redirectUri:'https://finance.ynxweb4.com/sso/callback',state,codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256'});
    await page.goto(`${issuer}/v2/browser-sessions/authorize?${query}`);
    assert.deepEqual(await page.evaluate(()=>window.qaCalls),[]);
    if(mode==='expired-cancel'){await context.clearCookies();await page.click('#cancel');await page.waitForSelector('#return-product:not([hidden])');assert.equal(await page.locator('#status').getAttribute('data-error-code'),'SSO_CSRF_MISMATCH');assert.equal(await page.locator('#status').getAttribute('data-phase'),'server-cancel');assert.match(await page.locator('#status').innerText(),/not confirmed/);assert.equal(await page.locator('#cancel').isDisabled(),true);assert.equal(completeCalls,0);await page.click('#return-product');await page.waitForURL('https://finance.ynxweb4.com/sso/callback?**');const returned=new URL(page.url());assert.equal(returned.searchParams.get('state'),state);assert.equal(returned.searchParams.get('error'),'access_denied');assert.equal(returned.searchParams.has('code'),false);await context.close();continue;}
    if(mode.startsWith('hosted')){await page.click('#hosted');
      if(mode==='hosted-blocked'||mode==='hosted-connect-reject'){await page.waitForFunction(()=>document.querySelector('#status').dataset.errorCode===('USER_REJECTED')||document.querySelector('#status').dataset.errorCode==='HOSTED_POPUP_BLOCKED');assert.equal(completeCalls,0);await page.click('#cancel');}
      else{await page.waitForFunction(()=>!document.querySelector('#approve').disabled);assert.equal(completeCalls,0);await page.click('#approve');if(mode==='hosted-reject'){await page.waitForFunction(()=>document.querySelector('#status').dataset.errorCode==='USER_REJECTED');assert.equal(completeCalls,0);await page.click('#cancel');}}
    }else if(mode.startsWith('pair')){
      if(mode==='pair-error'){await page.click('#pair');await page.waitForFunction(()=>document.querySelector('#status').dataset.errorCode==='YNX_PAIR_TIMEOUT');assert.equal(await page.locator('#status').getAttribute('data-phase'),'pair-initialize');assert.equal((await page.locator('body').innerText()).includes('private-qa-marker'),false);assert.equal(completeCalls,0);await context.close();continue;}
      await page.click('#pair');if(mode==='pair-race-cancel'){await page.waitForFunction(()=>document.querySelector('#pair-request canvas').width===240);await page.click('#wallet-choices [data-wallet-index="0"]');await page.click('#pair');await page.waitForFunction(()=>window.qaRaceRejects.length===2&&document.querySelector('#pair-request canvas').width===240);await page.evaluate(()=>window.qaRaceRejects[0]());await page.waitForTimeout(50);assert.equal(await page.locator('#pair-open').isVisible(),true);assert.equal(await page.locator('#pair-request').isVisible(),true);assert.equal(await page.locator('#pair').isDisabled(),true);assert.equal(await page.locator('#status').getAttribute('data-phase'),'pair-approval');assert.equal(completeCalls,0);await page.click('#cancel');}else if(mode==='pair-wait-cancel'){await page.waitForFunction(()=>window.qaPairCalls?.includes('connect'));assert.equal(await page.locator('#pair-request').isVisible(),false);assert.equal(await page.locator('#pair-open').isVisible(),false);assert.equal(await page.locator('#pair').isDisabled(),true);assert.match(await page.locator('#status').innerText(),/Opening a mobile/);assert.equal(completeCalls,0);await page.click('#cancel');}else{await page.waitForFunction(()=>document.querySelector('#pair-request canvas').width===240);
      assert.equal(await page.locator('#pair-open').isVisible(),true);assert.equal(await page.locator('#pair').isDisabled(),true);assert.equal(await page.locator('#wallet').isVisible(),false);assert.equal(await page.locator('#wallet-choices').isVisible(),true);
      assert.equal(await page.evaluate(()=>{const url=new URL(document.querySelector('#pair-open').href);return url.protocol==='ynxwallet:'&&url.hostname==='wc'&&[...url.searchParams.keys()].join(',')==='uri'&&url.searchParams.get('uri').startsWith('wc:');}),true);
      assert.deepEqual(await page.evaluate(()=>window.qaPairCalls),['connect']);assert.equal(completeCalls,0);
      if(mode==='pair-cancel'){await page.click('#cancel');await page.evaluate(()=>window.qaPairApprove());}
      else{await page.evaluate(()=>window.qaPairApprove());await page.waitForFunction(()=>!document.querySelector('#approve').disabled);assert.equal(await page.locator('#pair-request').isHidden(),true);assert.equal(await page.evaluate(()=>document.querySelector('#pair-open').getAttribute('href')===null),true);await page.click('#approve');}}
    }else if(mode==='cancel')await page.click('#cancel');else{await page.click('#wallet-choices [data-wallet-index="0"]');await page.click('#approve');
      if(mode==='reject-string'){await page.waitForFunction(()=>document.querySelector('#status').dataset.errorCode==='USER_REJECTED');assert.match(await page.locator('#status').innerText(),/declined/);assert.equal((await page.locator('body').innerText()).includes('private-qa-marker'),false);assert.equal(completeCalls,0);await page.click('#cancel');}
      if(mode.endsWith('-complete')){await completeReached;if(mode==='cancel-complete')await page.click('#cancel');else{await page.evaluate(mode=>window.qaEmit(mode==='account-complete'?'accountsChanged':'chainChanged',mode==='account-complete'?['0x'+'2'.repeat(40)]:'0x1'),mode);releaseComplete();}}}
    if(mode.startsWith('timeout')){await page.waitForFunction(()=>typeof window.qaRelease==='function');await page.clock.fastForward(30001);await page.waitForSelector('#restart:not([hidden])');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('request timed out'));
      await page.evaluate(async()=>{window.qaRelease();await Promise.resolve();await Promise.resolve()});assert.equal(completeCalls,0);assert.equal(new URL(page.url()).origin,issuer);
      await page.click('#restart');await page.waitForURL('https://finance.ynxweb4.com/sso/callback?**');assert.equal(new URL(page.url()).searchParams.get('error'),'access_denied');assert.equal(completeCalls,0);await context.close();continue;
    }
    if(negative){await page.waitForFunction(()=>document.getElementById('status').textContent.includes('context changed'));
      assert.equal(new URL(page.url()).origin,issuer);
      if(completedCookie){const response=await fetch(`http://127.0.0.1:${server.address().port}/v2/browser-sessions/status`,{headers:{cookie:completedCookie}});assert.equal(response.status,401);}
      await context.close();continue;
    }
    await page.waitForURL('https://finance.ynxweb4.com/sso/callback?**',{timeout:10000});
    const result=new URL(page.url());assert.equal(result.searchParams.get('state'),state);
    assert.equal(result.searchParams.has('code'),!cancel);assert.equal(result.searchParams.get('error'),cancel?'access_denied':null);
    if(mode==='cancel-complete'){releaseComplete();const response=await fetch(`http://127.0.0.1:${server.address().port}/v2/browser-sessions/status`,{headers:{cookie:completedCookie}});assert.equal(response.status,401);}
    if(!cancel){const response=await fetch(`http://127.0.0.1:${server.address().port}/v2/browser-sessions/token`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientId:'ynx-finance-v1-sso-v1',code:result.searchParams.get('code'),codeVerifier:verifier,origin:'https://finance.ynxweb4.com',redirectUri:'https://finance.ynxweb4.com/sso/callback',state})});
      // The wire is canonical; key order above is deliberately lexicographic.
      assert.equal(response.status,200);const grant=await response.json();assert.equal(grant.identity.account,identity.account);
      if(mode==='approve'){
        await page.goto(`${issuer}/sso/session`);await page.waitForFunction(()=>!document.getElementById('global-logout').disabled);
        await page.click('#global-logout');await page.waitForFunction(()=>document.getElementById('status').textContent==='Signed out of all YNX products.');
        const introspected=await fetch(`http://127.0.0.1:${server.address().port}/v2/browser-sessions/introspect`,{method:'POST',headers:{'content-type':'application/json'},body:canonicalJSON({clientId:'ynx-finance-v1-sso-v1',grantToken:grant.grantToken})});assert.equal(introspected.status,401);
        await page.reload();await page.waitForFunction(()=>document.getElementById('status').textContent==='You are signed out.');assert.equal(await page.locator('#global-logout').isDisabled(),true);
      }
    }
    await context.close();
  }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
