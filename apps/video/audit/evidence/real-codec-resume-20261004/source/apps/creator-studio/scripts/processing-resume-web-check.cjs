// Original Creator DOM with isolated session/service fixtures; no real Wallet or Host.
const fs=require('fs/promises'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:['/Users/huangjiahao/.codex/worktrees/android-installed-gate-main-20261001/apps/finance']}));
const root=path.resolve(__dirname,'..'),out=process.env.YNX_PROCESSING_RESUME_EVIDENCE||'/tmp/ynx-media-processing-resume-20261004';
const origin='https://creator.ynxweb4.com';
const sdk=`export const atRegisteredOrigin=()=>true;export const productAuthorization=async()=>({});export const restoreProductSession=async()=>({status:'connected',session:{account:'fixture-owner-a',expiresAt:new Date(Date.now()+600000).toISOString()}});export const restoreNativeProductReturn=async()=>null;export const disconnectProductSession=async()=>({status:'disconnected'});export const subscribeProductSession=()=>()=>{};export const announceProductSession=()=>{};export const rememberProductReturn=()=>{};export const prepareProductSignIn=async()=>{throw Error('fixture sign-in is not Wallet approval')};export const finishProductReturn=async()=>{throw Error('not a real Wallet return')};export const dispatchPreparedProductRequest=async()=>{throw Error('not a real native launch')};`;
(async()=>{
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true});const cases=[];
 try {
  for(const phase of ['failed','scanning','transcoding']) for(const view of [{width:390,height:844,fontSize:16,dir:'ltr'},{width:320,height:740,fontSize:32,dir:'rtl'},{width:1280,height:900,fontSize:16,dir:'ltr'}]) {
   const context=await browser.newContext({viewport:{width:view.width,height:view.height}}),page=await context.newPage();
   let saved={id:'saved_original_'+phase,title:'Saved original',status:phase,visibility:'private',sha256:'a'.repeat(64),workflow_state:'draft'};
   let releaseRetry;const retryRelease=new Promise(resolve=>{releaseRetry=resolve});const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route(origin+'/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/api/sso/account')return route.fulfill({status:200,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify({account:'fixture-owner-a',subject:'fixture-owner-a',signedIn:true,generation:1,expiresAt:new Date(Date.now()+600000).toISOString(),scopes:['identity:read'],privateWorkspaceAuthorized:false,csrfToken:'fixture_csrf_'.repeat(4)})});
    if(url.pathname.startsWith('/video/api/')) {
     if(req.method()!=='GET')requests.push({method:req.method(),path:url.pathname,body:req.postData()});
     let result;
     if(url.pathname==='/video/api/v1/studio')result={videos:[saved,{...saved,id:'already_ready',status:'ready'}],ai_jobs:[],team:[],rights:[],revenue:[],payout_intents:[],reports:[],appeals:[],disputes:[]};
     else if(url.pathname==='/video/api/v1/ai/provider')result={configured:false};
     else if(url.pathname==='/video/api/v1/videos/'+saved.id+'/retry-processing'&&req.method()==='POST'){await retryRelease;saved={...saved,status:'ready'};result=saved;}
     else return route.fulfill({status:404,contentType:'application/json',body:'{}'});
     return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    }
    if(url.pathname==='/product-session.js')return route.fulfill({contentType:'text/javascript',body:sdk});
    if(url.pathname.includes('ynx-wallet-transports'))return route.fulfill({contentType:'text/javascript',body:'export class WalletConnectDAppConnection {} export class QRCode {} export function createHostedWalletAdapter(){return {}}'});
    let file=path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
    if(url.pathname==='/i18n/catalog.json')file=path.resolve(root,'../video/i18n/catalog.json');
    if(!file.startsWith(root)&&url.pathname!=='/i18n/catalog.json')return route.abort();
    try {const body=await fs.readFile(file),ext=path.extname(file);return route.fulfill({contentType:['.js','.mjs'].includes(ext)?'text/javascript':ext==='.css'?'text/css':ext==='.json'?'application/json':ext==='.png'?'image/png':'text/html',body});}catch{return route.fulfill({status:404,body:'missing fixture source'});}
   });
   await page.goto(origin);await page.waitForFunction(()=>document.querySelectorAll('#videos .lifecycle-row').length===2);
   await page.locator('nav button[data-panel="content"]').click();
   await page.evaluate(view=>{document.documentElement.style.fontSize=view.fontSize+'px';document.documentElement.dir=view.dir},view);
   const geometry=await page.locator('#refresh').evaluate(button=>{const rect=button.getBoundingClientRect(),css=getComputedStyle(button),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=css.font;return {left:rect.left,right:rect.right,height:rect.height,width:rect.width,wordFits:rect.width-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)-2>=context.measureText(button.textContent.trim()).width,overflow:document.documentElement.scrollWidth>innerWidth}});
   assert.equal(geometry.wordFits,true,'Refresh control must retain enough width to read its label');assert.equal(geometry.overflow,false);assert.ok(geometry.left>=0&&geometry.right<=view.width+1);assert.ok(geometry.height>=44);
   assert.equal(requests.length,0);assert.equal(await page.locator('#videos [data-action="retry"]').count(),1);
   await page.screenshot({path:path.join(out,'creator-resume-'+phase+'-'+view.width+'-'+view.dir+'.png'),fullPage:true});
   await page.locator('#videos [data-action="retry"]').click();
   await page.waitForFunction(()=>document.querySelector('#videos [data-action="retry"]').disabled);
   await page.locator('#videos [data-action="retry"]').evaluate(button=>button.click());
   releaseRetry();
   await page.waitForFunction(()=>document.querySelectorAll('#videos [data-action="retry"]').length===0);
   assert.deepEqual(requests,[{method:'POST',path:'/video/api/v1/videos/'+saved.id+'/retry-processing',body:null}]);
   assert.deepEqual(errors,[]);cases.push({phase,view,geometry,originalID:saved.id,automaticMutations:0,explicitProcessingRequests:requests.length,reuploadRequests:0,pageErrors:errors});await context.close();
  }
  await fs.writeFile(path.join(out,'web-dom-receipt.json'),JSON.stringify({scope:'original Creator DOM; synthetic session and service responses only',realWallet:false,formalHost:false,actualCodec:false,cases},null,2)+'\n');console.log(JSON.stringify({passed:cases.length,automaticMutations:0,reuploadRequests:0}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
