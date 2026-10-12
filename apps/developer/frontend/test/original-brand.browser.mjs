import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.YNX_QA_BUILD_URL, output = process.env.YNX_QA_BRAND_OUTPUT;
if (!base || !output) throw Error('Local production build URL and screenshot output are required');
const expected = 'df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d';
const browser = await chromium.launch({headless:true}), checks = [], errors = [];
try {
  for (const width of [320,390,1440]) for (const uiSize of ["standard","large"]) for (const mode of ['signed-out','signed-in','locked-recovery','guest-workbench','tools','tools-signed-in']) {
    const context = await browser.newContext({viewport:{width,height:900}});
    await context.routeWebSocket('**', ws => ws.close());
    await context.addInitScript(({uiSize})=>localStorage.setItem('ynx-code-editor-preferences/v1',JSON.stringify({fontSize:13,uiSize})),{uiSize});
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if(url.origin !== new URL(base).origin)return route.abort();
      if(!url.pathname.startsWith('/runtime/'))return route.continue();
      if(mode==='tools-signed-in' && url.pathname==='/runtime/native-tools/context')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({csrf:'fixture-only',account:'QA public account',projectId:'public-sample',expiresAt:Date.now()+60000})});
      if(mode==='tools-signed-in' && url.pathname==='/runtime/native-tools/ai/conversations')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({conversations:[]})});
      if(mode==='signed-in' && url.pathname==='/runtime/codeoss')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({account:'QA public account',generation:1,identityKey:'fixture-only',configured:false,kernel:'1.109.5',nativeProjects:[],sessions:[],walletProjectExists:true,projectRevision:1,walletProjects:[{projectId:'public-sample',name:'Public sample project',revision:1}]})});
      return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Sign in with YNX Wallet',code:'core_identity_invalid'})});
    });
    if(mode==='locked-recovery')await page.addInitScript(()=>localStorage.setItem('ynx-code-project-v1','{preserved public recovery fixture'));
    const path=mode==='locked-recovery'||mode==='guest-workbench'?'/guest-workspace':mode.startsWith('tools')?'/native-tools?sessionId=12345678-1234-1234-1234-123456789012':'/';
    await page.goto(new URL(path,base).href);
    const selector=mode==='locked-recovery'?'.workspace-recovery-brand img':mode==='guest-workbench'?'.brand-logo':mode.startsWith('tools')?'.ynx-tools-page header img':'.native-home-header img';
    if(uiSize==='large')await page.evaluate(()=>{document.documentElement.dir='rtl';document.documentElement.lang='ar';});
    const logo=page.locator(selector);await logo.waitFor({state:'visible'});
    await logo.evaluate(img=>img.decode());
    if(mode==='signed-out')await page.getByRole('link',{name:'Sign in with YNX Wallet',exact:true}).waitFor();
    if(mode==='signed-in')await page.getByText('Wallet identity: QA public account',{exact:true}).waitFor();
    if(mode==='tools-signed-in')await page.getByRole('heading',{name:'AI development plan',exact:true}).waitFor();
    if(mode==='locked-recovery')await page.getByRole('heading',{name:'Your saved workspace needs recovery',exact:true}).waitFor();
    if(mode==='guest-workbench')await page.locator('.monaco-editor').first().waitFor();
    const metrics=await logo.evaluate(img=>{const s=getComputedStyle(img),r=img.getBoundingClientRect();return{naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,width:r.width,height:r.height,objectFit:s.objectFit,flexShrink:s.flexShrink,left:r.left,top:r.top};});
    assert.equal(metrics.naturalWidth,798);assert.equal(metrics.naturalHeight,420);assert.equal(metrics.objectFit,'contain');assert.equal(metrics.flexShrink,'0');
    assert.ok(Math.abs(metrics.width/metrics.height-798/420)<0.02);
    assert.ok(metrics.height<=24.1);
    assert.ok(metrics.left>=0 && metrics.left+metrics.width<=width && metrics.top>=0);
    if(mode==='guest-workbench'){await page.screenshot({path:output+'/workbench-before-settings-'+width+'-'+uiSize+'.png'});await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByText('Application text size',{exact:true}).waitFor();assert.equal(await page.locator('select').filter({has:page.locator('option[value=standard]')}).inputValue(),uiSize);assert.equal(await page.locator('input[type=range]').first().inputValue(),'13');await page.getByRole('button',{name:'Done',exact:true}).click();}
    const asset=await context.request.get(new URL('/brand/ynx-logo.png',base).href);
    assert.equal(createHash('sha256').update(await asset.body()).digest('hex'),expected);
    if(mode!=='guest-workbench')assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const screenshot=`${mode}-${width}-${uiSize}.png`;await page.screenshot({path:`${output}/${screenshot}`,fullPage:true});
    checks.push({mode,width,uiSize,direction:uiSize==="large"?"rtl":"ltr",metrics,sha256:expected,screenshot});await context.close();
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();await writeFile(`${output}/browser-receipt.json`,JSON.stringify({checks,errors,actualReactProductionBuild:true,backend:'controlled local routes',fullNativeWorkbench:false,installedMacWindows:false,public:false},null,2)+'\n');}
console.log(JSON.stringify({checks:checks.length,errors}));
