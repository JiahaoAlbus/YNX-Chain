// Actual owned browser loader and protected WebCrypto/IndexedDB SDK against
// isolated original Node authority. QA approval uses disposable account 1.
// Never reads a real Wallet profile, writes production authority, or logs grants.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{createInterface}=require('node:readline'),{generateKeyPairSync,createHash}=require('node:crypto');
const {chromium}=require(require.resolve('playwright',{paths:['/Users/huangjiahao/.codex/worktrees/android-installed-gate-main-20261001/apps/finance']}));
const root=path.resolve(__dirname,'../web'),workspace=path.resolve(__dirname,'../../..');
const source=process.argv[2];if(!source)throw Error('Explicit independently verified frozen Central source required');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-music-browser-authority-'));fs.chmodSync(tmp,0o700);
const {publicKey}=generateKeyPairSync('ed25519');
const originalMusic=process.env.YNX_QA_ORIGINAL_MUSIC_URL;
const child=spawn(process.execPath,[path.join(workspace,'internal/video/testdata/media-private-authority-node.mjs')],{env:{...process.env,YNX_QA_CENTRAL_SOURCE:path.resolve(source),YNX_QA_PRODUCT_ID:'music',YNX_QA_PLATFORM:'web',YNX_QA_BROWSER_DEVICE:'1',YNX_QA_STATE_PATH:path.join(tmp,'authority.json'),YNX_QA_PUBLIC_KEY:process.env.YNX_QA_PUBLIC_KEY||publicKey.export({type:'spki',format:'pem'})},stdio:['pipe','pipe','pipe']});
let diagnostic='';child.stderr.on('data',b=>{diagnostic=(diagnostic+b).slice(-1600)});
const lines=createInterface({input:child.stdout}),iterator=lines[Symbol.asyncIterator]();
async function next(){const result=await Promise.race([iterator.next(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('QA authority response timeout')),20000);timer.unref()})]);if(result.done)throw Error('QA authority exited: '+diagnostic);return JSON.parse(result.value)}
async function command(value){child.stdin.write(JSON.stringify(value)+'\n');return next()}
(async()=>{let browser;try{
 const ready=await next();assert.equal(ready.unsupported,false);assert.equal(ready.session,null);
 if(originalMusic){const bound=await fetch(originalMusic+'/qa-bind',{method:'POST',body:JSON.stringify({url:ready.url})});assert.equal(bound.status,204)}
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 const errors=[],gatewayCalls=[];let revokeUnavailable=false;page.on('pageerror',e=>errors.push(e.message));
 await context.route('https://wallet-auth.ynxweb4.com/**',async route=>{
  const request=route.request(),url=new URL(request.url());gatewayCalls.push({method:request.method(),path:url.pathname});
  if(revokeUnavailable&&url.pathname==='/v2/product-sessions/revoke'){await route.fulfill({status:503,contentType:'application/json',body:'{"error":"isolated-revoke-unavailable"}'});return}
  const headers=request.headers();delete headers.host;delete headers['content-length'];
  const response=await fetch(ready.url+url.pathname+url.search,{method:request.method(),headers,body:request.postDataBuffer()??undefined,redirect:'error'});
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await context.route('https://music.ynxweb4.com/**',async route=>{
  const url=new URL(route.request().url());
  if(originalMusic&&url.pathname!=='/qa.html'){const request=route.request(),headers=request.headers();delete headers.host;delete headers['content-length'];const response=await fetch(originalMusic+url.pathname+url.search,{method:request.method(),headers,body:request.postDataBuffer()??undefined,redirect:'error'});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});return}
  if(url.pathname==='/qa.html'){await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated Music SDK QA</title>'});return}
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){await route.fulfill({status:404,body:''});return}
  await route.fulfill({contentType:/\.(js|mjs)$/.test(file)?'text/javascript':file.endsWith('.json')?'application/json':'text/html',body:fs.readFileSync(file)});
 });
 async function load(){return page.evaluate(async()=>{const {loadCanonicalMusicRelease}=await import('/canonical-release.js');globalThis.qaMusic=await loadCanonicalMusicRelease();return qaMusic.capabilities})}
 await page.goto('https://music.ynxweb4.com/qa.html');const capabilities=await load();assert.equal(capabilities.privateKeyExtractable,false);assert.equal(capabilities.persistedCryptoKey,true);assert.equal(capabilities.osProtected,false);
 const initial=await page.evaluate(()=>qaMusic.client.restore());assert.equal(initial.status,'retry-required',JSON.stringify({status:initial.status,message:initial.message,gatewayCalls}));
 const begin=await page.evaluate(()=>qaMusic.client.beginExplicit());assert.equal(begin.status,'connecting');assert.equal(begin.route.status,'ready');assert.equal(begin.route.automatic,false);assert.equal(begin.request.platform,'web');
 const approval=await command({kind:'approve-browser-request',url:begin.route.url});
 const wrong=new URL(approval.callback);wrong.searchParams.set('state','not-the-pending-state');
 const rejected=await page.evaluate(url=>qaMusic.client.handleReturn(url),wrong.href);assert.equal(rejected.status,'retry-required');assert.equal(rejected.session,undefined);
 const connected=await page.evaluate(url=>qaMusic.client.handleReturn(url),approval.callback);assert.equal(connected.status,'connected');
 const account=connected.session.account,binding=connected.session.sessionBinding,device=connected.session.deviceId;
 if(originalMusic){const result=await page.evaluate(async()=>{const {createMusicSession}=await import('/canonical-session.js');globalThis.qaLifecycle=createMusicSession({load:async()=>qaMusic,activate:async request=>{globalThis.qaBusinessRequest=request;const response=await request('api/me');if(!response.ok)throw Error('Original Music account readback failed: '+response.status);globalThis.qaAccount=(await response.json()).profile.account},dispose:()=>{}});const state=await qaLifecycle.restore();const response=await qaBusinessRequest('api/playlists',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'protected-browser-playlist'},body:'{ "name": "Protected browser original library", "trackIds": [] }'});return {status:state.status,account:qaAccount,created:response.status}});assert.equal(result.status,'connected');assert.equal(result.account,account);assert.equal(result.created,201)}
 const signed=await page.evaluate(async()=>{const bytes=new TextEncoder().encode('{ "title": "browser exact wire" }');const proof=await qaMusic.createBusinessProof({method:'POST',path:'/api/playlists',body:bytes,requiredScopes:['music.library']});return {proof,session:qaMusic.client.current.session,body:Array.from(bytes)}});
 const moduleURL=p=>require('node:url').pathToFileURL(path.join(source,'packages/wallet-auth/src',p)).href;
 const {verifyProductSessionProofV2}=await import(moduleURL('product-session-proof-v2.js'));
 const {httpBodyDigest}=await import(moduleURL('session-proof.js'));
 const decoded=JSON.parse(Buffer.from(signed.proof.proofHeader,'base64url').toString());
 verifyProductSessionProofV2(decoded,signed.session,{method:'POST',path:'/api/playlists',bodyDigest:httpBodyDigest(Uint8Array.from(signed.body))});
 assert.throws(()=>verifyProductSessionProofV2(decoded,signed.session,{method:'POST',path:'/api/playlists',bodyDigest:httpBodyDigest('changed bytes')}));
 await page.evaluate(()=>qaMusic.close());await page.reload();await load();
 const restored=await page.evaluate(()=>qaMusic.client.restore());assert.equal(restored.status,'connected');assert.equal(restored.session.account,account);assert.equal(restored.session.sessionBinding,binding);assert.equal(restored.session.deviceId,device);
 revokeUnavailable=true;
 const pending=await page.evaluate(()=>qaMusic.client.disconnect());assert.equal(pending.status,'retry-required');assert.equal(pending.session,undefined);
 assert.equal(await page.evaluate(async()=>{try{await qaMusic.createBusinessProof({method:'GET',path:'/api/me',body:'',requiredScopes:['music.profile']});return false}catch{return true}}),true);
 await page.evaluate(()=>qaMusic.close());await page.goto('https://music.ynxweb4.com/');
 await page.locator('#musicSignOutRetry').waitFor({state:'visible'});assert.equal(await page.locator('#musicSignIn').isEnabled(),false);assert.equal(await page.locator('#musicIdentity').isVisible(),false);
 revokeUnavailable=false;await page.locator('#musicSignOutRetry').click();await page.locator('#musicSignOutRetry').waitFor({state:'hidden'});assert.equal(await page.locator('#musicSignIn').isEnabled(),true);assert.match(await page.locator('#status').innerText(),/Signed out/);
 await page.goto('https://music.ynxweb4.com/qa.html');await load();assert.equal((await page.evaluate(()=>qaMusic.client.restore())).status,'retry-required');
 const wrongOrigin=await page.evaluate(async()=>{const {loadCanonicalMusicRelease}=await import('/canonical-release.js');let calls=0;try{await loadCanonicalMusicRelease({environment:{location:{origin:'https://invalid.example'},isSecureContext:true,fetch:()=>{calls++;throw Error('unexpected HTTP')}}});return false}catch{return calls===0}});assert.equal(wrongOrigin,true);
 assert.deepEqual(errors,[]);for(const route of ['challenge','complete','introspect','revoke'])assert(gatewayCalls.some(c=>c.path==='/v2/product-sessions/'+route),route+' not exercised');
 const adoption=JSON.parse(fs.readFileSync(path.join(root,'vendor/wallet-auth-5c5e8a23/owner-adoption.json')));
 console.log(JSON.stringify({schema:'ynx.music.actual-browser-authority-qa.v1',sharedCommit:adoption.sharedSourceCommit,loaderSHA256:createHash('sha256').update(fs.readFileSync(path.join(root,'canonical-release.js'))).digest('hex'),passed:['actual-loader','webcrypto-nonextractable-indexeddb','explicit-pending-request','callback-state-rejection','actual-authority-challenge-complete','exact-wire-signature-and-tamper-rejection','cold-restore-same-account-device-session','cold-pending-revocation-ui-blocks-signin','same-target-retry-actual-remote-revoke','pending-revoke-no-proof','cold-restore-no-active-session','wrong-origin-before-http'],gatewayCalls,actualWalletConsent:false,actualBusinessServerReadback:!!originalMusic,productionInstalled:false,realCentralCurrentActor:false},null,2));
 }finally{if(browser)await browser.close();child.stdin.end();child.kill();lines.close();fs.rmSync(tmp,{recursive:true,force:true})}})().catch(error=>{console.error(error);process.exitCode=1});
