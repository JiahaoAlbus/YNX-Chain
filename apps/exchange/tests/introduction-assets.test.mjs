import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyExchangeIntroductionAssets} from '../web/verify-versioned-assets.mjs';
const web=new URL('../web/',import.meta.url),html=readFileSync(new URL('introduction.html',web),'utf8'),read=n=>readFileSync(new URL(n,web));
test('public introduction exact graph loads only its own script and actual image',()=>{
 assert.equal(verifyExchangeIntroductionAssets(html,read).assets,5);
 assert.doesNotMatch(html,/wallet-connect\.js|private-session\.js|<iframe/);
 const script=read('introduction.js').toString();assert.doesNotMatch(script,/\bfetch\s*\(|eth_requestAccounts|window\.open|ynxwallet:|navigator\.mediaDevices/);
});
for(const name of ['introduction.css','introduction.js','ynx-logo.png','ynx-favicon.png','exchange-workspace-preview.png'])test(`introduction rejects tampered ${name}`,()=>assert.throws(()=>verifyExchangeIntroductionAssets(html,n=>n===name?Buffer.from('bad'):read(n))));
test('introduction rejects duplicate graph',()=>assert.throws(()=>verifyExchangeIntroductionAssets(html+html,read)));
