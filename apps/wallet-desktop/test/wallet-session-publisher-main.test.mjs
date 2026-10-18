import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import path from 'node:path';
import * as connection from '@ynx-chain/wallet-auth/product-wallet-connection';

test('matching SDK exposes the normal fixed-origin narrow return publisher and rejects endpoint/provider injection',()=>{
 assert.equal(typeof connection.createProductWalletReturnPublisher,'function');
 const factory=connection.createProductWalletReturnPublisher,client=factory({gatewayTimeoutMs:15000});
 assert.deepEqual(Object.keys(client).sort(),['currentTime','publicationOutcome','publishReturn']);assert.equal(Object.isFrozen(client),true);
 for(const extra of [{endpoint:'https://invalid.example'},{fetch:()=>{}},{provider:{}},{key:'not-a-key'}])assert.throws(()=>factory({gatewayTimeoutMs:15000,...extra}));
});
test('actual normal main constructor installs that fixed SDK publisher beside the original Source and journal',async()=>{
 const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),start=main.indexOf('walletAuthority = new DesktopWalletAuthority({'),end=main.indexOf('\n  authorizationController =',start);
 assert.ok(start>=0&&end>start);const client=Object.freeze({fixedOriginalPublisher:true});let options,calls=0;
 const context={walletAuthority:null,DesktopWalletAuthority:class{constructor(value){options=value;}},createProductWalletReturnPublisher(config){calls++;assert.equal(JSON.stringify(config),JSON.stringify({gatewayTimeoutMs:15000}));return client;},acquireOriginalWalletTransactionPolicy(){},isOriginalWalletTransactionPolicy(){},acquireOriginalAccountPolicy(){},isOriginalAccountPolicyResource(){},PQ_CANONICAL_NETWORK_ID:'network',passwordVault:{},FilePermissionStore:class{},CanonicalTransactionSender:class{},FileTransactionIntentStore:class{},accountNetwork:{},net:{fetch(){}},readOriginalTransaction(){},path,userData:'/isolated-qa'};
 runInNewContext(main.slice(start,end),context);assert.equal(calls,1);assert.equal(options.sessionReturnClient,client);assert.equal(options.pqSessionSource,context.acquireOriginalAccountPolicy);
 assert.match(main,/import\s*\{\s*createProductWalletReturnPublisher\s*\}\s*from\s*['"]@ynx-chain\/wallet-auth\/product-wallet-connection['"]/);
});
test('Desktop and mobile source-linked lock metadata name the same SDK and optional peer as exact source',async()=>{
 const sdk=JSON.parse(await readFile(new URL('../../../packages/wallet-auth/package.json',import.meta.url),'utf8'));
 for(const file of ['../package-lock.json','../../wallet/package-lock.json']){
  const lock=JSON.parse(await readFile(new URL(file,import.meta.url),'utf8')),entry=lock.packages['../../packages/wallet-auth'];
  assert.equal(entry.version,sdk.version);assert.deepEqual(entry.dependencies,sdk.dependencies);assert.deepEqual(entry.peerDependencies,sdk.peerDependencies);assert.deepEqual(entry.peerDependenciesMeta,sdk.peerDependenciesMeta);
 }
});
