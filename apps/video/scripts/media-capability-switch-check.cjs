const fs=require('fs/promises'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process'),net=require('net');
const {chromium}=require(require.resolve('playwright',{paths:['/Users/huangjiahao/.codex/worktrees/android-installed-gate-main-20261001/apps/finance']}));
const root=path.resolve(__dirname,'../../..'),out=process.env.YNX_MEDIA_SITE_EVIDENCE||'/tmp/ynx-media-unified-navigation-20261004',musicBinary=process.env.YNX_MEDIA_SITE_MUSIC_BINARY;
const port=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
(async()=>{const processes=[],sites=[],cases=[];let browser;
try{
 await fs.mkdir(out,{recursive:true});assert.ok(musicBinary,'Supply the newly built original Music public-only binary');
 for(const [role,folder]of [['video','apps/video'],['music','apps/music/web'],['creator','apps/creator-studio']]){
  const p=await port(),origin='http://127.0.0.1:'+p;
  const child=role==='music'?spawn(musicBinary,['-http','127.0.0.1:'+p,'-data',await fs.mkdtemp(out+'/navigation-music-state-')],{cwd:root,stdio:'ignore'}):spawn(process.execPath,['server.mjs'],{cwd:path.join(root,folder),env:{...process.env,PORT:String(p)},stdio:'ignore'});processes.push(child);sites.push({role,origin});
  for(let i=0;;i++){try{if((await fetch(origin)).ok)break;}catch{}if(i>50||child.exitCode!==null)throw Error('Original server failed: '+role);await new Promise(r=>setTimeout(r,100));}
 }
 browser=await chromium.launch({headless:true});
 for(const site of sites){
  const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();
  // Resolve only known original domain links to the same actual engines on loopback for this test.
  for(const target of sites)await context.route('https://'+target.role+'.ynxweb4.com/app.html*',route=>{const u=new URL(route.request().url());return route.fulfill({status:302,headers:{location:target.origin+'/app.html'+u.search}});});
  const start=site.origin+'/app.html?lang=zh-CN&mediaSelection=private-view#library';
  await page.goto(start);await page.locator('[data-media-navigation]').waitFor();await page.screenshot({path:path.join(out,site.role+'-application-390-zh-CN.png'),fullPage:true});
  for(const target of sites.filter(x=>x.role!==site.role)){
   const link=page.locator('[data-media-experience="'+target.role+'"]'),u=new URL(await link.getAttribute('href'));
   assert.deepEqual([...u.searchParams.entries()],[['lang','zh-CN']]);assert.equal(u.hash,'');
   await link.click();await page.waitForURL(target.origin+'/app.html?lang=zh-CN');assert.equal(await page.locator('[data-media-navigation] [aria-current="page"]').getAttribute('data-media-experience'),target.role);
   cases.push({from:site.role,to:target.role,language:'zh-CN',originalEngine:true,onlyDisplayLanguageTransferred:true});await page.goBack();await page.waitForURL(start);
  }
  if(site.role==='creator'){await page.setViewportSize({width:1280,height:900});const layout=await page.evaluate(()=>{const b=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}};return {bar:b('[data-media-navigation]'),header:b('body>header'),aside:b('body>aside'),main:b('body>main')};});assert.ok(layout.header.top>=layout.bar.bottom-1&&layout.aside.top>=layout.bar.bottom-1&&layout.main.top>=layout.header.bottom-1,'Creator grid preserves original regions');await page.screenshot({path:path.join(out,'creator-application-1280-zh-CN.png'),fullPage:true});}
  await context.close();
 }
 await fs.writeFile(path.join(out,'capability-switch-receipt.json'),JSON.stringify({scope:'Actual original engines on loopback; exact domain navigation redirected only for browser QA',realAccount:false,unifiedAccountRuntime:false,formalHost:false,cases},null,2)+'\n');console.log(JSON.stringify({passed:cases.length,originalEngines:3}));
}finally{if(browser)await browser.close();for(const p of processes)if(p.exitCode===null)p.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
