import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.YNX_QA_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.YNX_QA_PANEL_URL;
if(!url)throw Error('Isolated NativeIDEPanel fixture URL required');
const browser=await chromium.launch({headless:true}),checks=[],errors=[];
const id='01234567-1234-4321-8765-0123456789ab',entry=`/sso/core-open?sessionId=${id}`;
const session={sessionId:id,projectId:'A',status:'running',failure:null,launchURL:entry};
const catalog=sessions=>({account:'account-A',generation:1,identityKey:'identity-A',configured:true,kernel:'1.109.5',nativeProjects:['A'],sessions,walletProjectExists:true,projectRevision:1,walletProjects:[{projectId:'A',name:'Saved project',revision:1}]});
let passed=false;
try{
 for(const outcome of ['ready','revoked']){
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));const requests=[];
  await page.route('**/runtime/**',route=>{
   const req=route.request();requests.push({method:req.method(),path:new URL(req.url()).pathname});
   const second=requests.length>1,denied=second&&outcome==='revoked';
   return route.fulfill({status:denied?401:200,contentType:'application/json',body:JSON.stringify(denied?{error:'Wallet authorization ended',code:'core_identity_invalid'}:catalog([{...session,status:second?'running':'preparing'}]))});
  });
  await page.goto(url);await page.getByRole('status').filter({hasText:'Starting workspace…'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Return to editor ↗',exact:true}).count(),0);
  if(outcome==='ready'){
   const link=page.getByRole('link',{name:'Return to editor ↗',exact:true});await link.waitFor();assert.equal(await link.getAttribute('href'),entry);
   await page.getByRole('status').filter({hasText:'Workspace ready'}).waitFor();
  }else{
   await page.getByRole('link',{name:'Sign in with YNX Wallet',exact:true}).waitFor();
   assert.equal(await page.getByRole('link',{name:'Return to editor ↗',exact:true}).count(),0);
  }
  assert.ok(requests.length>=2);assert.ok(requests.every(r=>r.method==='GET'&&r.path==='/runtime/codeoss'));
  checks.push(`preparing -> ${outcome}: bounded catalog refresh, no activity renewal or mutation, only current canonical entry`);await page.close();
 }
 for(const patch of [{launchURL:'https://other.example/?token=private'},{launchURL:entry+'&tkn=private'},{status:'recovery-required',failure:'stop-unconfirmed'},{sessionId:'foreign-session'},{status:'stopping'}]){
  const page=await browser.newPage();await page.route('**/runtime/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(catalog([{...session,...patch}]))}));
  await page.goto(url);await page.getByRole('button',{name:'Stop workspace',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Return to editor ↗',exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:'YNX Tools ↗',exact:true}).count(),0);
  if(patch.failure)await page.getByRole('alert').filter({hasText:'Your files are preserved'}).waitFor();
  checks.push(`unsafe/non-running entry withheld: ${JSON.stringify(patch)}`);await page.close();
 }
 {
  const page=await browser.newPage();await page.clock.install();let reads=0;
  await page.route('**/runtime/**',route=>{reads++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(catalog([{...session,status:'preparing'}]))});});
  await page.goto(url);await page.getByRole('status').filter({hasText:'Starting workspace…'}).waitFor();
  for(let n=0;n<8;n++){
   await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/runtime/codeoss'),page.clock.runFor(2600)]);
   await page.getByRole('button',{name:'Refresh Wallet projects',exact:true}).waitFor();
  }
  await page.clock.runFor(60000);assert.equal(reads,9,'pending state must not poll or renew indefinitely');
  await page.getByRole('button',{name:'Refresh Wallet projects',exact:true}).click();
  await page.getByRole('button',{name:'Refresh Wallet projects',exact:true}).waitFor();assert.equal(reads,10,'explicit refresh remains available after bounded observation');
  checks.push('pending startup stops after eight automatic reads; manual refresh remains available');await page.close();
 }
 assert.deepEqual(errors,[]);passed=true;
}finally{await browser.close();if(process.env.YNX_QA_PANEL_RECEIPT)await writeFile(process.env.YNX_QA_PANEL_RECEIPT,JSON.stringify({passed,checks,errors,actualReact:true,actualChromium:true,backend:'controlled routes',actualOpenVSCode:false,realWallet:false,public:false},null,2));}
console.log(JSON.stringify({passed,checks:checks.length,errors}));
