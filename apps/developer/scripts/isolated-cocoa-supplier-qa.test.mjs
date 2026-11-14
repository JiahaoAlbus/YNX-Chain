import test from 'node:test';import assert from 'node:assert/strict';
import {assertIsolatedQAProfile,runIsolatedCocoaSupplierQA} from './isolated-cocoa-supplier-qa.mjs';
test('isolated QA cannot be selected through a different handoff or promoted to current product/R2',async()=>{
 await assert.rejects(runIsolatedCocoaSupplierQA('/tmp/other','--execute'));
 const m={kind:'SDK49_P03_ORDINARY_ISOLATED_COCOA_QA_NOT_R2/v1',R2:false,objectCount:36,sourceCount:373,strictUndefinedError:true,formalBuildOwner:'Original A only',qaOutputRoot:'/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/sdk49-cocoa-isolated-base-qa-20261101'},s={commit:'742e00be6058312088afe80e30210dab76d15052',tree:'d58dbadf683f25f718feef827dbc3ffd627bd02b',files:Array(373)};
 assert.doesNotThrow(()=>assertIsolatedQAProfile(m,s));
 for(const change of [{R2:true},{objectCount:35},{strictUndefinedError:false},{qaOutputRoot:'/tmp/elsewhere'}])assert.throws(()=>assertIsolatedQAProfile({...m,...change},s));
 const next={...m,qaOutputRoot:m.qaOutputRoot+'-tmpfix'};next.temporaryEnvironment={TMPDIR:'/tmp/ynx-ide-cocoa-q2',target:next.qaOutputRoot+'/temp',cacheRoot:next.qaOutputRoot+'/cache',owner:process.getuid()};assert.doesNotThrow(()=>assertIsolatedQAProfile(next,s,'-tmpfix'));assert.throws(()=>assertIsolatedQAProfile(next,s));assert.throws(()=>assertIsolatedQAProfile({...next,temporaryEnvironment:{...next.temporaryEnvironment,TMPDIR:'/tmp/other'}},s,'-tmpfix'));
 await assert.rejects(runIsolatedCocoaSupplierQA('/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-cocoa-isolated-qa-successor-20261101/HANDOFF.json','--execute'),/readback-only/);
});
