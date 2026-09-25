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
import {signProductSessionApproval,createProductSessionReturnURL} from '../../../packages/wallet-auth/src/index.js';
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

test('local QA browser callback reaches durable Gateway NodeHost and real Finance Go v2 verifier',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ynx-finance-local-v2-'));await chmod(directory,0o700);
  const statePath=join(directory,'gateway-state.json');
  const host=new ProductSessionGatewayNodeHost(registry,{statePath,now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString('base64url')});
  const gateway=createServer(host.handler());
  const config=signedQAConfig();
  const finance=createServer(async(request,response)=>{
    const path=new URL(request.url,'http://qa').pathname;
    if(path==='/api/endpoint-authority/v2/config'){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({...config,trustedTimeMs:Date.now()}));return}
    if(path==='/health'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({ok:true,chainId:'ynx_6423-1',portfolio:'read-only'}));return}
    const file=path==='/'||path==='/wallet-auth/callback'?'index.html':path.slice(1),full=resolve(web,file);
    if(!full.startsWith(`${web}${sep}`)||!/^[-\w./]+$/u.test(file)){response.writeHead(404);response.end();return}
    try{const bytes=await readFile(full);response.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});response.end(bytes)}catch{response.writeHead(404);response.end()}
  });
  let browser;
  try{
    const gatewayBase=await listen(gateway),financeBase=await listen(finance);
    browser=await chromium.launch(await financeBrowserLaunchOptions());
    const context=await browser.newContext();
    await context.route(`${financeOrigin}/**`,route=>relay(route,financeBase));
    await context.route(`${gatewayOrigin}/**`,route=>relay(route,gatewayBase));
    const page=await context.newPage();
    const browserErrors=[],requests=[];
    page.on('pageerror',error=>browserErrors.push(error.message.slice(0,160)));
    page.on('response',response=>{const url=new URL(response.url());if(url.pathname.includes('endpoint-authority')||url.pathname.includes('product-sessions'))requests.push(`${url.pathname}:${response.status()}`)});
    await page.goto(financeOrigin);
    await page.locator('#wallet-more > summary').click();
    await page.locator('#private-begin').click();
    await page.waitForFunction(()=>{
      const state=window.YNXFinanceWallet.getPrivateState();
      return state.route?.request||state.status==='degraded';
    },null,{timeout:12_000});
    const beginStatus=await page.evaluate(()=>({status:window.YNXFinanceWallet.getPrivateState().status,code:document.querySelector('#private-state')?.title||''}));
    assert.notEqual(beginStatus.status,'degraded',`Private begin degraded: ${JSON.stringify({beginStatus,browserErrors,requests})}`);
    const pending=await page.evaluate(()=>window.YNXFinanceWallet.getPrivateState().route.request);
    assert.equal(pending.productId,'finance');
    const approvedAt=new Date(),approval=signProductSessionApproval(registry,pending,{accountSecret:'1'.padStart(64,'0'),scopes:pending.scopes,expiresAt:pending.expiresAt},approvedAt);
    const callback=createProductSessionReturnURL(registry,pending,{result:'approved',approval},approvedAt);
    await page.goto(callback);
    await page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='connected');
    const privateState=await page.evaluate(()=>({standard:window.YNXFinanceWallet.getStandardWalletState().status,privateStatus:window.YNXFinanceWallet.getPrivateState().status,account:window.YNXFinanceWallet.getPrivateState().session.account}));
    assert.equal(privateState.standard,'disconnected');assert.equal(privateState.privateStatus,'connected');
    const proof=await page.evaluate(()=>window.YNXFinanceWallet.requireProof('finance.portfolio.read'));
    assert.ok(proof.proofHeader);
    const child=await runGoVerifier({YNX_FINANCE_QA_GATEWAY_LOOPBACK:gatewayBase,YNX_FINANCE_QA_PROOF_HEADER:proof.proofHeader,YNX_FINANCE_QA_ACCOUNT:privateState.account});
    assert.equal(child.status,0,`Finance Go v2 verifier failed: ${child.stderr||child.stdout}`);
    assert.equal(host.snapshot().authority.sessions.length,1);
    assert.ok(host.snapshot().consumedProofs.length>=1);
    await context.close();
  }finally{await browser?.close();if(gateway.listening)await close(gateway);if(finance.listening)await close(finance);await rm(directory,{recursive:true,force:true})}
});
