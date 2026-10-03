import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const logoSha='df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d';
const products=[
  {name:'finance',logo:'ynx-logo.png',selector:width=>width<721?'.mobile-product-brand img':'.sidebar .brand img',view:'#assets',navigation:'#nav a[href="#assets"]'},
  {name:'exchange',logo:'ynx-logo.png',selector:()=>'.topbar .brand img',view:'#assets',navigation:'nav button[data-view="assets"]'},
  {name:'quant-lab',logo:'ynx-brand-logo.png',selector:()=>'.product-logo',view:'#paper',navigation:'nav button[data-view="paper"]'},
];
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})});
test.after(async()=>{await browser?.close()});

for(const product of products) test(`${product.name} original YNX logo remains contained on desktop/mobile guest and business views`,async()=>{
  const root=path.join(repo,'apps',product.name,'web');
  assert.equal(createHash('sha256').update(await readFile(path.join(root,product.logo))).digest('hex'),logoSha);
  // Serve exact owned UI bytes only. Missing APIs remain explicitly unavailable;
  // no account, source data, session or successful business operation is fabricated.
  const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname.startsWith('/api/')){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"Brand-only local QA: service unavailable"}');return}
    const target=path.resolve(root,pathname==='/'?'index.html':'.'+pathname);
    if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
    try{const content=await readFile(target);const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'}[path.extname(target)]||'application/octet-stream';res.writeHead(200,{'content-type':type});res.end(content)}catch{res.writeHead(404);res.end()}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const width of [1440,390,320]){
      const context=await browser.newContext({viewport:{width,height:900}});
      try{
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
        const page=await context.newPage();await page.goto(base,{waitUntil:'domcontentloaded'});
        const logo=page.locator(product.selector(width));await logo.waitFor({state:'visible'});await logo.evaluate(image=>image.decode());
        const inspect=()=>logo.evaluate(image=>{const box=image.getBoundingClientRect(),style=getComputedStyle(image);return {width:image.naturalWidth,height:image.naturalHeight,fit:style.objectFit,shrink:style.flexShrink,x:box.x,right:box.right,boxHeight:box.height,visible:box.width>0&&box.height>0}});
        const textSizes=()=>page.evaluate(()=>[...document.querySelectorAll('nav a,nav button,.eyebrow,.panel header h2,.panel label,.book-head,.state-box,.notice,.inspector h3,.view h3,.fields label,aside footer label,.view th,.timeline code')].filter(e=>e.getClientRects().length&&!e.closest('.private-account,#account-panel,#wallet-picker')).map(e=>({text:e.textContent.trim().slice(0,60),font:parseFloat(getComputedStyle(e).fontSize)})));
        for(const phase of ['guest','business']){
          if(phase==='business')await page.locator(product.navigation).click();
          await page.locator('.ui-preferences summary').click();
          const before=await textSizes();assert.ok(before.length>0);
          await page.selectOption('#ui-text-size','large');const after=await textSizes();assert.equal(after.length,before.length);
          for(let i=0;i<before.length;i++)assert.ok(after[i].font>before[i].font,`${product.name} ${width} ${phase} text size did not change: ${JSON.stringify(before[i])}`);
          await page.selectOption('#ui-text-size','standard');
          await page.locator('.ui-preferences summary').click();
          const observed=await inspect();assert.equal(observed.width,798);assert.equal(observed.height,420);assert.equal(observed.fit,'contain');assert.equal(observed.shrink,'0');assert.equal(observed.visible,true);assert.equal(observed.boxHeight,22);assert.ok(observed.x>=0&&observed.right<=width);
          assert.equal(context.pages().length,1);
          const sizes=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);assert.ok(sizes[0]<=sizes[1],`${product.name} ${width}: ${sizes}`);
          const evidence=path.join(repo,'tmp','financial-sizing-evidence');await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,`${product.name}-${width}-${phase}.png`),fullPage:false});
        }
        await page.locator('.ui-preferences summary').click();
        const standard=await page.evaluate(()=>parseFloat(getComputedStyle(document.body).fontSize));
        const before=await textSizes();assert.ok(before.length>0);
        await page.selectOption('#ui-text-size','large');const large=await page.evaluate(()=>parseFloat(getComputedStyle(document.body).fontSize));assert.ok(large>standard);
        const after=await textSizes();assert.equal(after.length,before.length);
        for(let i=0;i<before.length;i++)assert.ok(after[i].font>before[i].font,`${product.name} ${width} text size did not change: ${JSON.stringify(before[i])}`);
        await page.reload();await logo.waitFor({state:'visible'});assert.equal(await page.locator('#ui-text-size').inputValue(),'large');
        for(const language of ['zh-CN','ar']){
          await page.evaluate(language=>{document.documentElement.lang=language;document.documentElement.dir=language==='ar'?'rtl':'ltr'},language);
          await page.waitForFunction(()=>document.querySelector('#ui-display-label').textContent!=='Display');
          await page.evaluate(()=>document.documentElement.style.fontSize='200%');
          const enlarged=await page.evaluate(()=>({font:parseFloat(getComputedStyle(document.body).fontSize),width:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,selectHeight:document.querySelector('#ui-text-size').getBoundingClientRect().height,overflow:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left<-1)&&!e.closest('.table-wrap')}).slice(0,8).map(e=>({tag:e.tagName,id:e.id,cls:e.className,width:e.getBoundingClientRect().width}))}));assert.ok(enlarged.font>large);assert.ok(enlarged.selectHeight>=44);assert.ok(enlarged.width<=enlarged.client,`${product.name} ${width} ${language} enlarged: ${JSON.stringify(enlarged)}`);
          const evidence=path.join(repo,'tmp','financial-sizing-evidence');await page.screenshot({path:path.join(evidence,`${product.name}-${width}-${language}-enlarged.png`),fullPage:false});
        }
      }finally{await context.close()}
    }
  }finally{await new Promise(resolve=>server.close(resolve))}
});
