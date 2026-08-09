import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const port=16443;
const base=`http://127.0.0.1:${port}`;
let server,browser,evidence;

test.before(async()=>{
  const work=await mkdtemp(path.join(os.tmpdir(),'ynx-exchange-browser-'));
  evidence=path.join(repo,'tmp','exchange-browser-evidence');await mkdir(evidence,{recursive:true});
	server=spawn('go',['run','./apps/exchange/server'],{cwd:repo,detached:true,env:{...process.env,YNX_EXCHANGE_ADMIN_API_KEY:'browser-test-admin-123456',YNX_EXCHANGE_STATE_PATH:path.join(work,'state.json'),YNX_EXCHANGE_HTTP_ADDR:`127.0.0.1:${port}`},stdio:['ignore','pipe','pipe']});
  let startup='';server.stderr.on('data',chunk=>{startup+=chunk.toString()});
  for(let i=0;i<240;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,250));if(i===239)throw new Error(`exchange server did not become healthy: ${startup.slice(-2000)}`)}
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
});
test.after(async()=>{await browser?.close();if(server?.pid){try{process.kill(-server.pid,'SIGTERM')}catch{}}});

test('desktop terminal is truthful, keyboard reachable and structurally dense',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'YNXT / YUSD_TEST'}).waitFor();
  await page.getByText('No public market depth').waitFor();
  assert.equal(await page.getByText('TESTNET ONLY').count(),1);
  const chart=await page.locator('.chart').boundingBox(),book=await page.locator('.book').boundingBox(),order=await page.locator('.order-entry').boundingBox();
  assert.ok(chart&&book&&order&&chart.y===book.y&&book.y===order.y,'desktop panels should share the terminal row');
  await page.keyboard.press('Tab');assert.equal(await page.locator('.skip').evaluate(el=>el===document.activeElement),true);
	assert.equal(errors.length,0,errors.join('\n'));await page.evaluate(()=>document.activeElement?.blur());await page.screenshot({path:path.join(evidence,'desktop.png'),fullPage:true});await page.close();
});

test('mobile terminal is responsive without horizontal overflow',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});await page.goto(base,{waitUntil:'networkidle'});
  const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));assert.ok(metrics.scroll<=metrics.width,JSON.stringify(metrics));
  const chart=await page.locator('.chart').boundingBox(),book=await page.locator('.book').boundingBox();assert.ok(chart&&book&&book.y>chart.y+chart.height-2,'mobile panels should stack');
  await page.getByRole('button',{name:'Assets'}).click();await page.getByRole('heading',{name:'Deposit & withdrawal'}).waitFor();
	assert.ok(await page.getByText('Cross-chain · unavailable').count()>=1);await page.evaluate(()=>{scrollTo(0,0);document.activeElement?.blur()});await page.screenshot({path:path.join(evidence,'mobile.png')});await page.close();
});
