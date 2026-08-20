import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const productRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));

test('P0 release evidence verifies without an APK',()=>{
  const output=execFileSync(process.execPath,['scripts/verify-p0-release-evidence.mjs'],{cwd:productRoot,encoding:'utf8'});
  const report=JSON.parse(output);
  assert.equal(report.endpointManifest.exchangeProductStatus,'PENDING');
  assert.equal(report.releaseStates.deployedPublic,false);
  assert.equal(report.connectivityBoundary.productSession,'PENDING_AND_NOT_CALLED');
});
