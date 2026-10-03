// LOCAL_SOURCE_QA_ONLY. Private screens use inherited controlled UI fixtures;
// screenshots do not assert Wallet approval, canonical SSO or public deployment.
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
const evidence=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(evidence,'../../../..');
const qa=fs.readFileSync('/tmp/ynx-commerce-original-brand-qa-path.txt','utf8').trim();
const require=createRequire(path.join(root,'apps/shop/package.json'));
const {chromium,expect}=require('@playwright/test');
const {installPrivateShop}=await import(pathToFileURL(path.join(qa,'apps/shop/test/browser/shop-fixture.mjs')));
const sellerSpec=fs.readFileSync(path.join(qa,'apps/seller-console/test/browser/wallet-visible.spec.mjs'),'utf8');
const sellerHelper=sellerSpec.slice(sellerSpec.indexOf('async function installPrivateWorkspace'),sellerSpec.indexOf("\ntest('role-specific"));
const installPrivateSeller=new Function('expect','return ('+sellerHelper.trim()+')')(expect);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const app of ['shop','seller-console','merchant-console']){
  const dist=path.join(qa,'apps',app,'dist');
  const server=createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(dist,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return}const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(fs.readFileSync(file));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try{
   for(const width of [1440,320]){
    const context=await browser.newContext({viewport:{width,height:900},baseURL:origin,serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let expired=false;
    // Nothing in this QA browser can contact a real Wallet or product API.
    await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/v1/')){await route.continue();return}if(url.pathname.startsWith('/api/')){const body=url.pathname==='/api/products'?{products:[]}:url.pathname==='/api/capabilities'?{paySettlement:'unavailable',tax:'unavailable',logistics:'unavailable',aiProvider:'unavailable',privacyData:'export_and_delete'}:{error:'Controlled QA only'};await route.fulfill({status:url.pathname==='/api/products'||url.pathname==='/api/capabilities'?200:503,contentType:'application/json',body:JSON.stringify(body)});return}await route.abort();});
    await page.goto('/');
    await page.waitForTimeout(200);
    const capture=async state=>{
     await page.evaluate(()=>window.scrollTo(0,0));
     const images=await page.locator('img[src$="ynx-logo.png"]').evaluateAll(images=>images.filter(image=>image.getBoundingClientRect().width>0&&image.getBoundingClientRect().height>0).map(image=>{const box=image.getBoundingClientRect(),style=getComputedStyle(image);return{naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,x:box.x,y:box.y,width:box.width,height:box.height,objectFit:style.objectFit,source:image.getAttribute('src')}}));
     if(!images.length||!images.some(image=>image.x<100&&image.y<100))throw Error('missing upper-left brand '+app+' '+state);
     for(const image of images)if(image.naturalWidth!==798||image.naturalHeight!==420||image.objectFit!=='contain'||image.width<48||image.x<0||image.x+image.width>width+1)throw Error('clipped or unavailable logo '+JSON.stringify(image));
     const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
     if(overflow)throw Error('horizontal overflow '+app+' '+width+' '+state);
		 if(app==='shop'&&width===320){const cart=await page.locator('#cartButton').boundingBox(),search=await page.locator('#search').boundingBox();if(cart.y+cart.height<899||cart.y<search.y+search.height)throw Error('mobile navigation overlaps header/search');}
     if(errors.length)throw Error('runtime errors '+JSON.stringify(errors));
     const name=app+'-'+state+'-'+width+'.png';await page.screenshot({path:path.join(evidence,name),fullPage:true});
     results.push({app,state,width,images,sha256:sha(fs.readFileSync(path.join(evidence,name))),screenshot:name});
    };
    await capture('signed-out');
    if(app==='shop'){await installPrivateShop(page);}
    else if(app==='seller-console'){await installPrivateSeller(page);}
    else{
     await page.addInitScript(()=>{sessionStorage.setItem('ynx-merchant-id','mrc_controlled_qa');sessionStorage.setItem('ynx-merchant-session','controlled-qa-bearer');sessionStorage.setItem('ynx-merchant-role','owner');sessionStorage.setItem('ynx-merchant-account','0x1111111111111111111111111111111111111111');});
     await page.route('**/v1/merchant/**',async route=>{if(expired){await route.fulfill({status:401,contentType:'application/json',body:'{"error":"Controlled QA expired"}'});return}const url=new URL(route.request().url());const body=url.pathname.endsWith('/state')?{merchants:{qa:{id:'mrc_controlled_qa',displayName:'Controlled QA merchant'}},invoices:{},catalog:{},audit:[]}:{netYnxt:0,grossYnxt:0,refundedYnxt:0,committedCount:0,invoiceCount:0,refundRequestCount:0,disputeCount:0,failedWebhookCount:0};await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
     await page.goto('/');await expect(page.locator('.center')).toBeVisible();
     await capture('private-degraded');
     // Only this isolated visual fixture supplies a loopback service URL.
     // The accepted production Endpoint Manifest remains unchanged on disk.
     const runtime=fs.readFileSync(path.join(dist,'runtime-config.js'),'utf8');
     await page.route('**/runtime-config.js',route=>route.fulfill({contentType:'text/javascript',body:runtime+'\nglobalThis.YNX_PAY_API_URL='+JSON.stringify(origin)+';'}));
     await page.reload();await expect(page.locator('.shell')).toBeVisible();
    }
    await capture('controlled-private');
    if(app==='shop'){await page.locator('#disconnectWallet').click();}
    else if(app==='seller-console'){await page.locator('#disconnectWallet').click();}
    else{expired=true;await page.locator('[data-action="refresh"]').click();await expect(page.locator('.auth')).toBeVisible();}
    await capture('private-cleared');
    await context.close();
   }
  }finally{await new Promise(resolve=>server.close(resolve));}
 }
 fs.writeFileSync(path.join(evidence,'screenshots.json'),JSON.stringify({classification:'LOCAL_SOURCE_QA_ONLY',controlledPrivateFixtures:true,sharedLegacyStandardSDKCommit:'84581af52cc54d3e5e419199d1cb365f7a75f608',originalLogoSha256:'df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d',publicVerified:false,nativeInstalled:false,canonicalPrivateWalletFlowVerified:false,results},null,2)+'\n');
 console.log(JSON.stringify({screenshots:results.length,allOriginalLogosVisible:true,viewports:[1440,320],classification:'LOCAL_SOURCE_QA_ONLY'}));
}finally{await browser.close();}
