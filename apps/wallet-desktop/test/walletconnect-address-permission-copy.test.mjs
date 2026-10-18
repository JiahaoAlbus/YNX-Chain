import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {walletCopy,WALLET_LOCALES} from '../src/wallet-locale.mjs';
const NOTICE='Share only your public address. This session cannot request signatures, transfers or sign-in.';
const source=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');
const begin=source.indexOf('    document.querySelector("#proposal-name")'),end=source.indexOf('    for (const button',begin);
function actual(review,locale){const nodes=new Map();const document={querySelector:id=>{if(!nodes.has(id))nodes.set(id,{textContent:''});return nodes.get(id);}};runInNewContext(source.slice(begin,end),{document,review,activeAccount:'0x'+'a'.repeat(40),nativeAccountLabel:x=>x,methodLabel:x=>'METHOD:'+x,ADDRESS_ONLY_CONNECTION_NOTICE:NOTICE,copyUI:(node,key)=>node.textContent=walletCopy(locale,key)});return nodes.get('#proposal-permissions').textContent;}
test('actual Mac approval explicitly distinguishes an empty-method address connection',()=>{
 for(const locale of WALLET_LOCALES)assert.equal(actual({name:'PUBLIC',url:'https://wallet.ynxweb4.com',methods:[]},locale),walletCopy(locale,NOTICE));
});
test('signing or missing permissions cannot acquire the address-only assurance',()=>{
 assert.equal(actual({name:'PUBLIC',methods:['personal_sign']},'en'),'METHOD:personal_sign');
 assert.notEqual(actual({name:'PUBLIC'},'en'),NOTICE);
});
test('Android and Mac address-only copy match in all12 locales at the actual review callers',async()=>{
 const mobileSource=readFileSync(new URL('../../wallet/src/walletConnect/addressOnlyPresentation.ts',import.meta.url),'utf8');
 const mobile=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(mobileSource,{mode:'strip'})).toString('base64'));
 for(const locale of WALLET_LOCALES){assert.equal(mobile.walletConnectAddressOnlyCopy(locale),walletCopy(locale,NOTICE));if(locale!=='en')assert.notEqual(walletCopy(locale,NOTICE),NOTICE);}
 const modal=readFileSync(new URL('../../wallet/src/walletConnect/WalletConnectModal.tsx',import.meta.url),'utf8');
 assert.ok(modal.includes('proposalReview.namespaces.eip155.methods.length===0?'));
 assert.ok(modal.includes('walletConnectAddressOnlyCopy(locale)'));
});
