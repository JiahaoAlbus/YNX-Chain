import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyQuantVersionedAssets,QUANT_RUNTIME_WEB_ASSETS,QUANT_APPLICATION_ASSETS} from '../scripts/verify-versioned-assets.mjs';
const web=new URL('../web/',import.meta.url);
const html=readFileSync(new URL('index.html',web),'utf8');
const read=name=>readFileSync(new URL(name,web));
test('runtime inventory binds every page dependency, including display preferences and branding',()=>{
  assert.equal(verifyQuantVersionedAssets(html,read).assets,6);
  assert.equal(QUANT_RUNTIME_WEB_ASSETS.length,11);
  assert.ok(!QUANT_RUNTIME_WEB_ASSETS.includes('wallet-auth-entry.js'));
});
for(const name of QUANT_APPLICATION_ASSETS){
  test(`reject altered runtime bytes: ${name}`,()=>assert.throws(()=>verifyQuantVersionedAssets(html,n=>n===name?Buffer.from('changed'):read(n))));
  test(`reject missing page dependency: ${name}`,()=>assert.throws(()=>verifyQuantVersionedAssets(html.replace(new RegExp(`<(?:script|link|img)[^>]*(?:src|href)="/${name.replaceAll('.','\\.')}\\?[^>]*>(?:</script>)?`,'u'),''),read)));
}
test('reject duplicate and unknown page assets',()=>{
  assert.throws(()=>verifyQuantVersionedAssets(html+html,read),/DUPLICATE/);
  assert.throws(()=>verifyQuantVersionedAssets(html+'<script src="/unknown.js"></script>',read),/UNTRACKED/);
});
