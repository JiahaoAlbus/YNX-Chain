import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root=new URL('../',import.meta.url);
const candidate=JSON.parse(await readFile(new URL('evidence/finance-aligned-runtime-candidate-20260831.json',root),'utf8'));

test('aligned candidate preserves the current public resource set while retaining the intended backend identity',async()=>{
  assert.equal(candidate.combinedSource.backendSourceCommit,'7824af677dd052d20321431381523ab302614d98');
  assert.equal(candidate.combinedSource.publicFrontendSourceCommit,'75f0299aaf53263e4279acf93e9a06db9d055e38');
  assert.equal(candidate.publicFrontendAssets.length,7);
  for(const asset of candidate.publicFrontendAssets){
    const relative=asset.relativePath.replace(/^web\//,'web/');
    const bytes=await readFile(new URL(relative,root));
    assert.equal(bytes.byteLength,asset.bytes,asset.relativePath);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.relativePath);
  }
  assert.equal(candidate.invalidatedExecutionObjects.deployAllowed,false);
  assert.equal(candidate.truth.deployed,false);
});
