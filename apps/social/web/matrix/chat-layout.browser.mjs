// Isolated real-browser UI fixture, NOT production login/chat/device deletion.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const root=new URL('../',import.meta.url),output=await mkdtemp(join(tmpdir(),'ynx-social-chat-ui-browser-'));
const index=await readFile(new URL('index.html',root),'utf8');
const section=index.match(/<section id="matrix-social-workspace"[\s\S]*?<\/section>\s*<script type="module" src="\/matrix-session-ui.js">/)[0].replace(/\s*<script[\s\S]*$/,'');
const routes=new Map();
for(const [path,type] of [['styles.css','text/css'],['workspace.css','text/css'],['assets/ynx-logo.png','image/png'],['matrix/chat-confirmation.mjs','application/javascript'],['matrix/chat-copy.mjs','application/javascript']])routes.set('/'+path,{type,bytes:await readFile(new URL(path,root))});
const account='ynx1'+'a'.repeat(38),device='ORIGINAL-FIXTURE-DEVICE';
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/assets/ynx-logo.png"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/workspace.css"></head><body>${section}<script type="module">
import {createChatConfirmation} from '/matrix/chat-confirmation.mjs';
import {createChatCopy} from '/matrix/chat-copy.mjs';
const root=document.getElementById('matrix-social-workspace'),copy=createChatCopy(document),ui=createChatConfirmation({container:root,text:copy.text});
window.confirm=()=>{throw Error('Native confirmation forbidden in fixture')};
window.fixture={approved:0,last:null,epoch:0};
const original=document.createElement('button');original.id='fixture-remove';original.textContent=copy.text('remove');root.querySelector('[data-devices]').append(original);
original.onclick=async()=>{const epoch=window.fixture.epoch;window.fixture.controller=new AbortController();window.fixture.last=null;window.fixture.last=await ui.request({title:copy.text('removeTitle'),description:copy.text('currentBody'),account:'${account}',site:'https://matrix.fixture.test/',deviceId:'${device}',signal:window.fixture.controller.signal,guard(){if(window.fixture.epoch!==epoch)throw Object.assign(Error('Old view'),{code:'UI_STALE_VIEW'})}});if(window.fixture.last)window.fixture.approved++};
window.fixture.progress=()=>ui.progress({title:'Removing device',description:'Complete standard identity verification if asked.',account:'${account}',site:'https://matrix.fixture.test/',deviceId:'${device}'});
root.querySelector('[data-stop]').onclick=()=>{window.fixture.epoch++;window.fixture.controller?.abort();ui.cancel()};
</script></body></html>`;
routes.set('/',{type:'text/html',bytes:Buffer.from(html)});
const server=createServer((req,res)=>{const route=routes.get(new URL(req.url,'http://127.0.0.1').pathname);if(!route){res.writeHead(404);res.end();return}res.writeHead(200,{'Content-Type':route.type,'Cache-Control':'no-store'});res.end(route.bytes)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const errors=[],checks=[];
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.fixture);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'workspace horizontal overflow at '+width);
  await page.locator('#fixture-remove').click();await page.locator('dialog.chat-confirmation').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
  const content=await page.locator('dialog.chat-confirmation').textContent();assert.ok(content.includes(account)&&content.includes(device)&&content.includes('https://matrix.fixture.test/'));
  const box=await page.locator('dialog.chat-confirmation').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
  await page.screenshot({path:join(output,'review-'+width+'.png')});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.fixture.last===false);assert.equal(await page.evaluate(()=>window.fixture.approved),0);
  await page.locator('#fixture-remove').click();await page.locator('dialog.chat-confirmation button').last().click();await page.waitForFunction(()=>window.fixture.last===true);assert.equal(await page.evaluate(()=>window.fixture.approved),1);
  await page.locator('#fixture-remove').click();await page.evaluate(()=>{window.fixture.controller.abort()});await page.waitForFunction(()=>window.fixture.last===false);assert.equal(await page.evaluate(()=>window.fixture.approved),1);
  await page.evaluate(()=>window.fixture.progress());assert.equal(await page.locator('dialog').evaluate(node=>node.matches(':modal')),false);
  await page.locator('[data-stop]').click();assert.equal(await page.locator('dialog').count(),0);
  checks.push({width,noHorizontalOverflow:true,originalContext:true,cancelFocus:true,escapeNoApproval:true,explicitApproval:true,abortNoApproval:true,standardUIAWorkspaceNotInert:true});
 }
 assert.deepEqual(errors,[]);
 const sources={};for(const [path,route] of routes)if(path!=='/')sources[path]={bytes:route.bytes.length,sha256:createHash('sha256').update(route.bytes).digest('hex')};
 const receipt={kind:'isolated-synthetic-browser-ui-only',productionSSO:false,realDeviceDeletion:false,twoUserE2EE:false,checks,consoleErrors:0,output,sources};
 await writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2));process.stdout.write(JSON.stringify(receipt)+'\n');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
