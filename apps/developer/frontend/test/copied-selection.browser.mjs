import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.YNX_QA_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.YNX_QA_TOOLS_URL,receipt=process.env.YNX_QA_SELECTION_RECEIPT;
assert.match(url,/^http:\/\/127\.0\.0\.1:\d{4,5}\/native-tools\?sessionId=/);assert.ok(receipt);
const sessionId=new URL(url).searchParams.get('sessionId');
const capture={uri:'file:///project/%E5%90%88%E7%BA%A6.ts',version:4,fullTextDigest:'a'.repeat(64),selectedText:'selected passage',sessionId};
const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();
const calls=[],errors=[],checks=[];let active=true,clipboard=JSON.stringify(capture),delay,readStarted,passed=false;
await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
await context.exposeBinding('__qaSelectionRead',async()=>{readStarted?.();return delay?await delay:clipboard;});
await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{readText:()=>window.__qaSelectionRead()}}));
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/runtime/native-tools/**',async route=>{
 const path=new URL(route.request().url()).pathname;calls.push(path);
 if(path.endsWith('/context'))await route.fulfill({status:active?200:401,contentType:'application/json',body:JSON.stringify(active?{csrf:'controlled',account:'controlled-account',projectId:'controlled-project',expiresAt:Date.now()+60000}:{error:'Wallet project ended.',code:'tools_identity_changed'})});
 else throw Error('Importing local clipboard data must not call '+path);
});
try{
 await page.goto(url);await page.getByLabel('Request',{exact:true}).fill('Keep my unsent request');await page.getByLabel('Selected context',{exact:true}).fill('keep my unsent draft');
 for(const text of ['private-unrelated-clipboard',JSON.stringify({...capture,sessionId:'foreign'}),JSON.stringify({...capture,fullTextDigest:[capture.fullTextDigest]})]){
  clipboard=text;await page.getByRole('button',{name:'Use copied selection',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'this editor session'}).waitFor();
  assert.equal(await page.getByLabel('Selected context',{exact:true}).inputValue(),'keep my unsent draft');
  assert.equal(await page.getByRole('complementary',{name:'Copied selection'}).count(),0);assert.ok(!(await page.locator('body').innerText()).includes('private-unrelated-clipboard'));
 }
 checks.push('Unrelated or other-session clipboard input is refused without replacing the unsent draft, displaying its contents or creating a model review.');
 clipboard=JSON.stringify(capture);await page.getByRole('button',{name:'Use copied selection',exact:true}).click();
 const copied=page.getByRole('complementary',{name:'Copied selection'});await copied.getByText('selected passage',{exact:true}).waitFor();
 await copied.getByRole('heading',{name:'Selected code · 合约.ts',exact:true}).waitFor();assert.equal(await page.getByLabel('Review mode',{exact:true}).inputValue(),'selected-edit');
 assert.deepEqual(JSON.parse(await page.getByLabel('Selected context',{exact:true}).inputValue()),capture);assert.equal(await page.getByLabel('Selected context',{exact:true}).isVisible(),false);
 assert.equal(calls.filter(path=>path.endsWith('/proposals')||path.endsWith('/approve')).length,0);
 checks.push('Explicit clipboard import shows readable Unicode filename and selected code, preserves exact metadata under collapsed details and makes no preview/send request.');
 await page.getByText('Selection details and manual paste',{exact:true}).click();await page.getByLabel('Selected context',{exact:true}).fill('keep this manual draft');
 assert.equal(await copied.count(),0);assert.equal(await page.getByLabel('Selected context',{exact:true}).inputValue(),'keep this manual draft');
 checks.push('Manual paste remains editable and retires the previous copied-code display.');
 let release;delay=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{readStarted=resolve;});
 await page.getByRole('button',{name:'Use copied selection',exact:true}).click();await started;
 active=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('link',{name:'Sign in with YNX Wallet',exact:true}).waitFor();release(JSON.stringify(capture));delay=undefined;readStarted=undefined;
 active=true;await page.getByRole('button',{name:'Refresh workspace connection',exact:true}).click();await page.getByLabel('Request',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Request',{exact:true}).inputValue(),'Keep my unsent request');assert.equal(await page.getByLabel('Selected context',{exact:true}).inputValue(),'keep this manual draft');assert.equal(await page.getByRole('complementary',{name:'Copied selection'}).count(),0);
 assert.equal(calls.filter(path=>path.endsWith('/proposals')||path.endsWith('/approve')).length,0);assert.deepEqual(errors,[]);
 checks.push('Identity retirement during a delayed clipboard read discards that result and preserves the previous prompt/context after refresh.');
 passed=true;await page.screenshot({path:receipt+'.png'});
}finally{
 await browser.close();const runner=await readFile(fileURLToPath(import.meta.url));await writeFile(receipt,JSON.stringify({passed,checks,errors,calls,runnerSha256:createHash('sha256').update(runner).digest('hex'),actualCompiledReact:true,clipboard:'controlled in-memory read',backend:'controlled identity HTTP fixtures',canonical:false,public:false},null,2),{flag:'wx'});
}
console.log(JSON.stringify({passed,checks,errors}));
