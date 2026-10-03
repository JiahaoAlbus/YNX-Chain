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
   for(const scenario of [{name:'en-standard-desktop',width:1440,lang:'en',size:'standard',zoom:1},{name:'en-standard-mobile',width:320,lang:'en',size:'standard',zoom:1},{name:'zh-standard-mobile',width:390,lang:'zh-Hans',size:'standard',zoom:1},{name:'ar-standard-mobile',width:320,lang:'ar',size:'standard',zoom:1},{name:'en-larger-mobile',width:320,lang:'en',size:'larger',zoom:1},{name:'zh-200-desktop',width:1440,lang:'zh-Hans',size:'standard',zoom:2},{name:'ar-200-mobile',width:320,lang:'ar',size:'larger',zoom:2}]){
 const width=scenario.width;
    const context=await browser.newContext({viewport:{width,height:900},baseURL:origin,serviceWorkers:'block'});
    const page=await context.newPage();
    await context.addInitScript(({app,scenario})=>{localStorage.setItem('ynx-ui-language',scenario.lang);localStorage.setItem('ynx-merchant-locale',scenario.lang);localStorage.setItem('ynx-'+app+'-text-size',scenario.size);}, {app,scenario});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let expired=false;
    // Nothing in this QA browser can contact a real Wallet or product API.
    await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/v1/')){await route.continue();return}if(url.pathname.startsWith('/api/')){const body=url.pathname==='/api/products'?{products:[]}:url.pathname==='/api/capabilities'?{paySettlement:'unavailable',tax:'unavailable',logistics:'unavailable',aiProvider:'unavailable',privacyData:'export_and_delete'}:{error:'Controlled QA only'};await route.fulfill({status:url.pathname==='/api/products'||url.pathname==='/api/capabilities'?200:503,contentType:'application/json',body:JSON.stringify(body)});return}await route.abort();});
    await page.goto('/');
    await page.waitForTimeout(200);
    const capture=async state=>{
     await page.evaluate(({zoom,size})=>{if(zoom!==1)document.documentElement.style.fontSize=(zoom*(size==='larger'?115:size==='compact'?92.5:100))+'%';window.scrollTo(0,0);},scenario);
     const images=await page.locator('img[src$="ynx-logo.png"]').evaluateAll(images=>images.filter(image=>image.getBoundingClientRect().width>0&&image.getBoundingClientRect().height>0).map(image=>{const box=image.getBoundingClientRect(),style=getComputedStyle(image);return{naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,x:box.x,y:box.y,width:box.width,height:box.height,objectFit:style.objectFit,visibleGraphicHeight:Math.min(box.height,box.width*420/798)*416/420,source:image.getAttribute('src')}}));
     if(!images.length||!images.some(image=>(image.x<100||image.x+image.width>width-100)&&image.y<100)){await page.screenshot({path:require('node:path').join(evidence,'first-failure.png'),fullPage:true});throw Error('missing upper-left brand '+app+' '+state+' '+JSON.stringify({scenario,images}));}
     for(const image of images)if(image.naturalWidth!==798||image.naturalHeight!==420||image.objectFit!=='contain'||image.width<40||image.visibleGraphicHeight<20||image.visibleGraphicHeight>24.1||image.x<0||image.x+image.width>width+1)throw Error('clipped or unavailable logo '+JSON.stringify(image));
     const typography=await page.evaluate(()=>({lang:document.documentElement.lang,dir:document.documentElement.dir,preference:document.documentElement.dataset.textSize,rootSize:parseFloat(getComputedStyle(document.documentElement).fontSize),bodySize:parseFloat(getComputedStyle(document.body).fontSize)}));
if(({'zh-CN':'zh-Hans','zh-TW':'zh-Hant'}[typography.lang]||typography.lang)!==scenario.lang||typography.preference!==scenario.size)throw Error('locale or persisted type mismatch '+JSON.stringify({scenario,typography}));
const expected=16*scenario.zoom*(scenario.size==='larger'?1.15:scenario.size==='compact'?.925:1);if(Math.abs(typography.rootSize-expected)>.1)throw Error('text enlargement ignored');
const brand=await page.locator('.brand,.commerceBrand').first().boundingBox();if(brand&&brand.height<44)throw Error('brand touch target shrunk');
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
     if(overflow){const nodes=await page.evaluate(()=>[...document.querySelectorAll('*')].map(e=>({tag:e.tagName,id:e.id,class:e.className,x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width})).filter(e=>e.x<-.5||e.x+e.width>innerWidth+.5).slice(0,15));await page.screenshot({path:path.join(evidence,'overflow-'+app+'.png'),fullPage:true});throw Error('horizontal overflow '+app+' '+width+' '+state+' '+JSON.stringify({scenario,nodes}));}
		 if(app==='shop'&&width===320){const cart=await page.locator('#cartButton').boundingBox(),search=await page.locator('#search').boundingBox();if(cart.y+cart.height<899||cart.y<search.y+search.height)throw Error('mobile navigation overlaps header/search');}
     if(app==='merchant-console'&&width<760){const clipped=await page.locator('.mobile-nav button').evaluateAll(nodes=>nodes.some(node=>node.scrollHeight>node.clientHeight+1));if(clipped)throw Error('mobile nav text clipped');}
if(errors.length)throw Error('runtime errors '+JSON.stringify(errors));
     const name=app+'-'+state+'-'+scenario.name+'.png';await page.screenshot({path:path.join(evidence,name),fullPage:true});
     results.push({app,state,width,scenario,typography,brandTouchHeight:brand?.height,computedRootFont:await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),images,sha256:sha(fs.readFileSync(path.join(evidence,name))),screenshot:name});
    };
    await capture('signed-out');
await page.locator('.displaySettings summary').click();if(scenario.name==='en-standard-mobile')await capture('appearance-settings');await page.locator('#commerceTextSize').selectOption('compact');if(await page.evaluate(()=>document.documentElement.dataset.textSize)!=='compact')throw Error('text preference not applied');await page.locator('#commerceTextSize').selectOption(scenario.size);await page.locator('.displaySettings summary').click();
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
 console.log(JSON.stringify({screenshots:results.length,allOriginalLogosVisible:true,scenarios:7,classification:'LOCAL_SOURCE_QA_ONLY'}));
}finally{await browser.close();}
