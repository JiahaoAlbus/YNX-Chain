import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {verifySDK49FullRuntimeTables,verifySDK49NormalSource} from '../scripts/sdk49-runtime-source.mjs';
const root=fileURLToPath(new URL('../../../packages/wallet-auth',import.meta.url));
const full=()=>['original-ide-auth-runtime-manifest.json','original-ide-contract-relay-runtime-manifest.json'].map(n=>fs.readFileSync(root+'/native/'+n));
test('coherent SDK49 full Auth590 and union9450 match; projected product tables cannot be used as Native full tables',()=>{
 const [auth,union]=full();assert.equal(verifySDK49FullRuntimeTables(auth,union).fullAuthSubsetOfFullUnion,true);
 const product=fileURLToPath(new URL('../../../runtime-projections/sdk49-product/',import.meta.url));
 for(const pair of [[fs.readFileSync(product+'original-ide-auth-runtime-manifest.json'),union],[auth,fs.readFileSync(product+'original-ide-contract-relay-runtime-manifest.json')],[Buffer.concat([auth,Buffer.from('\n')]),union]])assert.throws(()=>verifySDK49FullRuntimeTables(...pair),/WALLET_SDK49_COHERENT_SOURCE_REQUIRED/);
});
test('actual normal SDK49 prefix9606 source readback uses original inventory and rejects old version or altered inventory',{skip:process.env.WALLET_SDK49_FULL_SOURCE!=='1'},()=>{
 const raw=fs.readFileSync('/Volumes/西部数据/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-pq-device-session/runtime-r2/SDK49_COMPLETE_NORMAL_PREFIX_FILE_INVENTORY.json');
 const result=verifySDK49NormalSource(root,raw);assert.equal(result.normalPrefixFiles,9606);assert.equal(result.NativeAdmission,false);assert.equal(result.issuerSupplied,false);
 assert.throws(()=>verifySDK49NormalSource(root,Buffer.concat([raw,Buffer.from('\n')])),/WALLET_SDK49_COHERENT_SOURCE_REQUIRED/);
 const j=JSON.parse(raw);j.versionSDK='1.3.0-pq.3.32-auth.48';assert.throws(()=>verifySDK49NormalSource(root,Buffer.from(JSON.stringify(j))),/WALLET_SDK49_COHERENT_SOURCE_REQUIRED/);
});
