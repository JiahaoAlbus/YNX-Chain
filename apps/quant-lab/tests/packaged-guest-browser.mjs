import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
import {verifyQuantVersionedAssets,verifyQuantIntroductionAssets,QUANT_RUNTIME_WEB_ASSETS} from '../scripts/verify-versioned-assets.mjs';

const [archive,commit]=process.argv.slice(2);
assert.match(commit??'',/^[a-f0-9]{40}$/u);
const root=path.resolve(import.meta.dirname,'../../..'),release=`ynx-quant-lab-${commit.slice(0,12)}`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const extract=name=>execFileSync('tar',['-xOf',archive,`${release}/${name}`],{maxBuffer:16*1024*1024});
const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n');
const expected=[...QUANT_RUNTIME_WEB_ASSETS.map(n=>`${release}/apps/quant-lab/web/${n}`),`${release}/ynx-quantd`,`${release}/BUNDLE_MANIFEST.json`,`${release}/SHA256SUMS`];
assert.deepEqual([...names].sort(),expected.sort());
const manifest=JSON.parse(extract('BUNDLE_MANIFEST.json'));
assert.equal(manifest.sourceCommit,commit);
assert.equal(manifest.sourceTree,execFileSync('git',['rev-parse',`${commit}^{tree}`],{cwd:root,encoding:'utf8'}).trim());
assert.deepEqual(manifest.entries.map(e=>e.path).sort(),names.filter(n=>!n.endsWith('/BUNDLE_MANIFEST.json')&&!n.endsWith('/SHA256SUMS')).sort());
for(const entry of manifest.entries){const b=extract(entry.path.slice(release.length+1));assert.equal(b.length,entry.bytes);assert.equal(sha(b),entry.sha256)}
const sums=extract('SHA256SUMS').toString().trim().split('\n').map(l=>l.split('  '));
assert.deepEqual(sums.map(([,n])=>`${release}/${n}`).sort(),names.filter(n=>!n.endsWith('/SHA256SUMS')).sort());
for(const [hash,name] of sums)assert.equal(sha(extract(name)),hash);
const assets=new Map();
for(const name of QUANT_RUNTIME_WEB_ASSETS){const p=`apps/quant-lab/web/${name}`,b=extract(p);assert.ok(b.equals(execFileSync('git',['show',`${commit}:${p}`],{cwd:root})));assets.set('/'+name,b)}
verifyQuantVersionedAssets(assets.get('/index.html').toString(),name=>assets.get('/'+name));
verifyQuantIntroductionAssets(assets.get('/introduction.html').toString(),name=>assets.get('/'+name));
const binary=extract('ynx-quantd');assert.equal(binary.subarray(0,4).toString('hex'),'7f454c46');assert.equal(binary[4],2);assert.equal(binary[5],1);assert.equal(binary.readUInt16LE(18),62);assert.ok(binary.includes(Buffer.from(commit)));
const evidence=await mkdtemp(path.join(tmpdir(),'ynx-quant-packaged-browser-'));
const browser=await chromium.launch(await financeBrowserLaunchOptions()),results=[];
try{for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[],requests=[],served=new Set();
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url()),name=url.pathname==='/'?'/introduction.html':url.pathname==='/app'?'/index.html':url.pathname;
    if(url.origin==='https://quant.example'&&assets.has(name)){served.add(name);return route.fulfill({body:assets.get(name),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html'})}
    return route.fulfill({status:503,contentType:'application/json',body:'{"error":"API_UNAVAILABLE"}'});
  });
  await page.goto('https://quant.example/app#research');await page.waitForFunction(()=>typeof quantHTTP==='function');
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.locator('.product-logo').evaluate(img=>img.decode());
  assert.equal(await page.locator('#install-wallet').getAttribute('href'),'https://www.ynxweb4.com/dapp/download');
  assert.equal(await page.locator('#install-metamask').getAttribute('href'),'https://metamask.io/download/');
  await page.locator('nav button[data-view="paper"]').click();
  await page.locator('.ui-preferences summary').click();await page.selectOption('#ui-text-size','large');
  await page.reload();assert.equal(await page.locator('#ui-text-size').inputValue(),'large');
  assert.equal(page.url(),'https://quant.example/app#research');assert.equal(context.pages().length,1);
  assert.equal(requests.filter(r=>r.method!=='GET').length,0);assert.ok(!requests.some(r=>r.url.startsWith('ynxwallet:')));assert.deepEqual(errors,[]);
  const screenshot=path.join(evidence,`quant-${width}.png`);await page.screenshot({path:screenshot,fullPage:false});
  const introStart=requests.length;await page.goto('https://quant.example/');await page.locator('figure img').evaluate(img=>img.decode());
  assert.ok(!requests.slice(introStart).some(r=>/wallet-auth\.js|\/api\//u.test(r.url)));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual([...served].sort(),[...assets.keys()].sort());
  await page.screenshot({path:path.join(evidence,`introduction-${width}.png`),fullPage:true});
  const image=await readFile(screenshot);results.push({width,loadedAssets:[...served].sort(),pageErrors:errors,nonGetRequests:0,tabCount:1,english:true,displayPreferenceRestored:true,screenshot:{path:screenshot,bytes:image.length,sha256:sha(image)}});
  await context.close();
}}finally{await browser.close()}
console.log(JSON.stringify({sourceCommit:commit,archiveSha256:sha(await readFile(archive)),evidence,results,deployedPublic:false,installed:false,walletApproval:false,transactions:false},null,2));
