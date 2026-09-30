import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {createServer} from 'node:http';
import {chmod,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {AUTHORITY_V2_REPOSITORY,AUTHORITY_V2_URLS,authorityV2SigningMessage} from '../../../sdk/js/endpoint-authority-v2.js';
import {prepareAuthorityV2Draft} from '../../../scripts/ops/endpoint-authority-v2.mjs';
import {ProductSessionGatewayNodeHost} from '../../../packages/wallet-auth/src/product-session-gateway-node-host.js';
import {signProductSessionApproval,createProductSessionReturnURL,parseProductSessionWalletURL,walletIdentity,evmAddressFromYNX} from '../../../packages/wallet-auth/src/index.js';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

// All HTTP responses below come from a real loopback NodeHost or the actual
// Finance Web files. Only the transport socket is relayed: browser URLs retain
// their registered HTTPS origins. This is local QA, never installed/public proof.
const root=fileURLToPath(new URL('../../../',import.meta.url));
const web=resolve(root,'apps/finance/web');
const financeOrigin='https://finance.ynxweb4.com';
const gatewayOrigin='https://wallet-auth.ynxweb4.com';
const registry=JSON.parse(await readFile(new URL('../../../packages/wallet-auth/product-session-registry.json',import.meta.url)));
const sha=value=>createHash('sha256').update(value).digest('hex');
const iso=value=>new Date(value).toISOString();

async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`}
async function close(server){await new Promise(resolve=>server.close(resolve))}
function runGoVerifier(environment){
  return new Promise((resolve,reject)=>{
    const child=spawn('go',['test','./internal/finance','-run','^TestLocalNodeHostProductSessionBridge$','-count=1'],{cwd:root,env:{...process.env,...environment},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Finance Go v2 verifier timed out'));},60_000);
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>16_384)stdout=stdout.slice(-16_384)});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>16_384)stderr=stderr.slice(-16_384)});
    child.on('error',error=>{clearTimeout(timer);reject(error)});
    child.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr})});
  });
}
async function startGoBrowserServer(gateway){
  const child=spawn('go',['test','./internal/finance','-run','^TestLocalNodeHostProductSessionBridge$','-count=1','-v'],{cwd:root,env:{...process.env,YNX_FINANCE_QA_GATEWAY_LOOPBACK:gateway,YNX_FINANCE_QA_PROOF_HEADER:'qa-server-mode-no-proof',YNX_FINANCE_QA_ACCOUNT:walletIdentity('1'.padStart(64,'0')).account,YNX_FINANCE_QA_SERVE_BROWSER:'yes'},stdio:['ignore','pipe','pipe']});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',status=>resolve(status))});
  let bytes='';
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('isolated Finance Go server startup timed out'))},15_000);
    child.stdout.on('data',chunk=>{bytes=(bytes+chunk.toString()).slice(-16_384);const match=bytes.match(/FINANCE_QA_LISTEN=(http:\/\/127\.0\.0\.1:[0-9]+)/u);if(match){clearTimeout(timer);resolve(match[1])}});
    child.on('close',()=>{clearTimeout(timer);reject(new Error('isolated Finance Go server ended before readiness'))});
  });
  return {base,async close(){await fetch(`${base}/__qa_stop`,{method:'POST'});assert.equal(await done,0)}};
}
function signedQAConfig(){
  const now=Date.now(),keys=generateKeyPairSync('ed25519');
  const source={repository:AUTHORITY_V2_REPOSITORY,commit:'1'.repeat(40),tree:'2'.repeat(40)};
  const consumer={consumerId:'ynx-finance-v1',origin:financeOrigin,minimumClientVersion:'1.0.0'};
  const trustRoot={schemaVersion:'ynx-endpoint-authority-trust/v2',authorityId:'ynx-testnet-endpoints',rootVersion:1,chainId:6423,anchor:{rootVersion:1,sequence:0,payloadSha256:'0'.repeat(64)},keys:[{keyId:'isolated-finance-qa',algorithm:'Ed25519',publicKeyBase64url:keys.publicKey.export({format:'jwk'}).x,notBefore:iso(now-60_000),notAfter:iso(now+3_600_000),revoked:false}],consumers:[{...consumer,endpoints:['walletGateway'],products:['finance']}],maxValiditySeconds:3600};
  const observation=url=>({url,httpStatus:200,bodySha256:sha('{}'),observedAt:iso(now-1000),tlsVerified:true,directDNS:true});
  const endpoints=Object.fromEntries(Object.entries(AUTHORITY_V2_URLS).map(([name,url])=>[name,{url,status:'PENDING',evidence:null}]));
  endpoints.walletGateway={url:gatewayOrigin,status:'VERIFIED',evidence:{health:observation(`${gatewayOrigin}/health`),version:observation(`${gatewayOrigin}/version`),source,chainId:6423,receiptSha256:'a'.repeat(64)}};
  const manifest=prepareAuthorityV2Draft({schemaVersion:'2.0.0',authorityId:'ynx-testnet-endpoints',manifestVersion:'2.0.0.1',sequence:1,previousPayloadSha256:'0'.repeat(64),environment:'testnet',chainId:6423,cosmosChainId:'ynx_6423-1',asset:'YNXT',issuedAt:iso(now-1000),expiresAt:iso(now+600_000),issuerSource:source,consumers:[consumer],endpoints,products:{finance:{status:'VERIFIED',evidence:{origin:financeOrigin,source,observedAt:iso(now-1000),receiptSha256:'b'.repeat(64),registrySha256:'c'.repeat(64),callbackContractSha256:'d'.repeat(64),currentPublicSourceAccepted:true,productSessionAccepted:true},officialSandboxVerified:false,providerVerified:false,productionApproved:false}},policy:{mainnetEnabled:false,automaticWriteRetry:false,automaticFailover:false,clientRenewal:false},integrity:{}},'isolated-finance-qa');
  manifest.integrity.signature=sign(null,Buffer.from(authorityV2SigningMessage(manifest,manifest.integrity.keyId)),keys.privateKey).toString('base64url');
  return {schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',trustRoot,manifest,serverCheckpoint:{rootVersion:1,sequence:manifest.sequence,payloadSha256:manifest.integrity.payloadSha256},trustedTimeMs:now};
}
async function relay(route,base){
  const request=route.request(),target=`${base}${new URL(request.url()).pathname}${new URL(request.url()).search}`;
  const headers={...request.headers()};delete headers.host;delete headers['content-length'];delete headers['accept-encoding'];
  const response=await fetch(target,{method:request.method(),headers,body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer(),redirect:'manual'});
  const returned=Object.fromEntries(response.headers);delete returned['transfer-encoding'];delete returned['content-encoding'];
  await route.fulfill({status:response.status,headers:returned,body:Buffer.from(await response.arrayBuffer())});
}

for(const transport of ['native-callback','selected-provider','selected-provider-context-change','selected-login','selected-login-rejected'])test(`local QA ${transport} reaches durable Gateway NodeHost and real Finance Go v2 verifier`,async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ynx-finance-local-v2-'));await chmod(directory,0o700);
  const statePath=join(directory,'gateway-state.json');
  const host=new ProductSessionGatewayNodeHost(registry,{statePath,now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString('base64url')});
  const gateway=createServer(host.handler());
  const config=signedQAConfig();
  let go,failOverview=false,approvalCount=0;
  const finance=createServer(async(request,response)=>{
    const path=new URL(request.url,'http://qa').pathname;
    if(go&&path.startsWith('/api/')&&!path.includes('endpoint-authority')){
      if(failOverview&&path==='/api/overview'){response.writeHead(503,{'content-type':'application/json'});response.end('{"code":"qa-temporary-overview-unavailable"}');return}
      const upstream=await fetch(`${go.base}${request.url}`,{method:request.method,headers:request.headers});
      response.writeHead(upstream.status,Object.fromEntries(upstream.headers));response.end(Buffer.from(await upstream.arrayBuffer()));return;
    }
    if(path==='/api/endpoint-authority/v2/config'){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({...config,trustedTimeMs:Date.now()}));return}
    if(path==='/health'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({ok:true,chainId:'ynx_6423-1',portfolio:'read-only'}));return}
    const file=path==='/'||path==='/wallet-auth/callback'?'index.html':path.slice(1),full=resolve(web,file);
    if(!full.startsWith(`${web}${sep}`)||!/^[-\w./]+$/u.test(file)){response.writeHead(404);response.end();return}
    try{const bytes=await readFile(full);response.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});response.end(bytes)}catch{response.writeHead(404);response.end()}
  });
  let browser;
  try{
    const gatewayBase=await listen(gateway),financeBase=await listen(finance);
    if(transport==='selected-login')go=await startGoBrowserServer(gatewayBase);
    browser=await chromium.launch(await financeBrowserLaunchOptions());
    const context=await browser.newContext();
    await context.route(`${financeOrigin}/**`,route=>relay(route,financeBase));
    await context.route(`${gatewayOrigin}/**`,route=>relay(route,gatewayBase));
    const page=await context.newPage();
    await page.addInitScript(()=>{window.qaStateEvents=[];window.addEventListener('ynx-finance-private-state',event=>window.qaStateEvents.push({status:event.detail.status,revision:event.detail.revision,code:document.querySelector('#private-state')?.title}));});
    let lateCallback;
    if(transport.startsWith('selected-')){
      await page.exposeFunction('approveFinanceLocalQA',url=>{
        approvalCount++;
        const pending=parseProductSessionWalletURL(registry,url),at=new Date();
        const approval=signProductSessionApproval(registry,pending,{accountSecret:'1'.padStart(64,'0'),scopes:pending.scopes,expiresAt:pending.expiresAt},at);
        lateCallback=createProductSessionReturnURL(registry,pending,transport==='selected-login-rejected'?{result:'rejected',reason:'user_rejected'}:{result:'approved',approval},at);
        return {version:2,returnUrl:lateCallback};
      });
      await page.addInitScript(({account,changed})=>{
        const listeners=new Map();
        const provider={isYNXWallet:true,__ynxCompanion:true,on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)},removeListener(name,fn){listeners.get(name)?.delete(fn)},request:async({method})=>method==='eth_chainId'?'0x1917':['eth_accounts','eth_requestAccounts'].includes(method)?[account]:method==='wallet_switchEthereumChain'?null:Promise.reject(new Error('QA method forbidden')),async requestProductSessionV2(url){const response=await window.approveFinanceLocalQA(url);if(changed)for(const fn of listeners.get('accountsChanged')||[])fn(['0x'+'c'.repeat(40)]);return response}};
        const info={rdns:'com.ynx.wallet',name:'YNX Wallet',uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
        window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info,provider}})));
      },{account:evmAddressFromYNX(walletIdentity('1'.padStart(64,'0')).account),changed:transport==='selected-provider-context-change'});
    }
    const browserErrors=[],requests=[];
    page.on('pageerror',error=>browserErrors.push(error.message.slice(0,160)));
    page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/')||url.pathname.includes('product-sessions'))requests.push(`${url.pathname}:${response.status()}`)});
    await page.goto(financeOrigin);
    if(transport.startsWith('selected-login')){
      await page.goto(`${financeOrigin}/#planning`);
      await page.locator('#guest-gate a[href="#wallet-connect"]').click();
      await page.locator('#picker-ynx').click();
      if(transport==='selected-login-rejected'){
        await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='disconnected',null,{timeout:6000}).catch(async error=>{throw new Error(JSON.stringify({browserErrors,requests,state:await page.evaluate(()=>({standard:window.YNXFinanceWallet.getStandardWalletState().status,private:window.YNXFinanceWallet.getPrivateState().status,code:document.querySelector('#private-state').title,notice:document.querySelector('#notice').textContent}))}),{cause:error})});
        assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');
        assert.equal(host.snapshot().authority.sessions.length,0);
        assert.equal(await page.evaluate(()=>location.hash),'#planning');
        await context.close();return;
      }
      await page.waitForFunction(()=>document.querySelector('#workspace').dataset.dataState==='ready'&&document.querySelector('#account').textContent.startsWith('ynx1'),null,{timeout:6000}).catch(async error=>{throw new Error(JSON.stringify({browserErrors,requests,state:await page.evaluate(()=>({standard:window.YNXFinanceWallet.getStandardWalletState().status,private:window.YNXFinanceWallet.getPrivateState().status,code:document.querySelector('#private-state').title,notice:document.querySelector('#notice').textContent}))}),{cause:error})});
      const view=await page.evaluate(()=>({account:document.querySelector('#account').textContent,private:window.YNXFinanceWallet.getPrivateState().status,code:document.querySelector('#private-state').title,notice:document.querySelector('#notice').textContent}));
      assert.equal(view.account,walletIdentity('1'.padStart(64,'0')).account,JSON.stringify(view));
      assert.equal(await page.evaluate(()=>location.hash),'#planning');
      assert.equal(await page.locator('#planning').evaluate(node=>node.classList.contains('active-view')),true);
      // A late completion owns its original intent and context, never a newer
      // request created while its read was unresolved (including cancellation).
      assert.deepEqual(await page.evaluate(async()=>{
        const originalContext=state.context,originalOverview=state.overview;
        const oldIntent={target:'assets'},newIntent={target:'planning'};
        loginIntent=oldIntent;
        let resolveOld;const oldRead=new Promise(resolve=>{resolveOld=resolve});
        const completion=oldRead.then(()=>completeLoginTarget(oldIntent,originalContext));
        clearLoginIntent();state.context++;loginIntent=newIntent;
        resolveOld();await completion;
        const isolated=loginIntent===newIntent&&location.hash==='#planning';
        // Same object cannot authorize navigation against a different owner.
        state.overview={portfolio:{account:'ynx1different-qa-subject'}};
        completeLoginTarget(newIntent,state.context);
        const ownerBound=loginIntent===newIntent&&location.hash==='#planning';
        // Production epochs are monotonic; never roll back around concurrent
        // module reads that still own the original context.
        state.overview=originalOverview;clearLoginIntent();
        return {isolated,ownerBound};
      }),{isolated:true,ownerBound:true});
      const initialSession=await page.evaluate(()=>window.YNXFinanceWallet.session().sessionId);
      await page.locator('#budget-form input[name="name"]').fill('Preserved local draft');
      failOverview=true;
      await page.evaluate(()=>document.querySelector('#refresh').click());
      await page.waitForFunction(()=>document.querySelector('#workspace').dataset.dataState==='unavailable');
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getPrivateState().status),'connected');
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.session().sessionId),initialSession);
      assert.equal(await page.locator('#workspace-data-warning').isVisible(),true);
      assert.equal(await page.locator('#budget-form button').isDisabled(),true);
      assert.equal(await page.locator('#budget-form input[name="name"]').inputValue(),'Preserved local draft');
      failOverview=false;
      await page.locator('#workspace-data-retry').click();
      await page.waitForFunction(()=>document.querySelector('#workspace').dataset.dataState==='ready');
      const restoredView=await page.evaluate(()=>({account:document.querySelector('#account').textContent,private:window.YNXFinanceWallet.getPrivateState().status,code:document.querySelector('#private-state').title,events:window.qaStateEvents}));
      assert.equal(restoredView.account,walletIdentity('1'.padStart(64,'0')).account,JSON.stringify({restoredView,requests}));
      assert.equal(approvalCount,1);
    }else if(transport.startsWith('selected-provider')){
      await page.locator('#connect-ynx').click();
      await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==='connected');
    }
    if(!transport.startsWith('selected-login'))await page.locator('#wallet-more > summary').click();
    if(transport==='selected-provider-context-change'){
      await page.evaluate(()=>window.YNXFinanceWallet.beginPrivate());
      assert.notEqual(await page.evaluate(()=>window.YNXFinanceWallet.getPrivateState().status),'connected');
      assert.equal(host.snapshot().authority.sessions.length,0);
      assert.ok(lateCallback);
      const pendingCount=await page.evaluate(()=>new Promise((resolve,reject)=>{
        const open=indexedDB.open('ynx-product-session-web-v2');open.onerror=()=>reject(new Error('QA state inaccessible'));
        open.onsuccess=()=>{const db=open.result,read=db.transaction('state').objectStore('state').getAll();read.onerror=()=>reject(new Error('QA state unreadable'));read.onsuccess=()=>{const count=read.result.flatMap(record=>Object.keys(record.values)).filter(key=>key.endsWith(':pending')).length;db.close();resolve(count)}};
      }));
      assert.equal(pendingCount,0,'canonical SDK pending request must be cleared before accepting a cold callback');
      await page.goto(lateCallback);
      await page.waitForFunction(()=>['disconnected','guest','degraded'].includes(window.YNXFinanceWallet.getPrivateState().status));
      assert.notEqual(await page.evaluate(()=>window.YNXFinanceWallet.getPrivateState().status),'connected');
      assert.equal(host.snapshot().authority.sessions.length,0);
      await context.close();return;
    }
    if(!transport.startsWith('selected-login'))await page.locator('#private-begin').click();
    await page.waitForFunction(()=>{
      const state=window.YNXFinanceWallet.getPrivateState();
      return state.route?.request||state.status==='connected'||state.status==='degraded';
    },null,{timeout:12_000});
    const beginStatus=await page.evaluate(()=>({status:window.YNXFinanceWallet.getPrivateState().status,code:document.querySelector('#private-state')?.title||''}));
    assert.notEqual(beginStatus.status,'degraded',`Private begin degraded: ${JSON.stringify({beginStatus,browserErrors,requests})}`);
    if(transport==='native-callback'){
    const pending=await page.evaluate(()=>window.YNXFinanceWallet.getPrivateState().route.request);
    assert.equal(pending.productId,'finance');
    const approvedAt=new Date(),approval=signProductSessionApproval(registry,pending,{accountSecret:'1'.padStart(64,'0'),scopes:pending.scopes,expiresAt:pending.expiresAt},approvedAt);
    const callback=createProductSessionReturnURL(registry,pending,{result:'approved',approval},approvedAt);
    await page.goto(callback);
    }
    await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='connected');
    const privateState=await page.evaluate(()=>({standard:window.YNXFinanceWallet.getStandardWalletState().status,privateStatus:window.YNXFinanceWallet.getPrivateState().status,account:window.YNXFinanceWallet.getPrivateState().session.account}));
    assert.equal(privateState.standard,transport.startsWith('selected-')?'connected':'disconnected');assert.equal(privateState.privateStatus,'connected');
    const proof=await page.evaluate(()=>window.YNXFinanceWallet.requireProof('finance.portfolio.read'));
    assert.ok(proof.proofHeader);
    const child=await runGoVerifier({YNX_FINANCE_QA_GATEWAY_LOOPBACK:gatewayBase,YNX_FINANCE_QA_PROOF_HEADER:proof.proofHeader,YNX_FINANCE_QA_ACCOUNT:privateState.account});
    assert.equal(child.status,0,`Finance Go v2 verifier failed: ${child.stderr||child.stdout}`);
    assert.equal(host.snapshot().authority.sessions.length,1);
    assert.ok(host.snapshot().consumedProofs.length>=1);
    await context.close();
  }finally{await browser?.close();await go?.close();if(gateway.listening)await close(gateway);if(finance.listening)await close(finance);await rm(directory,{recursive:true,force:true})}
});
