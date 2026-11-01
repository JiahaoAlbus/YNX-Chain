import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
import {initializeProductSessionControlState} from '../src/product-session-control-node-store.js';
import {migrateProductSessionControlSnapshotV2} from '../src/product-session-control-intent.js';
import {randomBytes} from 'node:crypto';
import {p256} from '@noble/curves/nist.js';
import {createProductSessionRequest,signProductSessionApproval,signProductSessionChallenge} from '../src/product-session-v2.js';
import {createProductSessionProofV2} from '../src/product-session-proof-v2.js';
import {encodeProductSessionGatewayProofHeaderV2} from '../src/product-session-gateway-client.js';
import {canonicalJSON} from '../src/canonical.js';
import {httpBodyDigest} from '../src/session-proof.js';
const script=fileURLToPath(new URL('../scripts/ynx-wallet-gatewayd.mjs',import.meta.url));
const registry=JSON.parse(await readFile(new URL('../product-session-registry.json',import.meta.url))),token=()=>randomBytes(32).toString('base64url');
// Software key belongs only to this isolated QA directory, never an installed wallet.
const device=new Uint8Array(32).fill(3),deviceSecret=Buffer.from(device).toString('base64url');
async function productCall(daemon,path,body,session=null){
  const headers={'content-type':'application/json','x-request-id':`req_${token()}`,'origin':'https://finance.ynxweb4.com'};
  if(session){const now=new Date();headers['x-ynx-product-session-proof-v2']=encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session,{method:'POST',path,bodyDigest:httpBodyDigest(canonicalJSON(body)),nonce:token(),issuedAt:now.toISOString(),expiresAt:new Date(Math.min(now.getTime()+30000,Date.parse(session.expiresAt))).toISOString()},deviceSecret));}
  const response=await fetch(`${daemon.url}${path}`,{method:'POST',headers,body:canonicalJSON(body),signal:AbortSignal.timeout(5000)});
  return {status:response.status,result:await response.json()};
}
async function nativeSession(daemon){
  const request=createProductSessionRequest(registry,{productId:'finance',platform:'web',deviceId:token(),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['finance.portfolio.read'],purpose:'Read my isolated Finance account',nonce:token(),state:token()});
  const approval=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt});
  const challenge=await productCall(daemon,'/v2/product-sessions/challenge',{request,approval});assert.equal(challenge.status,200);
  const completed=await productCall(daemon,'/v2/product-sessions/complete',{request,approval,completion:signProductSessionChallenge(challenge.result.result,deviceSecret)});assert.equal(completed.status,200);return completed.result.result;
}
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function start(directory,version,enabled='true',additional={}){
  const port=await freePort();const child=spawn(process.execPath,[script],{env:{...process.env,YNX_WALLET_GATEWAY_HTTP_PORT:String(port),YNX_WALLET_GATEWAY_STATE_PATH:join(directory,'legacy'),YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH:join(directory,'product'),YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION:version,YNX_CENTRAL_BROWSER_SSO:enabled,YNX_WALLET_GATEWAY_REMOTE_DEPLOYED:'false',...additional},stdio:['ignore','pipe','pipe']});
  const ready=new Promise((resolve,reject)=>{let output='',diagnostic='';child.stderr.on('data',bytes=>{diagnostic=(diagnostic+bytes.toString()).slice(0,4096);});const timer=setTimeout(()=>reject(new Error('daemon startup timed out')),5000);child.stdout.on('data',bytes=>{output+=bytes.toString();if(output.includes('"event":"listening"')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error(`daemon rejected startup configuration: ${diagnostic}`));});});
  try{await ready;}catch(error){child.kill('SIGTERM');throw error;}
  return {url:`http://127.0.0.1:${port}`,stop:()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('daemon stop timed out'));},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');})};
}
for(const version of ['2','3'])test(`real daemon composes legacy, ProductSession state v${version} and explicit independent browser SSO without resetting history`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ynx-central-daemon-'));let daemon;
  try{
    if(version==='3'){
      const registry=JSON.parse(await readFile(new URL('../product-session-registry.json',import.meta.url)));
      const source=new ProductSessionGatewayNodeHost(registry,{statePath:join(directory,'qa-v2-source'),now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString('base64url')});
      initializeProductSessionControlState(join(directory,'product'),migrateProductSessionControlSnapshotV2(source.snapshot()));
    }
    daemon=await start(directory,version);
    const active=await nativeSession(daemon),revoked=await nativeSession(daemon);
    assert.equal((await productCall(daemon,'/v2/product-sessions/introspect',{requiredScopes:['finance.portfolio.read']},active)).status,200);
    assert.equal((await productCall(daemon,'/v2/product-sessions/revoke',{},revoked)).status,200);
    const time=await fetch(`${daemon.url}/v2/product-sessions/time`,{headers:{'x-request-id':'req_central_daemon_01'},signal:AbortSignal.timeout(5000)});assert.equal(time.status,200);
    const status=await fetch(`${daemon.url}/v2/browser-sessions/status`,{signal:AbortSignal.timeout(5000)});assert.equal(status.status,401);
    const boot=await fetch(`${daemon.url}/v2/browser-sessions/bootstrap`,{signal:AbortSignal.timeout(5000)});assert.equal(boot.status,200);assert.match(boot.headers.get('set-cookie'),/Secure; HttpOnly/);
    await daemon.stop();daemon=null;
    const before=await readFile(join(directory,'product'));
    daemon=await start(directory,version);
    assert.deepEqual(await readFile(join(directory,'product')),before);
    const state=JSON.parse(before).snapshot;assert.equal(state.authority.sessions.length,2);assert.ok(state.authority.consumedNonces.length>=2);assert.equal(state.authority.revokedSessions.length,1);assert.ok(state.consumedProofs.length>=2);
    assert.equal((await productCall(daemon,'/v2/product-sessions/introspect',{requiredScopes:['finance.portfolio.read']},active)).status,200);
    const rejected=await productCall(daemon,'/v2/product-sessions/introspect',{requiredScopes:['finance.portfolio.read']},revoked);assert.equal(rejected.status,403);assert.equal(rejected.result.error.code,'SESSION_REVOKED');
    const repeat=await fetch(`${daemon.url}/v2/browser-sessions/status`,{signal:AbortSignal.timeout(5000)});assert.equal(repeat.status,401);
    await daemon.stop();daemon=null;
    daemon=await start(directory,version,'false');
    const disabled=await fetch(`${daemon.url}/v2/browser-sessions/status`,{signal:AbortSignal.timeout(5000)});assert.equal(disabled.status,405);
  }finally{if(daemon)await daemon.stop();await rm(directory,{recursive:true,force:true});}
});
test('real daemon rejects noncanonical central adoption rather than silently enabling',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ynx-central-daemon-invalid-'));
  try{await assert.rejects(start(directory,'2','TRUE'),/rejected startup/);}finally{await rm(directory,{recursive:true,force:true});}
});
test('remote daemon refuses missing or corrupt existing product history before initialization',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ynx-central-daemon-remote-'));
  const remote={YNX_WALLET_GATEWAY_REMOTE_DEPLOYED:'true',YNX_WALLET_GATEWAY_SOURCE_COMMIT:'a'.repeat(40),YNX_WALLET_GATEWAY_RELEASE:'isolated-qa',YNX_WALLET_GATEWAY_BUILD_TIME:'2026-10-01T00:00:00.000Z',YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH:fileURLToPath(new URL('../product-session-registry.json',import.meta.url))};
  try{
    await assert.rejects(start(directory,'2','true',remote),/rejected startup/);
    await assert.rejects(readFile(join(directory,'product')),error=>error.code==='ENOENT');
    await writeFile(join(directory,'product'),'corrupt isolated QA history',{mode:0o600});
    await assert.rejects(start(directory,'2','true',remote),/rejected startup/);
    assert.equal(await readFile(join(directory,'product'),'utf8'),'corrupt isolated QA history');
  }finally{await rm(directory,{recursive:true,force:true});}
});
