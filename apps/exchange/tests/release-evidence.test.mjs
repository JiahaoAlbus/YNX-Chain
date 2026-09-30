import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {mkdtemp,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const productRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));

test('P0 release evidence verifies without an APK',()=>{
  const output=execFileSync(process.execPath,['scripts/verify-p0-release-evidence.mjs'],{cwd:productRoot,encoding:'utf8'});
  const report=JSON.parse(output);
  assert.equal(report.endpointManifest.exchangeProductStatus,'PENDING');
  assert.equal(report.releaseStates.deployedPublic,false);
  assert.equal(report.connectivityBoundary.canonicalWalletAuthorization,'SOURCE_VERIFIED_REQUEST_BOUND_ONLY');
  assert.equal(report.connectivityBoundary.productSession,'SOURCE_VERIFIED_WEB_READ_ONLY_MOBILE_PENDING');
  assert.equal(report.connectivityBoundary.historicalMobileProductSession,'PENDING_AND_NOT_CALLED');
  assert.equal(report.connectivityBoundary.browserIdentity,'EXACT_BOUNDED_SAME_ORIGIN_IDENTITY_ONLY');
  assert.equal(report.connectivityBoundary.publicBusinessSuccess,false);
});
test('historical P0 gate cannot whitelist business API or arbitrary identity helper calls',async()=>{
  for(const mutate of [value=>value.replace('/api/v1/sso/${path}','/api/v1/orders/${path}'),value=>value.replace("browserIdentityRequest('account')","browserIdentityRequest('orders')")]){
    const temporary=await mkdtemp(join(tmpdir(),'ynx-exchange-p0-negative-'));
    try{
      const target=resolve(temporary,'apps/exchange');
      for(const name of ['scripts/verify-p0-release-evidence.mjs','product-release.json','mobile/contract/public-endpoint-manifest.json','mobile/src/wallet.ts','mobile/src/api.ts','mobile/App.tsx','web/app.js']){
        const path=resolve(target,name);await mkdir(dirname(path),{recursive:true});const body=await readFile(resolve(productRoot,name));await writeFile(path,name==='web/app.js'?mutate(body.toString('utf8')):body);
      }
      assert.throws(()=>execFileSync(process.execPath,['scripts/verify-p0-release-evidence.mjs'],{cwd:target,stdio:'pipe'}),error=>/Web identity helper (?:is not|called a non-identity route)/u.test(error.stderr.toString()));
    }finally{await rm(temporary,{recursive:true,force:true})}
  }
});
