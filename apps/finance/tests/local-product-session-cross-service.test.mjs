import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
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
import {centralBrowserConsentSignBytes} from '../../../packages/wallet-auth/src/central-browser-session-contract.js';
import {canonicalJSON} from '../../../packages/wallet-auth/src/canonical.js';
import {secp256k1} from '../../../packages/wallet-auth/node_modules/@noble/curves/secp256k1.js';
import {sha256} from '../../../packages/wallet-auth/node_modules/@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,utf8ToBytes} from '../../../packages/wallet-auth/node_modules/@noble/hashes/utils.js';

// All HTTP responses below come from a real loopback NodeHost or the actual
// Finance Web files. Only the transport socket is relayed: browser URLs retain
// their registered HTTPS origins. This is local QA, never installed/public proof.
const root=fileURLToPath(new URL('../../../',import.meta.url));
const web=resolve(root,'apps/finance/web');
const financeOrigin='https://finance.ynxweb4.com';
const gatewayOrigin='https://wallet-auth.ynxweb4.com';
const hostedWalletDist=process.env.YNX_FINANCE_HOSTED_WALLET_DIST;
const sourceWalletAuth=(await build({entryPoints:[resolve(web,'wallet-auth-entry.js')],bundle:true,write:false,platform:'browser',target:'es2022'})).outputFiles[0].text;
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
async function startGoBrowserServer(gateway,centralSSO=false){
  const child=spawn('go',['test','./internal/finance','-run','^TestLocalNodeHostProductSessionBridge$','-count=1','-v'],{cwd:root,env:{...process.env,YNX_FINANCE_QA_GATEWAY_LOOPBACK:gateway,YNX_FINANCE_QA_PROOF_HEADER:'qa-server-mode-no-proof',YNX_FINANCE_QA_ACCOUNT:walletIdentity('1'.padStart(64,'0')).account,YNX_FINANCE_QA_SERVE_BROWSER:'yes',YNX_FINANCE_QA_CENTRAL_SSO:centralSSO?'yes':'no'},stdio:['ignore','pipe','pipe']});
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

for(const product of ['finance','exchange'])test(`quiet identity recovery resumes after private bootstrap settles (${product}, actual Gateway and Go)`,{timeout:25000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ynx-sso-private-settle-'));await chmod(directory,0o700);
  const host=new ProductSessionGatewayNodeHost(registry,{statePath:join(directory,'gateway.json'),now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString('base64url'),centralBrowser:true});
  const gateway=createServer(host.handler()),origin=product==='finance'?financeOrigin:'https://exchange.ynxweb4.com';
  let go,browser,releasePrivate,privateHeldResolve,releaseConfig,configHeldResolve;
  const privateGate=new Promise(resolve=>releasePrivate=resolve),privateHeld=new Promise(resolve=>privateHeldResolve=resolve);
  const configGate=new Promise(resolve=>releaseConfig=resolve),configHeld=new Promise(resolve=>configHeldResolve=resolve);let heldPrivate=false,configCount=0,identityCompletions=0;
  const trace=[];
  try{
    const base=await listen(gateway);
    if(product==='finance')go=await startGoBrowserServer(base,true);
    else{
      const child=spawn('go',['test','./internal/exchangeproduct','-run','^TestLocalNodeHostExchangeSSOBridge$','-count=1','-v'],{cwd:root,env:{...process.env,YNX_EXCHANGE_QA_CENTRAL_LOOPBACK:base},stdio:['ignore','pipe','pipe']});
      const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});
      const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('Exchange SSO QA startup deadline'))},15000);child.stdout.on('data',chunk=>{output=(output+chunk).slice(-8192);const match=output.match(/EXCHANGE_SSO_QA_LISTEN=(http:\/\/127\.0\.0\.1:[0-9]+)/u);if(match){clearTimeout(timer);resolve(match[1])}});child.on('close',()=>{clearTimeout(timer);reject(new Error('Exchange SSO QA ended before readiness'))});});
      go={base:url,async close(){await fetch(url+'/__qa_stop',{method:'POST',signal:AbortSignal.timeout(5000)});assert.equal(await done,0)}};
    }
    browser=await chromium.launch(await financeBrowserLaunchOptions());const context=await browser.newContext(),page=await context.newPage();
    await context.addInitScript(({origin,product})=>{if(location.origin===origin&&product==='finance')localStorage.setItem('ynx.finance.browser-private.9840ef87.wallet-auth.attempted','yes');},{origin,product});
    const cdp=await context.newCDPSession(page);await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
    cdp.on('Fetch.requestPaused',async({requestId,request})=>{
      try{
        const url=new URL(request.url),row={origin:url.origin,path:url.pathname,prompt:url.searchParams.get('prompt'),status:null};trace.push(row);
        let response;
        if(url.origin===gatewayOrigin&&url.pathname==='/isolated-sso-qa')response=new Response('<!doctype html><title>Isolated Gateway browser</title>',{headers:{'content-type':'text/html'}});
        else{
          const selected=url.origin===origin?go.base:url.origin===gatewayOrigin?base:null;if(!selected)throw new Error('unregistered QA network');
          if(!heldPrivate&&(product==='finance'&&url.origin===origin&&url.pathname==='/api/endpoint-authority/v2/config'||product==='exchange'&&url.origin===gatewayOrigin&&url.pathname==='/v2/product-sessions/time')){heldPrivate=true;privateHeldResolve();await privateGate;}
          if(product==='exchange'&&url.origin===origin&&url.pathname==='/api/v1/sso/config'&&++configCount===2){configHeldResolve();await configGate;}
          const headers={...request.headers};for(const key of Object.keys(headers))if(['host','content-length','accept-encoding'].includes(key.toLowerCase()))delete headers[key];
          if(url.origin===origin&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/sso/')){
            const name=url.pathname==='/'?'index.html':url.pathname.slice(1),directory=resolve(root,product==='finance'?'apps/finance/web':'apps/exchange/web'),file=resolve(directory,name);if(!file.startsWith(directory+sep)||!/^[-\w./]+$/u.test(name))throw new Error('blocked QA file');
            // Optional immutable pre-fix counterfactual: only the consumer source
            // changes; real Gateway, cookies, PKCE and product APIs stay identical.
            const bytes=process.env.YNX_SSO_QA_BASELINE==='1'&&name==='app.js'?execFileSync('git',['show',`7e3232c7c33911b0ce27d032669bed66a690e1ec:apps/${product}/web/app.js`],{cwd:root}):await readFile(file);
            response=new Response(bytes,{headers:{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html'}});
          }else{
            const path=product==='exchange'&&url.origin===origin&&url.pathname.startsWith('/api/')?url.pathname.slice(4):url.pathname;
            response=await fetch(selected+path+url.search,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.postData,redirect:'manual',signal:AbortSignal.timeout(5000)});
          }
        }
        row.status=response.status;if(url.pathname==='/v2/browser-sessions/complete')identityCompletions++;
        const responseHeaders=[...response.headers].filter(([key])=>!['transfer-encoding','content-encoding','content-length','set-cookie'].includes(key)).map(([name,value])=>({name,value}));for(const value of response.headers.getSetCookie())responseHeaders.push({name:'set-cookie',value});
        await cdp.send('Fetch.fulfillRequest',{requestId,responseCode:response.status,responseHeaders,body:Buffer.from(await response.arrayBuffer()).toString('base64')});
      }catch{await cdp.send('Fetch.failRequest',{requestId,errorReason:'Failed'}).catch(()=>{});}
    });
    await page.goto(gatewayOrigin+'/isolated-sso-qa');
    const client=registry.products.find(value=>value.productId==='finance');
    const verifier=randomBytes(32).toString('base64url'),input={clientId:client.clientId+'-sso-v1',origin:financeOrigin,redirectUri:financeOrigin+'/sso/callback',state:randomBytes(32).toString('base64url'),codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256'};
    const boot=await page.evaluate(async()=>await(await fetch('/v2/browser-sessions/bootstrap')).json());
    const challenged=await page.evaluate(async({body,csrf})=>{const r=await fetch('/v2/browser-sessions/challenge',{method:'POST',headers:{'content-type':'application/json','x-ynx-browser-csrf':csrf},body});return {status:r.status,body:await r.json()};},{body:canonicalJSON(input),csrf:boot.csrfToken});assert.equal(challenged.status,200,challenged.body.error?.code);
    const identity=walletIdentity('1'.padStart(64,'0')),challenge=challenged.body.challenge;
    const walletSignature=bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,identity.account,identity.accountPublicKey))),hexToBytes('1'.padStart(64,'0')),{prehash:false,format:'compact',lowS:true}));
    const approved=await page.evaluate(async({body,csrf})=>{const r=await fetch('/v2/browser-sessions/complete',{method:'POST',headers:{'content-type':'application/json','x-ynx-browser-csrf':csrf},body});return r.status;},{body:canonicalJSON({challengeId:challenge.challengeId,...identity,walletSignature}),csrf:boot.csrfToken});assert.equal(approved,200);
    const firstAccount=page.waitForResponse(response=>new URL(response.url()).origin===origin&&new URL(response.url()).pathname===(product==='finance'?'/api/sso/account':'/api/v1/sso/account'));
    await page.goto(origin+'/#'+(product==='finance'?'planning':'assets'));await privateHeld;assert.equal((await firstAccount).status(),401);await (await firstAccount).finished();
    if(product==='exchange'&&process.env.YNX_SSO_QA_BASELINE==='1')await configHeld;
    releasePrivate();if(product==='exchange'){await configHeld;await page.waitForFunction(()=>!document.querySelector('#private-status')?.textContent?.startsWith('Verifying'),null,{timeout:5000});releaseConfig();}
    try{await page.waitForFunction(({product})=>{const id=product==='finance'?'#browser-signin-state':'#browser-identity-status';return document.querySelector(id)?.textContent?.startsWith('ynx1');},{product},{timeout:5000});}catch(error){console.error(JSON.stringify({product,trace,ui:await page.evaluate(()=>({identity:document.querySelector('#browser-identity-status')?.textContent,private:document.querySelector('#private-state')?.textContent,path:location.pathname}))}));throw error;}
    const actual=await page.evaluate(async path=>{const r=await fetch(path,{cache:'no-store'}),body=await r.json();return {status:r.status,account:body.account,scopes:body.scopes,privateWorkspaceAuthorized:body.privateWorkspaceAuthorized};},product==='finance'?'/api/sso/account':'/api/v1/sso/account');
    assert.equal(actual.status,200);assert.equal(actual.account,identity.account);assert.deepEqual(actual.scopes,['identity:read']);assert.equal(actual.privateWorkspaceAuthorized,false);
    assert.equal(identityCompletions,1);assert.equal(host.snapshot().authority.sessions.length,0);assert.equal(trace.filter(row=>row.origin===origin&&row.path==='/sso/start'&&row.prompt==='none').length,1);assert.equal(new URL(page.url()).hash,product==='finance'?'#planning':'#assets');
  }finally{releasePrivate?.();releaseConfig?.();await browser?.close();await go?.close();await close(gateway);await rm(directory,{recursive:true,force:true});}
});

for(const mode of ['delayed-config','completed-quiet','wallet-chooser'])test(`explicit Finance browser sign-in owns navigation (${mode}, real guest services)`,{timeout:20000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ynx-finance-sso-navigation-'));await chmod(directory,0o700);
  const host=new ProductSessionGatewayNodeHost(registry,{statePath:join(directory,'gateway.json'),now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString('base64url'),centralBrowser:true});
  const gateway=createServer(host.handler());let go,browser,releaseConfig,releaseStart;
  const configGate=new Promise(resolve=>releaseConfig=resolve),startGate=new Promise(resolve=>releaseStart=resolve);
  const trace=[];let configCount=0,quietHeldResolve,explicitHeldResolve;
  const quietHeld=new Promise(resolve=>quietHeldResolve=resolve),explicitHeld=new Promise(resolve=>explicitHeldResolve=resolve);
  try{
    const gatewayBase=await listen(gateway);go=await startGoBrowserServer(gatewayBase,true);
    browser=await chromium.launch(await financeBrowserLaunchOptions());const context=await browser.newContext(),page=await context.newPage();
    const cdp=await context.newCDPSession(page);await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
    cdp.on('Fetch.requestPaused',async({requestId,request})=>{
      try{
        const url=new URL(request.url),base=url.origin===financeOrigin?go.base:url.origin===gatewayOrigin?gatewayBase:null;
        if(!base){await cdp.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});return;}
        const record={path:url.pathname,prompt:url.searchParams.get('prompt'),status:null};trace.push(record);
        if(url.origin===financeOrigin&&url.pathname==='/api/sso/config'&&++configCount===2&&mode!=='completed-quiet'){quietHeldResolve();await configGate;}
        if(url.origin===financeOrigin&&url.pathname==='/sso/start'&&!url.searchParams.has('prompt')){explicitHeldResolve();await startGate;}
        const headers={...request.headers};for(const key of Object.keys(headers))if(['host','content-length','accept-encoding'].includes(key.toLowerCase()))delete headers[key];
        let response;
        if(url.origin===financeOrigin&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/sso/')){
          const file=url.pathname==='/'?'index.html':url.pathname.slice(1),full=resolve(web,file);
          if(!full.startsWith(`${web}${sep}`)||!/^[-\w./]+$/u.test(file))throw new Error('blocked');
          response=new Response(await readFile(full),{headers:{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}});
        }else response=await fetch(`${base}${url.pathname}${url.search}`,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.postData,redirect:'manual',signal:AbortSignal.timeout(5000)});
        record.status=response.status;
        const responseHeaders=[...response.headers].filter(([key])=>!['transfer-encoding','content-encoding','content-length','set-cookie'].includes(key)).map(([name,value])=>({name,value}));
        for(const value of response.headers.getSetCookie())responseHeaders.push({name:'set-cookie',value});
        await cdp.send('Fetch.fulfillRequest',{requestId,responseCode:response.status,responseHeaders,body:Buffer.from(await response.arrayBuffer()).toString('base64')});
      }catch{await cdp.send('Fetch.failRequest',{requestId,errorReason:'Failed'}).catch(()=>{});}
    });
    const quietCallback=mode==='completed-quiet'?page.waitForResponse(response=>new URL(response.url()).pathname==='/sso/callback'):null;
    await page.goto(`${financeOrigin}/#planning`);
    if(mode!=='completed-quiet')await quietHeld;
    else{await (await quietCallback).finished();await page.waitForURL(`${financeOrigin}/#planning`);await page.waitForFunction(()=>browserSSOEnabled);}
    if(mode==='wallet-chooser'){
      await page.locator('#wallet-entry').click();const response=page.waitForResponse(value=>new URL(value.url()).pathname==='/api/sso/config');releaseConfig();await (await response).finished();
      await page.evaluate(()=>Promise.resolve().then(()=>Promise.resolve()));assert.equal(new URL(page.url()).hash,'#planning');assert.equal(await page.locator('#wallet-picker').evaluate(dialog=>dialog.open),true);
      assert.equal(trace.some(value=>value.path==='/sso/start'),false);assert.equal(host.snapshot().authority.sessions.length,0);return;
    }
    await page.evaluate(()=>document.querySelector('#browser-signin-start').click());await explicitHeld;
    // The config body is delayed, not fabricated. Wait for that real fetch's
    // promise continuation while keeping the explicit document request pending.
    if(mode==='delayed-config'){const configResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sso/config');releaseConfig();await (await configResponse).finished();}
    releaseStart();await page.waitForURL(url=>url.origin===gatewayOrigin);await page.locator('#wallet').waitFor();
    assert.equal(trace.filter(value=>value.path==='/sso/start'&&value.prompt==='none').length,mode==='completed-quiet'?1:0,'late quiet config must not replace an explicit navigation');
    assert.equal(trace.findLast(value=>value.path==='/v2/browser-sessions/authorize')?.status,200);
    assert.equal(host.snapshot().authority.sessions.length,0);assert.equal(trace.some(value=>value.path==='/v2/browser-sessions/complete'||value.path==='/v2/browser-sessions/token'),false);
    // No Wallet method, identity approval or code redemption occurs in this QA.
  }finally{releaseConfig?.();releaseStart?.();await browser?.close();await go?.close();await close(gateway);await rm(directory,{recursive:true,force:true});}
});

for(const variant of ['native-callback','selected-provider','selected-provider-context-change','selected-login','selected-login-rejected','selected-login-revoke-rebegin','selected-login-expired-pending','selected-login-valid-pending','central-selected-login','hosted-provider'])test(`local QA ${variant} reaches durable Gateway NodeHost and real Finance Go v2 verifier`,{skip:variant==='hosted-provider'&&!hostedWalletDist&&'YNX_FINANCE_HOSTED_WALLET_DIST not supplied'},async t=>{
  const centralSSO=variant==='central-selected-login',transport=centralSSO?'selected-login':variant;
  const directory=await mkdtemp(join(tmpdir(),'ynx-finance-local-v2-'));await chmod(directory,0o700);
  const statePath=join(directory,'gateway-state.json');let gatewayClockOffset=variant==='selected-login-expired-pending'?-6*60_000:0,consentAction=variant.endsWith('-pending')?'transport-reject':'approve',approvalRequestNonces=[];
  const host=new ProductSessionGatewayNodeHost(registry,{statePath,now:()=>new Date(Date.now()+gatewayClockOffset),tokenFactory:()=>randomBytes(32).toString('base64url'),centralBrowser:centralSSO});
  const gatewayTrace=[],gatewayHandler=host.handler();let failNativeRevoke=false;
  const gateway=createServer((request,response)=>{response.once('finish',()=>gatewayTrace.push({method:request.method,path:new URL(request.url,'http://qa').pathname,status:response.statusCode}));if(failNativeRevoke&&new URL(request.url,'http://qa').pathname==='/v2/product-sessions/revoke'){response.writeHead(503,{'content-type':'application/json'});response.end('{"code":"QA_REVOKE_UNAVAILABLE"}');return;}return gatewayHandler(request,response)});
  const config=signedQAConfig();
  let go,failOverview=false,approvalCount=0,firstPrivateBatch=centralSSO,holdNativeRevoke=false,releaseNativeRevoke;
  const nativeRevokeRelease=new Promise(resolve=>releaseNativeRevoke=resolve);
  const firstPrivateReads=[];
  const finance=createServer(async(request,response)=>{
    const path=new URL(request.url,'http://qa').pathname;
    if(path==='/wallet-auth.js'){response.writeHead(200,{'content-type':'text/javascript'});response.end(sourceWalletAuth);return;}
    if(go&&(path.startsWith('/api/')&&!path.includes('endpoint-authority')||path.startsWith('/sso/'))){
      if(firstPrivateBatch&&request.headers['x-ynx-product-session-proof-v2']&&['/api/overview','/api/profile','/api/portfolio','/api/activity'].includes(path)){
        const released=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),3000);firstPrivateReads.push({path,resolve:()=>{clearTimeout(timer);resolve(true)}});if(firstPrivateReads.length===4){firstPrivateBatch=false;for(const read of firstPrivateReads)read.resolve();}});
        if(!released){response.writeHead(503,{'content-type':'application/json'});response.end('{"code":"QA_FIRST_READ_BARRIER_TIMED_OUT"}');return;}
      }
      if(failOverview&&path==='/api/overview'){response.writeHead(503,{'content-type':'application/json'});response.end('{"code":"qa-temporary-overview-unavailable"}');return}
      const upstream=await fetch(`${go.base}${request.url}`,{method:request.method,headers:request.headers,redirect:'manual',body:['GET','HEAD'].includes(request.method)?undefined:await new Promise(resolve=>{const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>resolve(Buffer.concat(chunks)))}),signal:AbortSignal.timeout(5000)});
      const returned=Object.fromEntries(upstream.headers),cookies=upstream.headers.getSetCookie();if(cookies.length)returned['set-cookie']=cookies;
      response.writeHead(upstream.status,returned);response.end(Buffer.from(await upstream.arrayBuffer()));return;
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
    if(transport.startsWith('selected-login')||transport==='hosted-provider')go=await startGoBrowserServer(gatewayBase,centralSSO);
    browser=await chromium.launch(await financeBrowserLaunchOptions());
    const context=await browser.newContext();
    const routeTrace=[];
    if(!centralSSO)await context.route('**/*',route=>{const url=new URL(route.request().url()),origin=url.origin;routeTrace.push({origin,path:url.pathname});return origin===financeOrigin?relay(route,financeBase):origin===gatewayOrigin?relay(route,gatewayBase):route.abort();});
    if(transport==='hosted-provider')await context.route('https://wallet.ynxweb4.com/hosted/**',async route=>{
      const path=new URL(route.request().url()).pathname.replace(/^\/hosted\//u,'')||'index.html';
      if(!['index.html','app.js','hosted-wallet.css','ynx-logo.png'].includes(path))return route.abort();
      return route.fulfill({status:200,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/html',body:await readFile(resolve(hostedWalletDist,path))});
    });
    const page=await context.newPage();
    if(centralSSO){
      // Playwright route interception covers only the first URL in this
      // cross-origin redirect chain. CDP Fetch pauses EVERY redirect hop so
      // this local QA never contacts a public product or Wallet Gateway.
      const cdp=await context.newCDPSession(page);await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
      cdp.on('Fetch.requestPaused',async({requestId,request})=>{
        try{const url=new URL(request.url),base=url.origin===financeOrigin?financeBase:url.origin===gatewayOrigin?gatewayBase:null;
          routeTrace.push({origin:url.origin,path:url.pathname});if(!base){await cdp.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});return;}
          if(holdNativeRevoke&&url.origin===gatewayOrigin&&url.pathname==='/v2/product-sessions/revoke')await Promise.race([nativeRevokeRelease,new Promise(resolve=>setTimeout(resolve,5000))]);
          const headers={...request.headers};for(const key of Object.keys(headers))if(['host','content-length','accept-encoding'].includes(key.toLowerCase()))delete headers[key];
          const response=await fetch(`${base}${url.pathname}${url.search}`,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.postData,redirect:'manual',signal:AbortSignal.timeout(5000)});
          const responseHeaders=[...response.headers].filter(([key])=>!['transfer-encoding','content-encoding','content-length','set-cookie'].includes(key)).map(([name,value])=>({name,value}));
          for(const value of response.headers.getSetCookie())responseHeaders.push({name:'set-cookie',value});
          await cdp.send('Fetch.fulfillRequest',{requestId,responseCode:response.status,responseHeaders,body:Buffer.from(await response.arrayBuffer()).toString('base64')});
        }catch{await cdp.send('Fetch.failRequest',{requestId,errorReason:'Failed'}).catch(()=>{});}
      });
    }
    await page.addInitScript(()=>{window.qaStateEvents=[];window.addEventListener('ynx-finance-private-state',event=>window.qaStateEvents.push({status:event.detail.status,revision:event.detail.revision,code:document.querySelector('#private-state')?.title}));});
    let lateCallback;
    if(transport.startsWith('selected-')){
      if(centralSSO)await page.exposeFunction('approveCentralLocalQA',challenge=>{const key='1'.padStart(64,'0'),identity=walletIdentity(key);return {challengeId:challenge.challengeId,...identity,walletSignature:bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,identity.account,identity.accountPublicKey))),hexToBytes(key),{prehash:false,format:'compact',lowS:true}))};});
      await page.exposeFunction('approveFinanceLocalQA',url=>{
        approvalCount++;
        approvalRequestNonces.push(parseProductSessionWalletURL(registry,url,new Date(Date.now()+gatewayClockOffset)).nonce);
        if(consentAction==='transport-reject')throw new Error('USER_REJECTED');
        const pending=parseProductSessionWalletURL(registry,url),at=new Date();
        const approval=signProductSessionApproval(registry,pending,{accountSecret:'1'.padStart(64,'0'),scopes:pending.scopes,expiresAt:pending.expiresAt},at);
        lateCallback=createProductSessionReturnURL(registry,pending,transport==='selected-login-rejected'||consentAction==='reject'?{result:'rejected',reason:'user_rejected'}:{result:'approved',approval},at);
        return {version:2,returnUrl:lateCallback};
      });
      await page.addInitScript(({account,changed})=>{
        const listeners=new Map();
        const provider={isYNXWallet:true,__ynxCompanion:true,on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)},removeListener(name,fn){listeners.get(name)?.delete(fn)},request:async({method,params})=>method==='ynx_requestCentralBrowserSignIn'?window.approveCentralLocalQA(params[0]):method==='eth_chainId'?'0x1917':['eth_accounts','eth_requestAccounts'].includes(method)?[account]:method==='wallet_switchEthereumChain'?null:Promise.reject(new Error('QA method forbidden')),async requestProductSessionV2(url){const response=await window.approveFinanceLocalQA(url);if(changed)for(const fn of listeners.get('accountsChanged')||[])fn(['0x'+'c'.repeat(40)]);return response}};
        const info={rdns:'com.ynx.wallet',name:'YNX Wallet',uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
        window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info,provider}})));
      },{account:evmAddressFromYNX(walletIdentity('1'.padStart(64,'0')).account),changed:transport==='selected-provider-context-change'});
    }
    const browserErrors=[],requests=[];
    page.on('pageerror',error=>browserErrors.push(error.message.slice(0,160)));
    page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/')||url.pathname.includes('product-sessions'))requests.push(`${url.pathname}:${response.status()}`)});
    await page.goto(financeOrigin);
    if(transport==='hosted-provider'){
      // Real Wallet-owned encrypted vault/review/signing UI, isolated local
      // origin transport. No installed/public claim or stub approval function.
      const password='isolated Finance Hosted QA password 2026';
      const opened=context.waitForEvent('page');await page.click('#wallet-entry');await page.click('#picker-hosted');const wallet=await opened;
      await wallet.locator('#setup-password').fill(password);await wallet.locator('#setup-confirm').fill(password);await wallet.locator('#setup-form button[type=submit]').click();
      await wallet.locator('#backup-confirmation').waitFor({state:'visible'});const backup=wallet.waitForEvent('download');await wallet.click('#export-backup');await backup;
      await wallet.locator('#backup-ack').check();await wallet.click('#backup-continue');await wallet.locator('#review').waitFor({state:'visible'});await wallet.click('#approve');
      await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==='connected');
      await page.click('#wallet-picker-action');
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.privateProviderAvailable()),true);
      assert.equal(host.snapshot().authority.sessions.length,0,'connection alone must not create a native session');
      await page.evaluate(()=>{void window.YNXFinanceWallet.beginPrivate()});await wallet.locator('#review').waitFor({state:'visible'});await wallet.click('#reject');
      await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='disconnected');
      assert.equal(host.snapshot().authority.sessions.length,0);assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');
      await page.evaluate(()=>{void window.YNXFinanceWallet.beginPrivate()});await wallet.locator('#review').waitFor({state:'visible'});
      assert.match(await wallet.locator('#review-text').textContent(),/finance\.portfolio\.read/u);
      await wallet.locator('#approval-password').fill(password);await wallet.click('#approve');
      await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='connected'&&document.querySelector('#workspace').dataset.dataState==='ready');
      const nativeAccount=await wallet.locator('#account-ynx').textContent(),session=await page.evaluate(()=>window.YNXFinanceWallet.session().sessionId);
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.session().account),nativeAccount);
      assert.equal(host.snapshot().authority.sessions.length,1);
      const proof=await page.evaluate(()=>window.YNXFinanceWallet.requireProof('finance.portfolio.read'));
      const verified=await runGoVerifier({YNX_FINANCE_QA_GATEWAY_LOOPBACK:gatewayBase,YNX_FINANCE_QA_PROOF_HEADER:proof.proofHeader,YNX_FINANCE_QA_ACCOUNT:nativeAccount});assert.equal(verified.status,0);
      assert.equal(await page.evaluate(async()=>{await api('/api/categories',{method:'POST',body:JSON.stringify({name:'Hosted owned category',color:'#002fa7',idempotencyKey:'hosted-owned-category-qa-000001'})});return (await api('/api/profile')).categories.some(item=>item.name==='Hosted owned category')}),true);
      await wallet.close();
      await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==='transport-unavailable',null,{timeout:5000}).catch(async error=>{throw new Error(JSON.stringify(await page.evaluate(()=>({phase:'hosted-close',standard:window.YNXFinanceWallet.getStandardWalletState().status,reason:window.YNXFinanceWallet.getStandardWalletState().disconnectReason,private:window.YNXFinanceWallet.getPrivateState().status,hosted:window.YNXFinanceHostedWallet.getState().status,code:window.YNXFinanceHostedWallet.getState().error}))),{cause:error})});
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getPrivateState().status),'connected');
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.privateProviderAvailable()),false,'valid business session is not a live signing transport');
      assert.equal(await page.evaluate(async()=>{try{await window.YNXFinanceWallet.requestProductSessionV2('ynxwallet://authorize?request=untrusted');return 'unexpected'}catch(error){return error.message}}),'PRIVATE_TRANSPORT_UNAVAILABLE');
      assert.equal(await page.evaluate(async()=>{return (await api('/api/profile')).categories.some(item=>item.name==='Hosted owned category')}),true,'closing Wallet transport must not revoke the valid bound business session');
      await page.reload();await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='connected'&&document.querySelector('#workspace').dataset.dataState==='ready');
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.session().sessionId),session);
      assert.equal(await page.evaluate(async()=>{return (await api('/api/profile')).categories.some(item=>item.name==='Hosted owned category')}),true);
      await page.evaluate(()=>window.YNXFinanceWallet.disconnect());
      assert.ok(host.snapshot().authority.sessions.every(item=>host.snapshot().authority.revokedSessions.includes(item.sessionBinding)));
      assert.deepEqual(browserErrors,[]);await context.close();return;
    }
    if(centralSSO){await page.waitForSelector('#browser-signin:not([hidden])');await page.goto(`${financeOrigin}/#planning`);await page.click('#browser-signin-start');await page.waitForURL(`${gatewayOrigin}/v2/browser-sessions/authorize?**`);
      await page.waitForSelector('#wallet',{timeout:3000}).catch(async error=>{throw new Error(JSON.stringify({browserErrors,gatewayTrace,routeTrace,code:await page.evaluate(()=>{try{return JSON.parse(document.body.textContent).error?.code??'unknown'}catch{return 'non-json-response'}})}),{cause:error})});
      await page.selectOption('#wallet','0');await page.click('#approve');await page.waitForURL(`${financeOrigin}/#planning`);await page.waitForFunction(()=>document.querySelector('#browser-signin-state')?.textContent.startsWith('ynx1'),null,{timeout:3000}).catch(async error=>{throw new Error(JSON.stringify({browserErrors,gatewayTrace,requests,state:await page.evaluate(()=>({sso:document.querySelector('#browser-signin-state')?.textContent,enabled:browserSSOEnabled,hasIdentity:!!browserIdentity}))}),{cause:error})});}
    if(transport.startsWith('selected-login')){
      await page.goto(`${financeOrigin}/#planning`);
      await page.locator('#guest-gate a[href="#wallet-connect"]').click();
      await page.locator('#picker-ynx').click();
      if(centralSSO){await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='connected',null,{timeout:6000});
        const reads=await page.evaluate(async()=>{const results=await Promise.all(['/api/profile','/api/portfolio','/api/activity'].map(path=>api(path)));return results.length;});assert.equal(reads,3);assert.equal(firstPrivateReads.length,4);
      }
      if(variant.endsWith('-pending')){
        // Only the expired fixture starts with an isolated old authority clock.
        // No stored pending fields are edited. Time moves only forwards.
        await page.waitForFunction(()=>YNXFinanceWallet.getPrivateState().status==='degraded');assert.equal(approvalCount,1);
        gatewayClockOffset=0;consentAction='reject';await page.reload();
        await page.waitForFunction(expected=>YNXFinanceWallet.getPrivateState().status===expected&&YNXFinanceWallet.getStandardWalletState().status==='connected',variant==='selected-login-expired-pending'?'retry-required':'connecting');
        assert.equal(await page.evaluate(()=>YNXFinanceWallet.privateProviderAvailable()),true);
        await page.locator('#wallet-more > summary').click();await page.locator('#private-retry').click();await page.waitForFunction(()=>YNXFinanceWallet.getPrivateState().status==='disconnected');
        assert.equal(approvalCount,2);assert.equal(host.snapshot().authority.sessions.length,0);
        if(variant==='selected-login-valid-pending')assert.equal(approvalRequestNonces[0],approvalRequestNonces[1],'valid saved pending must be reviewed unchanged, not replaced');
        else assert.notEqual(approvalRequestNonces[0],approvalRequestNonces[1],'only the explicit SDK action replaces expired pending');
        consentAction='approve';await page.locator('#private-retry').click();await page.waitForFunction(()=>YNXFinanceWallet.getPrivateState().status==='connected'&&document.querySelector('#workspace').dataset.dataState==='ready');
        assert.equal(approvalCount,3);assert.equal(host.snapshot().authority.sessions.length,1);
        const proof=await page.evaluate(()=>YNXFinanceWallet.requireProof('finance.portfolio.read'));
        const checked=await runGoVerifier({YNX_FINANCE_QA_GATEWAY_LOOPBACK:gatewayBase,YNX_FINANCE_QA_PROOF_HEADER:proof.proofHeader,YNX_FINANCE_QA_ACCOUNT:walletIdentity('1'.padStart(64,'0')).account});assert.equal(checked.status,0);
        assert.deepEqual(browserErrors,[]);await context.close();return;
      }
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
      if(centralSSO){
        await page.locator('#category-form input[name="name"]').fill('Isolated SSO-owned category');
        const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/categories'&&response.request().method()==='POST');
        await page.locator('#category-form button').click();assert.equal((await created).status(),201);
        assert.equal(await page.evaluate(async()=>{const owned=await api('/api/profile');return owned.categories.some(category=>category.name==='Isolated SSO-owned category');}),true);
        await page.waitForFunction(()=>document.querySelector('#budget-form select[name="categoryId"]')?.options.length>1&&document.querySelector('#workspace').dataset.dataState==='ready');
        await page.locator('#budget-form input[name="name"]').fill('Isolated SSO-owned budget');
        await page.locator('#budget-form select[name="categoryId"]').selectOption({label:'Isolated SSO-owned category'});
        await page.locator('#budget-form input[name="limitYnxt"]').fill('123');
        const budgetCreated=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/budgets'&&response.request().method()==='POST');
        await page.locator('#budget-form button').click();assert.equal((await budgetCreated).status(),201);
        assert.deepEqual(await page.evaluate(async()=>{const owned=await api('/api/profile'),budget=owned.budgets.find(item=>item.name==='Isolated SSO-owned budget');return {limit:budget?.limitYnxt,period:budget?.period,categoryOwned:owned.categories.some(item=>item.id===budget?.categoryId)};}),{limit:123,period:'monthly',categoryOwned:true});
        await page.waitForFunction(()=>document.querySelector('#workspace').dataset.dataState==='ready');
        await page.evaluate(()=>{location.hash='#statements'});
        const statementResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/statements'&&response.request().method()==='GET');
        await page.locator('#statement-form button').click();
        const reportResponse=await statementResponse;assert.equal(reportResponse.status(),200);
        const report=await reportResponse.json();
        assert.equal(report.account,walletIdentity('1'.padStart(64,'0')).account);
        assert.equal(report.schemaVersion,'finance-statement-v2');
        assert.equal(report.coverageComplete,false,'unavailable upstream must never become a complete financial history');
        await page.waitForFunction(()=>state.statement?.schemaVersion==='finance-statement-v2');
        assert.equal(await page.locator('#statement').evaluate(node=>node.classList.contains('statement-placeholder')),false);
        await page.evaluate(()=>{location.hash='#planning'});
        await page.reload();
        await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='connected'&&document.querySelector('#workspace').dataset.dataState==='ready');
        assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.session().sessionId),initialSession);
        assert.equal(approvalCount,1,'owned-service refresh must restore the approved session, not request another signature');
        assert.equal(await page.evaluate(async()=>{const owned=await api('/api/profile');return owned.categories.some(item=>item.name==='Isolated SSO-owned category')&&owned.budgets.some(item=>item.name==='Isolated SSO-owned budget'&&item.limitYnxt===123);}),true);
      }
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
      await page.locator('#wallet-entry').click();await page.locator('#picker-ynx').click();
      await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==='connected');
      await page.locator('#wallet-picker-action').click();
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
    if(variant==='selected-login-revoke-rebegin'){
      const attemptKey='ynx.finance.browser-private.9840ef87.wallet-auth.attempted';
      await page.evaluate(()=>api('/api/categories',{method:'POST',body:JSON.stringify({name:'Owned category across explicit reauthorization',color:'#002fa7',idempotencyKey:'revoke-rebegin-owned-category-qa-000001'})}));
      const revoked=await page.evaluate(()=>window.YNXFinanceWallet.disconnect());
      assert.equal(revoked.revocationConfirmed,true);
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),attemptKey),null,'confirmed revoke must stop missing-session automatic reconnect');
      await page.reload();await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='guest'&&window.YNXFinanceWallet.getStandardWalletState().status==='connected');
      assert.equal(await page.locator('#private-begin').isDisabled(),false);assert.equal(approvalCount,1);
      await page.locator('#wallet-more > summary').click();
      await page.locator('#private-begin').click();
      await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='connected'&&document.querySelector('#workspace').dataset.dataState==='ready');
      assert.equal(approvalCount,2);assert.equal(host.snapshot().authority.sessions.length,2);
      assert.equal(await page.evaluate(async()=>{const view=await api('/api/profile');return view.categories.some(item=>item.name==='Owned category across explicit reauthorization');}),true);
      failNativeRevoke=true;const unconfirmed=await page.evaluate(()=>window.YNXFinanceWallet.disconnect());
      assert.notEqual(unconfirmed.revocationConfirmed,true);assert.equal(await page.evaluate(key=>localStorage.getItem(key),attemptKey),'yes');
      await page.reload();await page.waitForFunction(()=>['retry-required','network-unavailable'].includes(window.YNXFinanceWallet.getPrivateState().status));
      assert.equal(approvalCount,2);assert.equal(await page.evaluate(key=>localStorage.getItem(key),attemptKey),'yes');
      failNativeRevoke=false;const retry=await page.evaluate(()=>window.YNXFinanceWallet.retryPrivate());
      assert.equal(retry.revocationConfirmed,true);assert.equal(await page.evaluate(key=>localStorage.getItem(key),attemptKey),null);
      await page.reload();await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='guest');assert.equal(approvalCount,2);
    }
    if(centralSSO){
      // An unused independently signed nonce from the SAME approved private
      // session remains valid at the Gateway until SDK revocation is released.
      // Product-only identity logout must reject it at Finance itself without
      // claiming a central/global logout or widening its scope.
      const unused=await page.evaluate(()=>window.YNXFinanceWallet.requireProof('finance.portfolio.read'));
      holdNativeRevoke=true;
      const logoutAck=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sso/logout'&&response.request().method()==='POST');
      await page.click('#browser-signin-logout');assert.equal((await logoutAck).status(),200);
      const denied=await page.evaluate(async header=>{const response=await fetch('/api/profile',{headers:{'X-YNX-Product-Session-Proof-V2':header}});const body=await response.json();return {status:response.status,code:body.code};},unused.proofHeader);
      assert.deepEqual(denied,{status:401,code:'sso_private_context_rejected'});
      releaseNativeRevoke();await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='disconnected');
      const starts=routeTrace.filter(value=>value.origin===financeOrigin&&value.path==='/sso/start').length;
      await page.reload();await page.waitForSelector('#browser-signin:not([hidden])');await page.waitForFunction(()=>!browserIdentity);
      assert.equal(routeTrace.filter(value=>value.origin===financeOrigin&&value.path==='/sso/start').length,starts,'logout restore must never implicitly start SSO');
      assert.equal(await page.locator('#workspace').isVisible(),false);
    }
    await context.close();
  }finally{await browser?.close();await go?.close();if(gateway.listening)await close(gateway);if(finance.listening)await close(finance);await rm(directory,{recursive:true,force:true})}
});
