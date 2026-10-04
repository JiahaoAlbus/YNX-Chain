import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Actual owned button and original intent controller. Only native authority
// and delayed transport are fixtures; no real account authorization or orders.
const bundle=await build({stdin:{contents:"import {mountPaperActions} from './paper-actions.js';mountPaperActions();",resolveDir:fileURLToPath(new URL('../web/',import.meta.url))},bundle:true,write:false,platform:'browser',plugins:[{name:'controlled-session',setup(api){api.onResolve({filter:/paper-session\.js$/},()=>({path:'session',namespace:'fixture'}));api.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const getPaperSessionState=()=>window.fixture.state;export const getPaperWorkspaceSnapshot=()=>window.fixture.snapshot;export const paperWorkspaceRequest=(...args)=>window.fixture.request(...args);` }));}}]});
test('actual receipt button fences late A success/error from B feedback, controls and UNKNOWN journal',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{for(const outcome of ['success','error']){
  const context=await browser.newContext(),page=await context.newPage();
  const intent={strategyHash:'a'.repeat(64),side:'buy',amount:1000000,idempotencyKey:'quant-native-paper-11111111-1111-4111-8111-111111111111'};
  await page.route('https://quant.ynxweb4.com/**',route=>route.fulfill({contentType:'text/html',body:'<select id="locale"></select><button id="paper-owned-backtest"></button><form id="paper-owned-form"><select id="paper-owned-strategy"></select><select id="paper-owned-side"><option value="buy">Buy</option></select><input id="paper-owned-amount" value="1000000"><button id="paper-owned-review"></button></form><pre id="paper-owned-result"></pre><dialog id="paper-owned-preview"><pre id="paper-owned-preview-text"></pre><p id="paper-owned-model"></p><button id="paper-owned-confirm"></button><button id="paper-owned-cancel"></button></dialog>'}));
  await page.goto('https://quant.ynxweb4.com/');
  await page.evaluate(intent=>{
   const snapshot=account=>({account,strategies:{one:{ID:'one',StrategyHash:intent.strategyHash}},paper:{KillSwitch:true,Orders:[]},experiments:{},audit:[]});
   window.fixture={state:{account:'native-A',epoch:1,status:'connected',ready:true},snapshot:snapshot('native-A'),calls:[],snapshotFor:snapshot};
   window.fixture.request=(path,options)=>{window.fixture.calls.push({path,options});return new Promise((resolve,reject)=>{window.fixture.resolve=resolve;window.fixture.reject=reject;});};
   localStorage.setItem('ynx.quant.native-paper.intent.v1:native-A',JSON.stringify(intent));
  },intent);
  await page.addScriptTag({content:Buffer.from(bundle.outputFiles[0].contents).toString()});
  await page.locator('#paper-native-receipt').click();await page.waitForFunction(()=>window.fixture.calls.length===1);
  await page.evaluate(intent=>{
   window.fixture.state={account:'native-B',epoch:2,status:'connected',ready:true};window.fixture.snapshot=window.fixture.snapshotFor('native-B');
   localStorage.setItem('ynx.quant.native-paper.intent.v1:native-B',JSON.stringify({...intent,idempotencyKey:'quant-native-paper-22222222-2222-4222-8222-222222222222'}));
   window.dispatchEvent(new Event('ynx:quant-paper-session'));document.getElementById('paper-owned-result').textContent='Current B feedback';window.fixture.beforeButton=document.getElementById('paper-native-receipt').textContent;
  },intent);
  await page.evaluate(({outcome,intent})=>{if(outcome==='error')window.fixture.reject(new Error('old A failed'));else window.fixture.resolve({account:'native-A',ID:'paper-1',IdempotencyKey:intent.idempotencyKey,StrategyHash:intent.strategyHash,Side:'buy',Amount:intent.amount,Filled:intent.amount,Status:'filled',Price:1000000,Source:'fixture-only',CreatedAt:'2026-10-04T00:00:00Z'});},{outcome,intent});
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#paper-owned-result').textContent(),'Current B feedback');
  assert.equal(await page.locator('#paper-native-receipt').isDisabled(),false);
  assert.equal(await page.evaluate(()=>document.getElementById('paper-native-receipt').textContent===window.fixture.beforeButton),true);
  assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.native-paper.intent.v1:native-A')),JSON.stringify(intent));
  assert.equal(await page.evaluate(()=>window.fixture.calls.length),1);
  assert.ok(await page.evaluate(()=>window.fixture.calls.every(call=>!call.options?.method||call.options.method==='GET')));
  await context.close();
 }}finally{await browser.close();}
});
