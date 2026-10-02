import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

// Actual modules/DOM in an isolated browser with an explicitly synthetic camera.
// This is not hardware decoding, product authorization, or public acceptance.
const sources=new Map();
for(const name of ['contact-camera.mjs','contact-review.mjs','workspace.css'])sources.set('/'+name,await readFile(new URL(name,import.meta.url)));
const html=`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/workspace.css"><body><button id="scan">Scan QR</button><button id="review">Review person</button><script type="module">
import {scanContactQR} from '/contact-camera.mjs';
import {reviewContact} from '/contact-review.mjs';
window.state={current:true,opens:0,stops:0,result:undefined,frames:[],mode:'empty',pending:null};
const state=window.state;
Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{configurable:true,get(){return this.fixtureStream},set(stream){this.fixtureStream=stream}});
HTMLMediaElement.prototype.play=async function(){};HTMLMediaElement.prototype.pause=function(){};
const stream=()=>({getTracks:()=>[{stop(){state.stops++}}]});
const environment={isSecureContext:true,navigator:{mediaDevices:{async getUserMedia(){state.opens++;if(state.mode==='denied')throw new DOMException('Denied','NotAllowedError');if(state.mode==='pending')return new Promise(resolve=>{state.pending=()=>resolve(stream())});return stream()}}},BarcodeDetector:class{async detect(){return state.mode==='decoded'?[{rawValue:'synthetic-social-qr'}]:[]}},requestAnimationFrame(callback){state.frames.push(callback);return state.frames.length},cancelAnimationFrame(id){state.frames[id-1]=null},addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window)};
document.querySelector('#scan').onclick=async()=>{state.result=undefined;state.result=await scanContactQR(document,environment,()=>state.current)};
document.querySelector('#review').onclick=async()=>{state.result=undefined;state.result=await reviewContact(document,{person:{displayName:'Synthetic Person',handle:'synthetic_person'}},()=>state.current,message=>{state.reviewMessage=message})};
window.frame=async()=>{const callback=state.frames.find(Boolean);if(callback){state.frames[state.frames.indexOf(callback)]=null;await callback()}};
window.ready=true;
</script></body></html>`;
const server=createServer((request,response)=>{
  const source=sources.get(request.url);
  if(source){response.setHeader('Content-Type',request.url.endsWith('.css')?'text/css':'text/javascript');response.end(source);return}
  if(request.url==='/'){response.setHeader('Content-Type','text/html');response.end(html);return}
  response.statusCode=404;response.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const output=await mkdtemp(join(tmpdir(),'ynx-social-contact-camera-browser-'));
const browser=await chromium.launch({headless:true});
const errors=[],checks=[];
try{
  for(const width of [320,390,1280]){
    const page=await browser.newPage({viewport:{width,height:850}});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>window.ready);
    await page.click('#scan');await page.waitForFunction(()=>window.state.frames.some(Boolean));
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const cameraStyle=await page.evaluate(()=>{const dialog=document.querySelector('dialog'),buttons=[...dialog.querySelectorAll('button')];return {width:dialog.getBoundingClientRect().width,heights:buttons.map(button=>button.getBoundingClientRect().height),primary:getComputedStyle(buttons[0]).backgroundColor,cancel:getComputedStyle(buttons[1]).backgroundColor,focus:getComputedStyle(document.activeElement).outlineWidth}});
    assert.ok(cameraStyle.width<=Math.min(512,width-32)+1);assert.ok(cameraStyle.heights.every(height=>height>=44));assert.equal(cameraStyle.primary,'rgb(0, 47, 167)');assert.equal(cameraStyle.cancel,'rgb(255, 255, 255)');assert.equal(cameraStyle.focus,'3px');
    await page.screenshot({path:join(output,'camera-'+width+'.png')});
    await page.keyboard.press('Escape');await page.waitForFunction(()=>window.state.result===null);
    assert.equal(await page.evaluate(()=>window.state.stops),1);
    checks.push({width,cancelFocus:true,noHorizontalOverflow:true,escapeCancelled:true,streamReleased:true,cameraComputedStyle:cameraStyle});

    await page.evaluate(()=>{window.state.mode='denied'});await page.click('#scan');
    await page.getByRole('status').filter({hasText:'denied'}).waitFor();
    await page.evaluate(()=>{window.state.mode='decoded'});await page.getByRole('button',{name:'Retry camera'}).click();
    await page.waitForFunction(()=>window.state.frames.some(Boolean));await page.evaluate(()=>window.frame());
    await page.waitForFunction(()=>window.state.result==='synthetic-social-qr');
    assert.equal(await page.locator('dialog').count(),0);
    checks.push({width,permissionDeniedGuidance:true,explicitRetry:true,syntheticDecodeReturned:true});

    await page.evaluate(()=>{window.state.mode='pending'});await page.click('#scan');await page.waitForFunction(()=>window.state.pending!==null);
    const before=await page.evaluate(()=>window.state.stops);await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(()=>window.state.pending());await page.waitForFunction(previous=>window.state.stops>previous,before);
    assert.equal(await page.evaluate(()=>window.state.result),null);assert.equal(await page.locator('dialog').count(),0);
    checks.push({width,latePermissionReleased:true,noLateDialog:true});

    await page.click('#review');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
    const reviewStyle=await page.evaluate(()=>{const dialog=document.querySelector('dialog'),buttons=[...dialog.querySelectorAll('button')];return {width:dialog.getBoundingClientRect().width,heights:buttons.map(button=>button.getBoundingClientRect().height),cancel:getComputedStyle(buttons[0]).backgroundColor,primary:getComputedStyle(buttons[1]).backgroundColor,focus:getComputedStyle(document.activeElement).outlineWidth}});
    assert.ok(reviewStyle.width<=Math.min(512,width-32)+1);assert.ok(reviewStyle.heights.every(height=>height>=44));assert.equal(reviewStyle.primary,'rgb(0, 47, 167)');assert.equal(reviewStyle.cancel,'rgb(255, 255, 255)');assert.equal(reviewStyle.focus,'3px');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>window.state.result===false);
    await page.click('#review');await page.evaluate(()=>{window.state.current=false});await page.getByRole('button',{name:'Send request',exact:true}).click();await page.waitForFunction(()=>window.state.result===false);
    await page.evaluate(()=>{window.state.current=true});await page.click('#review');await page.locator('textarea').focus();await page.keyboard.insertText('\u{1F642}'.repeat(200));
    assert.equal(await page.locator('textarea').evaluate(field=>Array.from(field.value).length),200);assert.equal((await page.locator('textarea').inputValue()).length,400);
    await page.getByRole('button',{name:'Send request',exact:true}).click();await page.waitForFunction(()=>window.state.result===true);assert.equal(await page.evaluate(()=>Array.from(window.state.reviewMessage).length),200);
    checks.push({width,reviewEscapeCancelled:true,staleReviewRejected:true,explicitCurrentReviewAccepted:true,reviewComputedStyle:reviewStyle});
    await page.close();
  }
  assert.deepEqual(errors,[]);
  const receipt={schema:'ynx-social-contact-camera-browser/v1',checks,consoleErrors:errors,sourceSha256:Object.fromEntries([...sources].map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')])),syntheticCamera:true,hardwareScanVerified:false,fullProductFlowVerified:false,publicRuntimeVerified:false};
  await writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  process.stdout.write(JSON.stringify({status:'PASS',output,checks:checks.length,consoleErrors:errors.length,hardwareScanVerified:false,publicRuntimeVerified:false})+'\n');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
