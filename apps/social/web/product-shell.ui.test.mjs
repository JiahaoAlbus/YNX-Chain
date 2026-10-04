import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('.',import.meta.url));
const require=createRequire(new URL('../package.json',import.meta.url));
const source=await readFile(path.join(root,'product-shell.js'),'utf8');
const shell=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const evidence=process.env.YNX_SOCIAL_UI_EVIDENCE_DIR??await mkdtemp(path.join(tmpdir(),'ynx-social-ig-ui-'));
console.log('UI evidence: '+evidence);
test('existing locale contract: English default, explicit Chinese, storage rejection and reversible copy',()=>{
 assert.equal(shell.deviceLocale({getItem:()=>null}),'en');
 assert.equal(shell.deviceLocale({getItem:()=> 'zh-CN'}),'zh-CN');
 assert.equal(shell.deviceLocale({getItem:()=>{throw Error('blocked')}}),'en');
 assert.equal(shell.translateUI('Write a message','zh-CN'),'写下消息');
 assert.equal(shell.translateUI('写下消息','en'),'Write a message');
 assert.equal(shell.translateUI('UNKNOWN','zh-CN'),'UNKNOWN');
 assert.equal(shell.translateUI('0x1234','zh-CN'),'0x1234');
});
test('landing and inherited hash routes are explicit',()=>{
 assert.equal(shell.pageForHash(''),'landing');
 assert.equal(shell.pageForHash('#social-moments'),'moments');
 assert.equal(shell.pageForHash('#matrix-social-workspace'),'chats');
 assert.equal(shell.pageForHash('#conversations'),'chats');
 assert.equal(shell.pageForHash('#people-panel'),'contacts');
 assert.equal(shell.pageForHash('#profile-form'),'settings');
 assert.equal(shell.pageForHash('#create'),'moments');
 assert.equal(shell.pageForHash('#legacy-share'),'chats');
 for(const pathname of ['/wallet-auth/callback','/matrix/login/callback','/sso/callback','/pair/return'])assert.equal(shell.pageForLocation({pathname,hash:''}),'chats');
 for(const pathname of ['/people/sp_123','/invite/123'])assert.equal(shell.pageForLocation({pathname,hash:''}),'contacts');
});
test('all inherited DOM IDs, permission roots and provider assets remain',async()=>{
 const before=execFileSync('git',['show','HEAD:apps/social/web/index.html'],{cwd:root,encoding:'utf8'});
 const after=await readFile(path.join(root,'index.html'),'utf8');
 const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
 for(const id of ids(before))assert.ok(ids(after).includes(id),'Missing inherited ID '+id);
 assert.equal(new Set(ids(after)).size,ids(after).length,'duplicate IDs');
 for(const name of ['workspace-content','connected-panel','private-auth-open','chat-open-wallet','protect-chat-device'])assert.match(after,new RegExp('id="'+name+'"[^>]*hidden'));
 assert.match(after,/fieldset disabled/);
 assert.match(after,/assets\/ynx-favicon.svg" type="image\/svg\+xml/);
 assert.match(after,/assets\/metamask.svg/);
 assert.match(after,/class="brand-logo" src="\.\/assets\/ynx-logo.png"/);
});
test('actual guest DOM at desktop/mobile from standard dist or scoped builds; no external authorization',async()=>{
 const {build}=require('esbuild');
 const buildResults=[];
 if(!process.env.YNX_SOCIAL_UI_SITE_DIR)for(const [entry,out] of [['private-session-ui.js','private-session-ui.js'],['matrix/session-ui.mjs','matrix-session-ui.js'],['product-shell.js','product-shell.js']]){
  const result=await build({absWorkingDir:root,entryPoints:[entry],outfile:path.join(evidence,out),bundle:true,platform:'browser',format:'esm',target:'es2022',external:entry==='product-shell.js'?['./app.js','./private-session-ui.js','/matrix-session-ui.js']:[],define:{'process.env.NODE_ENV':'"production"'},metafile:true});
  buildResults.push({entry,outputs:result.metafile.outputs});
 }
 if(buildResults.length)await writeFile(path.join(evidence,'build.json'),JSON.stringify(buildResults,null,2));
 const {chromium}=require('playwright');
 const browser=await chromium.launch({headless:true});
 const errors=[],requests=[];
 try{
  const context=await browser.newContext();
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());requests.push({method:req.method(),url:req.url()});
   if(url.origin!=='https://social.ynxweb4.com')return route.abort();
   if(url.pathname.startsWith('/sso/')||url.pathname.startsWith('/v2/')||url.pathname.startsWith('/matrix/'))return route.fulfill({status:401,contentType:'application/json',body:'{"error":"UI_QA_GUEST_ONLY"}'});
   const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
   if(name.includes('..'))return route.abort();
   const location=process.env.YNX_SOCIAL_UI_SITE_DIR?path.join(process.env.YNX_SOCIAL_UI_SITE_DIR,name):['private-session-ui.js','matrix-session-ui.js'].includes(name)?path.join(evidence,name):path.join(root,name);
   try{
    const bytes=await readFile(location),ext=path.extname(name);
    return route.fulfill({contentType:({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.html':'text/html'})[ext]??'application/octet-stream',body:bytes});
   }catch{return route.abort()}
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://social.ynxweb4.com/');
  await page.waitForFunction(()=>document.body.dataset.socialPage==='landing');
  const landingEvidence=await page.evaluate(async()=>({walletRuntime:typeof window.YNXSocialWallet,chatPhase:document.querySelector('#matrix-social-workspace').dataset.chatPhase??null,databases:(await indexedDB.databases()).map(database=>database.name)}));
  assert.equal(landingEvidence.walletRuntime,'undefined');assert.equal(landingEvidence.chatPhase,null);assert.deepEqual(landingEvidence.databases,[]);
  await writeFile(path.join(evidence,'landing-network.json'),JSON.stringify({requests:[...requests],...landingEvidence,noPrivateSDK:true,controlledOrigin:true},null,2));
  assert.equal(requests.some(request=>/\/(app\.js|private-session-ui\.js|matrix-session-ui\.js|wallet-provider\.js|wallet-transports\.js|vendor\/)/.test(new URL(request.url).pathname)),false,'landing downloads no business SDK');
  assert.equal(await page.locator('.hero').isVisible(),true);
  assert.equal(await page.locator('.phone').isVisible(),true);
  assert.equal(await page.locator('#workspace-content').isVisible(),false);
  await page.locator('.hero-actions a').first().focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('body').getAttribute('data-social-page'),'moments');
  assert.equal(new URL(page.url()).hash,'#social-moments');
  assert.equal(await page.locator('#experience').isVisible(),true);
  await page.waitForFunction(()=>document.querySelector('[data-ui-composer]'));
  assert.equal(await page.locator('[data-ui-composer]').isVisible(),false);
  await page.reload();await page.locator('#experience').waitFor();
  await page.waitForFunction(()=>!!window.YNXSocialWallet&&document.querySelector('[data-ui-composer]')); 
  assert.equal(await page.locator('body').getAttribute('data-social-page'),'moments');
  await page.selectOption('#social-locale','zh-CN');
  await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
  assert.match(await page.locator('#experience').textContent(),/访客身份/);
  await page.locator('.topbar nav a[href="#matrix-social-workspace"]').click();
  await page.waitForFunction(()=>document.body.dataset.socialPage==='chats');
  assert.equal(await page.locator('[name=matrixText]').getAttribute('placeholder'),'写下消息');
  assert.equal(await page.locator('[data-send-form] button').isDisabled(),true);
  assert.equal(await page.locator('[data-messages] li').count(),0);
  // Simulated content tests UI preservation only; never a real identity/room.
  await page.evaluate(()=>{
   const message=document.createElement('li');message.textContent='Home / Send message / 私密正文';document.querySelector('[data-messages]').append(message);
   const title=document.querySelector('[data-room-title]');title.textContent='Home';
   const option=document.createElement('option');option.value='qa-person';option.textContent='Contacts';document.querySelector('[name=matrixPeer]').append(option);
  });
  await page.selectOption('#social-locale','en');
  assert.equal(await page.locator('[data-messages] li').textContent(),'Home / Send message / 私密正文');
  assert.equal(await page.locator('[data-room-title]').textContent(),'Home');
  assert.equal(await page.locator('[name=matrixPeer] option[value="qa-person"]').textContent(),'Contacts');
  await page.evaluate(()=>document.querySelector('[data-messages]').replaceChildren());
  await page.selectOption('#social-locale','zh-CN');await page.reload();
  await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
  assert.equal(await page.locator('body').getAttribute('data-social-page'),'chats');
  await page.locator('.about-social').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.body.dataset.socialPage==='landing');
  assert.equal(new URL(page.url()).hash,'');
  assert.match(await page.locator('.hero h1').textContent(),/对话更亲近/);
  await page.goBack();await page.waitForFunction(()=>document.body.dataset.socialPage==='chats');
  await page.goForward();await page.waitForFunction(()=>document.body.dataset.socialPage==='landing');
  assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');
  await page.locator('.hero-actions a').nth(1).click();
  assert.equal(await page.locator('#experience').isVisible(),true);
  await page.locator('nav a[href="#create"]').click();
  assert.equal(await page.locator('#create').isVisible(),true);
  await page.locator('[data-ui-composer]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-ui-composer]').isVisible(),true,JSON.stringify(await page.evaluate(()=>({hash:location.hash,page:document.body.dataset.socialPage,creating:document.body.dataset.socialCreating,composers:[...document.querySelectorAll('[data-ui-composer]')].map(n=>({display:getComputedStyle(n).display,hidden:n.hidden,parent:n.parentElement.id}))}))));
  assert.equal(await page.locator('.moment-composer-details').getAttribute('open'),'');
  assert.equal(await page.locator('#workspace-content').isVisible(),false);
  await page.locator('nav a[href="#profile-form"]').click();
  assert.equal(await page.locator('#social-workspace').isVisible(),true);
  assert.equal(await page.locator('.social-appearance').isVisible(),true);
  await page.locator('nav a[href="#people-panel"]').click();
  assert.equal(await page.locator('#social-workspace').isVisible(),true);
  assert.equal(await page.locator('#workspace-content').isVisible(),false);
  const layouts=[];
  for(const locale of ['en','zh-CN']){
   await page.selectOption('#social-locale',locale);
   for(const width of [320,390,768,1280,1440]){
    await page.setViewportSize({width,height:900});
    for(const hash of ['','#social-moments','#matrix-social-workspace','#people-panel','#profile-form']){
     await page.goto('https://social.ynxweb4.com/'+hash);
     await page.waitForFunction(()=>document.documentElement.lang===localStorage.getItem('ynx.social.ui.locale.v1'));
     if(hash)await page.waitForFunction(()=>!!window.YNXSocialWallet&&document.querySelector('[data-ui-composer]'));
     const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll("body *")].filter(n=>n.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(n=>({tag:n.tagName,class:n.className,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right})),page:document.body.dataset.socialPage,logo:(()=>{const n=document.querySelector('.brand-logo'),r=n.getBoundingClientRect();return {width:r.width,height:r.height,fit:getComputedStyle(n).objectFit}})()}));
     assert.ok(layout.scrollWidth<=width,'overflow '+JSON.stringify({locale,hash,...layout}));
     assert.ok(Math.abs(layout.logo.width/layout.logo.height-798/420)<.015,'logo geometry');
     assert.equal(layout.logo.fit,'contain');
     if(width===1280&&hash==='#matrix-social-workspace'){
      const sidebar=await page.locator('.chat-sidebar').boundingBox(),conversation=await page.locator('.chat-conversation').boundingBox();assert.ok(conversation.x>sidebar.x+sidebar.width-1);
     }
     if(width===390&&hash==='#matrix-social-workspace')assert.equal(await page.locator('.chat-conversation').isVisible(),false);
     if([390,1440].includes(width)&&['','#social-moments','#matrix-social-workspace'].includes(hash))await page.screenshot({path:path.join(evidence,locale+'-'+width+'-'+(hash.slice(1)||'landing')+'.png'),fullPage:true});
     layouts.push({locale,hash,...layout});
    }
   }
  }
  await page.goto('https://social.ynxweb4.com/#social-moments');
  await page.locator('#connect-wallet').click();
  assert.equal(await page.locator('#wallet-dialog').isVisible(),true);
  assert.equal(await page.locator('#connect-metamask img').getAttribute('src'),'./assets/metamask.svg');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#wallet-dialog').isVisible(),false);
  assert.equal(await page.locator('#workspace-content').isVisible(),false);
  assert.equal(requests.filter(req=>req.method!=='GET').length,0,'no business mutations');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(evidence,'browser.json'),JSON.stringify({controlledGuest:true,actualControllers:true,publicAcceptance:false,layouts,errors,requests},null,2));
 }finally{await browser.close()}
});
