import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {assertHTTPV5CoreInputs,assertHTTPV5CoreExports} from '../scripts/wallet-http-v5-core.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('V5 Core uses its complete frozen component without replacing the old role',()=>{
  const component=assertHTTPV5CoreInputs(root);
  assert.equal(component.source,'8d134c93d3f5500aea01cd0f0f5e88127d4dd37f');
  assert.equal(component.inputs.filter(p=>p.path.endsWith('.a')).length,1);
  assert.equal(component.SourceAdmission,false);assert.equal(component.normalAppCompiled,false);assert.equal(component.installed,false);
});
test('actual arm64 archive exposes V5 alongside old device symbols; old V4 alone is refused',{skip:process.platform!=='darwin'},()=>{
  const archive=path.join(root,'apps/wallet-desktop/native/device-v5-protocol/libynx_artifact_release.a');
  const symbols=execFileSync('/usr/bin/nm',['-gU',archive],{encoding:'utf8'});
  assert.doesNotThrow(()=>assertHTTPV5CoreExports(symbols));
  assert.throws(()=>assertHTTPV5CoreExports(symbols.split('\n').filter(line=>!/_YNXProductSessionHTTPProofSignV5$/.test(line)).join('\n')));
});
