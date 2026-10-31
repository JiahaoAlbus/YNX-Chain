import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {bindIDE49DaemonSource} from '../scripts/ide-sdk49-daemon-composition.mjs';
import {readSDK49ProductRuntime} from '../scripts/sdk49-product-runtime.mjs';
import {assertSDKRuntimePackCoverage} from '../scripts/release-provenance.mjs';
const root=fileURLToPath(new URL('../../..',import.meta.url)),git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim(),sourceCommit=git('rev-parse','HEAD');
const compositionRaw=gunzipSync(fs.readFileSync(new URL('./fixtures/ide49-daemon-composition.json.gz',import.meta.url))),inventoryRaw=fs.readFileSync(path.join(root,'runtime-projections/sdk49-full/SDK49_COMPLETE_NORMAL_PREFIX_FILE_INVENTORY.json'));
const bind=patch=>bindIDE49DaemonSource({root,sourceCommit,compositionRaw,inventoryRaw,...patch});
test('actual Main daemon source binds original IDE445/430 inputs and preserves all incoming unavailable qualifications',()=>{
 const result=bind();assert.equal(result.fullSourceWithAliases,445);assert.equal(result.productSourceWithAliases,430);assert.equal(result.dependencies,9184);assert.equal(result.MainNodeProjectionMatched,true);
 for(const name of ['nativeComponent','helperComponent','matchingMainComposition','normalPlans'])assert.equal(result[name],null);
 for(const name of ['newRuntimeQualified','NativeAdmission','SourceAdmission','RootAdmission','installed'])assert.equal(result[name],false);
 const p=readSDK49ProductRuntime(root,sourceCommit);assert.equal(p.selected.size,9612);assert.equal(p.public.sourceVariant,'SDK49-PAIR-ISSUER-ORIGINAL-DAEMON/v1');
 assert.equal(assertSDKRuntimePackCoverage(path.join(root,'apps/wallet-desktop'),sourceCommit).runtimeQualified,false);
});
test('IDE source input cannot change a byte, borrow an older prefix or acquire a component/normal plan',()=>{
 assert.throws(()=>bind({compositionRaw:Buffer.concat([compositionRaw,Buffer.from('\n')])}));
 const changed=JSON.parse(compositionRaw);changed.nativeComponent={kind:'invented'};changed.newRuntimeQualified=true;
 assert.throws(()=>bind({compositionRaw:Buffer.from(JSON.stringify(changed))}));
 const older=execFileSync('git',['show','d1e5c18498780c3f3b448ccbf5f6708067d7684e:runtime-projections/sdk49-full/SDK49_COMPLETE_NORMAL_PREFIX_FILE_INVENTORY.json'],{cwd:root});
 assert.throws(()=>bind({inventoryRaw:older}));
});
test('source-only successor does not carry the previous compiled module or its executed record',()=>{
 const names=git('ls-tree','-r','--name-only',sourceCommit,'--','apps/wallet-desktop/native/original-auth-identity.node','apps/wallet-desktop/native/original-auth-identity-build.json');assert.equal(names,'');
});
