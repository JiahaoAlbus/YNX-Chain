import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
// Original A's recovered R3 build proves the App's own locked QR dependency
// is valid. These guards do not invent a stricter SDK-only ownership rule.
test('normal first-party QR resolves from the declared exact App lock, not an ancestor package',async()=>{
 const require=createRequire(new URL('../package.json',import.meta.url));
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
 assert.equal(pkg.dependencies.qrcode,'1.5.4');assert.equal(lock.packages['node_modules/qrcode'].version,'1.5.4');
 const modules=await realpath(new URL('../node_modules',import.meta.url));const entry=await realpath(require.resolve('qrcode'));
 assert.ok(entry.startsWith(path.join(modules,'qrcode')+path.sep));
 const metadata=JSON.parse(await readFile(path.join(modules,'qrcode/package.json'),'utf8'));
 assert.equal(metadata.version,'1.5.4');assert.equal(metadata.browser[metadata.main],'./lib/browser.js');
});
test('normal entry includes actual App caller modules and does not leave QR external for runtime repair',async()=>{
 const entry=await readFile(new URL('../web-connect/entry.mjs',import.meta.url),'utf8');
 assert.ok(entry.includes("from 'qrcode'"));assert.ok(entry.includes("from '../src/walletconnect-address-page.mjs'"));
 const page=await readFile(new URL('../src/walletconnect-address-page.mjs',import.meta.url),'utf8');
 assert.ok(page.includes("from './walletconnect-address-consumer.mjs'"));
 const script=await readFile(new URL('../scripts/build-wallet-connection-page.mjs',import.meta.url),'utf8');assert.equal(/external\s*:/.test(script),false);
});
