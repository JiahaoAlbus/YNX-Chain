import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {assertSDKRuntimePackCoverage,fixedSDKRuntimeManifestSources,relocateDesktopRuntimeSource,FIXED_SDK_RUNTIME_IDENTITIES} from '../scripts/release-provenance.mjs';
import {readSDK46ProductRuntime,assertSDK46ProductArchive,assertSDK46CanonicalRuntimeManifest} from '../scripts/sdk46-product-runtime.mjs';
import {SDK_CANONICAL} from '../scripts/canonical-package.mjs';
const root=process.env.WALLET_SDK46_APP_SOURCE_ROOT,commit='2ccf26b5c72b90facddd536d30934e3ffb475ccb',needed={skip:!root?'requires actual original A SDK46 App source2cc':false};
const git=p=>execFileSync('git',['show',commit+':'+p],{cwd:root,maxBuffer:8<<20});
function suppliedFixture(t){
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-sdk46-App-metadata-')));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const h=JSON.parse(fs.readFileSync('/Volumes/西部数据/YNX-large-work/wallet-auth-owned-ci-20261026/sdk46-migration-proof/SDK46_MIGRATION_POSSESSION_RUNTIME_HANDOFF.json'));
 const copy=(from,to)=>{const file=path.join(temp,to);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(from,file);};
 for(const p of [h.runtime.product.Auth,h.runtime.product.union,h.runtime.product.selection,h.runtime.product.staticSourceAnalysis,h.runtime.product.projectionReceipt,h.runtime.product.finitePolicy])copy(p.path,'runtime-projections/sdk46-product/'+path.basename(p.path));
 copy(h.runtime.Auth.path,'packages/wallet-auth/native/original-ide-auth-runtime-manifest.json');copy(h.runtime.union.path,'packages/wallet-auth/native/original-ide-contract-relay-runtime-manifest.json');
 for(const p of ['packages/wallet-auth/package.json','apps/wallet-desktop/package.json']){const file=path.join(temp,p);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,git(p));}
 const run=(...args)=>execFileSync('git',args,{cwd:temp,stdio:'pipe'});run('init','-q');run('add','.');run('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','Exact SDK46 App supplier metadata with missing full Auth supplied');return temp;
}
test('normal SDK46 App pack coverage accepts exact full/Auth/product identities after formal missing Auth source supply',needed,t=>{
 const supplied=suppliedFixture(t);
 assert.deepEqual(FIXED_SDK_RUNTIME_IDENTITIES['1.3.0-pq.3.32-auth.46'],{bytes:81401,sha256:'8caa2a369c923c4ad8249c2d897ff4a9882c7f5a58b8a647decd07eeb38ced4a'});
 assert.equal(fixedSDKRuntimeManifestSources(supplied,'HEAD').length,2);const checked=assertSDKRuntimePackCoverage(path.join(supplied,'apps/wallet-desktop'),'HEAD');assert(checked.executableSDKRowsChecked>100);assert.equal(checked.runtimeQualified,false);
 assert.throws(()=>fixedSDKRuntimeManifestSources(root,commit),/Required SDK runtime manifest is missing/);
});
test('SDK46 complete product uses explicit finite15 rows, exact9573/562/9423 and rejects changed or excluded archive members',needed,t=>{
 const p=readSDK46ProductRuntime(suppliedFixture(t),'HEAD');assert(p);assert.equal(p.selected.size,9573);assert.equal(p.authRows.size,562);assert.equal(p.unionRows.size,9423);assert.equal(p.excluded.size,15);assert.equal(p.manifestRows.length,2);assert.equal(p.public.SourceQualified,false);
 const inventory=[...p.selected.values()].map(row=>({...row,path:SDK_CANONICAL+'/'+row.path,type:'file'}));inventory.push(...p.manifestRows.map(row=>({...row,type:'file'})));assertSDK46ProductArchive(p,inventory);
 const bad=structuredClone(inventory);bad[0].sha256='0'.repeat(64);assert.throws(()=>assertSDK46ProductArchive(p,bad));assert.throws(()=>assertSDK46ProductArchive(p,[...inventory,{path:SDK_CANONICAL+'/'+p.excluded.keys().next().value,type:'file',bytes:1,sha256:'0'.repeat(64)}]));assert.throws(()=>assertSDK46ProductArchive(p,[...inventory,{path:SDK_CANONICAL+'/native/foreign.mjs',type:'file',bytes:1,sha256:'0'.repeat(64)}]));
});
test('SDK46 retains exact existing three Native URL contracts without text relocation or IO admission',needed,()=>{
 for(const [name,count]of [['original-ide-admission-parent-delivery.js',3],['original-auth-source-current-v2.js',1],['original-auth-source-issuance-v2.js',1]]){const sourcePath='packages/wallet-auth/src/'+name,bytes=git(sourcePath),result=relocateDesktopRuntimeSource(sourcePath,bytes,'1.3.0-pq.3.32-auth.46');assert(result.bytes.equals(bytes));assert.equal(result.operands[0].count,count);const extra=Buffer.concat([bytes,Buffer.from('\nnew URL("../../../apps/wallet-desktop/native/original-auth-identity.node", import.meta.url)')]);assert.throws(()=>relocateDesktopRuntimeSource(sourcePath,extra,'1.3.0-pq.3.32-auth.46'));}
});
test('SDK46 canonical generated manifests do not trim or accept terminal LF',()=>{const bytes=Buffer.from(JSON.stringify({files:[],version:'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'}));assertSDK46CanonicalRuntimeManifest(bytes);assert.throws(()=>assertSDK46CanonicalRuntimeManifest(Buffer.concat([bytes,Buffer.from('\n')])));});
