const fs=require('fs/promises');
const path=require('path');
const assert=require('assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:['/Users/huangjiahao/.codex/worktrees/android-installed-gate-main-20261001/apps/finance']}));
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../video/audit/evidence/creator-ai-recovery-20261003');
const origin='https://creator.ynxweb4.com';
const own={ID:'ai_saved_original',Owner:'fixture-owner-a',State:'review_required',Kind:'summary',Result:'Saved original result: <text stays plain>',ContextPreview:'Title and description only',EstimatedUnits:4,CreatedAt:'2026-10-03T01:00:00Z'};
const sdk=`export const atRegisteredOrigin=()=>true;export const productAuthorization=async()=>({});export const restoreProductSession=async()=>({status:'connected',session:{account:'fixture-owner-a'}});export const restoreNativeProductReturn=async()=>null;export const disconnectProductSession=async()=>({status:'disconnected'});export const subscribeProductSession=()=>()=>{};export const announceProductSession=()=>{};export const rememberProductReturn=()=>{};export const prepareProductSignIn=async()=>{throw Error('fixture sign-in is not Wallet approval')};export const finishProductReturn=async()=>{throw Error('not a real Wallet return')};export const dispatchPreparedProductRequest=async()=>{throw Error('not a real native launch')};`;
(async()=>{
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true});const cases=[];
 try{
  for(const size of [{width:390,height:844},{width:320,height:740}]){
   const context=await browser.newContext({viewport:size});const page=await context.newPage();let gets=0,mutations=0,explicitReviews=0;const failures=[];
   page.on('pageerror',e=>failures.push(e.message));
   await page.route(origin+'/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname.startsWith('/video/api/')){
     if(request.method()!=='GET')mutations++;
     let result;
     if(url.pathname==='/video/api/v1/studio')result={ai_jobs:[own,{...own,ID:'ai_other_secret',Owner:'fixture-other-owner',Result:'another owner secret'}],videos:[],team:[],rights:[],revenue:[],payout_intents:[],reports:[],appeals:[],disputes:[]};
     else if(url.pathname==='/video/api/v1/ai/provider')result={configured:true};
     else if(url.pathname==='/video/api/v1/ai/jobs/'+own.ID){gets++;result=own}
     else if(url.pathname==='/video/api/v1/ai/jobs/'+own.ID+'/review'&&request.method()==='POST'){assert.deepEqual(JSON.parse(request.postData()),{apply:true});explicitReviews++;result={...own,State:'accepted_suggestion'}}
     else return route.fulfill({status:404,contentType:'application/json',body:'{}'});
     return route.fulfill({status:200,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify(result)});
    }
    if(url.pathname==='/product-session.js')return route.fulfill({contentType:'text/javascript',body:sdk});
    if(url.pathname.includes('ynx-wallet-transports'))return route.fulfill({contentType:'text/javascript',body:'export class WalletConnectDAppConnection {} export class QRCode {} export function createHostedWalletAdapter(){return {}}'});
    let file=path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
    if(url.pathname==='/i18n/catalog.json')file=path.resolve(root,'../video/i18n/catalog.json');
    if(!file.startsWith(root)&&url.pathname!=='/i18n/catalog.json')return route.abort();
    try{const body=await fs.readFile(file),ext=path.extname(file);return route.fulfill({contentType:ext==='.js'||ext==='.mjs'?'text/javascript':ext==='.css'?'text/css':ext==='.png'?'image/png':ext==='.json'?'application/json':'text/html',body})}catch{return route.fulfill({status:404,body:'missing fixture source'})}
   });
   await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('#ai-open-saved').disabled);
   await page.locator('nav button[data-panel="ai"]').click();
   assert.equal(await page.locator('#ai-saved-select option').count(),1);assert.equal(await page.locator('#ai-saved-select').inputValue(),own.ID);
   assert.equal(await page.locator('#ai-accept').isDisabled(),true);
   await page.locator('#ai-open-saved').click();await page.waitForFunction(()=>document.querySelector('#ai-result').textContent.includes('Saved original result'));
   assert.equal(await page.locator('#ai-result').innerText(),own.Result);assert.equal(await page.locator('#ai-result').locator('*').count(),0);assert.equal(await page.locator('#ai-accept').isDisabled(),false);assert.equal(await page.locator('#ai-run').isDisabled(),true);
   await page.locator('#ai-check-saved').click();await page.waitForFunction(()=>!document.querySelector('#ai-check-saved').disabled);
   assert.equal(gets,2);assert.equal(mutations,0);
   await page.evaluate(()=>{document.documentElement.style.fontSize='32px';document.documentElement.dir='rtl'});
   const geometry=await page.locator('.ai-saved').evaluate(el=>{const box=el.getBoundingClientRect();return {width:box.width,screen:innerWidth,controls:[...el.querySelectorAll('button,select')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height}}),overflow:document.documentElement.scrollWidth>innerWidth}});
   await page.locator('#ai-check-saved').click();await page.waitForFunction(()=>!document.querySelector('#ai-check-saved').disabled);assert.equal(gets,3);
   assert.equal(geometry.overflow,false);for(const c of geometry.controls){assert.ok(c.left>=0&&c.right<=size.width+1);assert.ok(c.height>=44)}
   assert.equal(mutations,0);await page.locator('#ai-accept').click();await page.waitForFunction(()=>document.querySelector('#ai-summary').textContent.includes('Suggestion accepted'));assert.equal(mutations,1);assert.equal(explicitReviews,1);assert.equal(await page.locator('#ai-accept').isDisabled(),true);
   assert.deepEqual(failures,[]);await page.screenshot({path:path.join(out,`creator-saved-ai-${size.width}-rtl-large.png`),fullPage:true});cases.push({viewport:size,authoritativeSavedGETs:gets,automaticMutations:0,explicitReviewMutations:explicitReviews,geometry,pageErrors:failures});await context.close();
  }
  await fs.writeFile(path.join(out,'actual-browser-recovery.json'),JSON.stringify({kind:'shipped Creator app in isolated Playwright; SDK and service fixtures only',realWalletApproval:false,publicAcceptance:false,cases},null,2)+'\n');console.log(JSON.stringify({passed:cases.length,automaticMutations:0,explicitReviews:cases.length,realWalletApproval:false}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
