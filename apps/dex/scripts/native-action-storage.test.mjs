import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../node_modules/esbuild/lib/main.js';
import { chromium } from '../node_modules/playwright-core/index.mjs';

test('actual local Chrome IDB: concurrent tabs, second process, abort, legacy quarantine; no authority or network',async()=>{
  const app=fileURLToPath(new URL('..',import.meta.url));
  const compiled=await build({absWorkingDir:app,entryPoints:['src/native-action-journal.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,define:{'import.meta.env':'{}'},alias:{'@ynx-chain/wallet-auth/src/crypto.js':resolve(app,'node_modules/@ynx-chain/wallet-auth/src/crypto.js')}});
  const source=compiled.outputFiles[0].text,profile=mkdtempSync(join(tmpdir(),'ynx-dex-journal-browser-'));
  const server=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html lang="en"><title>Local native journal storage fixture</title><p>Synthetic storage test only. No account, signature or transaction.</p></html>');}
    if(req.url==='/journal.mjs'){res.setHeader('Content-Type','text/javascript');return res.end(source);}
    res.statusCode=404;res.end();
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${server.address().port}`;
  let context,external=0;
  const launch=async()=>{
    const next=await chromium.launchPersistentContext(profile,{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
    await next.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external++;return route.abort();});
    return next;
  };
  const prepare=async(page)=>{
    await page.goto(origin);
    await page.evaluate(async()=>{window.journalModule=await import('/journal.mjs');window.store=await window.journalModule.openNativeActionStore();});
  };
  try{
    context=await launch();const a=context.pages()[0]??await context.newPage();await prepare(a);
    await a.evaluate(()=>{localStorage.setItem('ynx.dex.legacy-private-key','TEST_SENTINEL_NOT_A_KEY');localStorage.setItem('ynx.dex.wallet-authorize.v1.pending','TEST_LEGACY_SENTINEL');});
    const b=await context.newPage();await prepare(b);
    const changes=Array.from({length:24},(_,i)=>(i%2?a:b).evaluate(async()=>window.store.update('synthetic-counter',old=>String(Number(old??'0')+1))));
    await Promise.all(changes);
    assert.equal(await a.evaluate(()=>window.store.update('synthetic-counter',old=>old)),'24');
    await a.evaluate(()=>window.store.update('synthetic-public-intent',()=>JSON.stringify({fixture:true,nonce:'9007199254740993',status:'pending'})));
    const abort=await a.evaluate(async()=>{try{await window.store.update('synthetic-public-intent',()=>{throw Error('EXPECTED_ABORT');});return false;}catch(e){return e.message==='EXPECTED_ABORT';}});
    assert.equal(abort,true);
    assert.equal(await a.evaluate(async()=>{try{await window.journalModule.createNativeActionJournal(window.store).read('0x2222222222222222222222222222222222222222');return 'bad';}catch(e){return e.code;}}),'NATIVE_ACTION_ORIGIN_UNAVAILABLE');
    assert.equal(context.pages().length,2);assert.equal(a.url(),origin+'/');assert.equal(b.url(),origin+'/');
    await context.close();context=null;
    context=await launch();const second=context.pages()[0]??await context.newPage();await prepare(second);
    assert.equal(await second.evaluate(()=>window.store.update('synthetic-counter',old=>old)),'24');
    assert.equal(await second.evaluate(()=>window.store.update('synthetic-public-intent',old=>old)),JSON.stringify({fixture:true,nonce:'9007199254740993',status:'pending'}));
    assert.deepEqual(await second.evaluate(()=>[localStorage.getItem('ynx.dex.legacy-private-key'),localStorage.getItem('ynx.dex.wallet-authorize.v1.pending')]),['TEST_SENTINEL_NOT_A_KEY','TEST_LEGACY_SENTINEL']);
    await second.evaluate(()=>window.store.update('synthetic-public-intent',()=>null));
    assert.equal(await second.evaluate(()=>window.store.update('synthetic-public-intent',old=>old)),null);
    assert.equal(external,0);
  }finally{
    if(context)await context.close();await new Promise(done=>server.close(done));rmSync(profile,{recursive:true,force:true});
  }
});
