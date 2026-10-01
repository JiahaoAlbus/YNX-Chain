import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {HOSTED_LOCALES,hostedCopy} from '../src/hosted-i18n.js';
import {webWalletCopy,webWalletCopyCoverage} from '../src/web-wallet-copy.js';
test('Web own-account root uses complete existing-language copy and the same request engine',async()=>{
 const html=await readFile(new URL('../public/web-wallet.html',import.meta.url),'utf8');
 for(const locale of HOSTED_LOCALES){
  for(const match of html.matchAll(/data-web-copy="([^"]+)"/gu))assert.ok(webWalletCopy(locale,match[1])?.trim(),`${locale}:${match[1]}`);
  for(const match of html.matchAll(/data-i18n="([^"]+)"/gu))assert.ok(hostedCopy(locale,match[1])?.trim(),`${locale}:${match[1]}`);
 }
 assert.ok(Object.values(webWalletCopyCoverage()).every(Boolean));
 assert.match(html,/src="\.\/wallet-core\.js"/u);assert.match(html,/href="\.\/companion\.html"/u);
 assert.doesNotMatch(html,/chrome\.|eth_requestAccounts|activeProviderRequest/u);
});
