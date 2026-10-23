import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const fixture=fileURLToPath(new URL('./fixtures/pq-contract-deploy-fbec-public.json',import.meta.url));
const consumer=fileURLToPath(new URL('./pq-contract-deployment-go-interop.mjs',import.meta.url));
const sha='ca39d8b803a118bb468ce2806cf7654ccf120c091c0364f973e859fedeba5982';
const run=(file,hash)=>spawnSync(process.execPath,[consumer,file,hash],{encoding:'utf8',timeout:15000,maxBuffer:131072});
test('actual Go compiled deployment and SDK333 match exact five-field bytes and original N2 dual math',t=>{
  const r=run(fixture,sha);assert.equal(r.status,0,r.stderr);
  const out=JSON.parse(r.stdout);assert.equal(out.exactFiveFieldInterop,true);
  assert.equal(out.originalRegisteredDualMath,true);assert.equal(out.memberN,2);assert.equal(out.memberIndex,1);
  assert.equal(out.memberSHA256,'6f29de10adf0d203dee00c5e2dbd8f84ac91b6b44ab8a1fc06ad43b24560f1ff');
  assert.equal(out.transportSHA256,'dcc3882a42e02b4c92affee5175804f22e7ca66dc90e85d203e54f4ad84b73f6');
  assert.equal(out.broadcastExecuted,false);assert.equal(out.independentFinality,false);assert.equal(out.nativeGrant,false);
  t.diagnostic(JSON.stringify(out));
});
test('negative original fixture identity cannot be replaced by a caller digest claim',()=>{
  const r=run(fixture,'00'.repeat(32));assert.equal(r.status,1);assert.match(r.stderr,/original Go artifact identity/);
});
function negativeCopy(change,expected){
  // Deliberately corrupted PUBLIC copies only. The original Go fixture is never
  // modified and no synthetic input is used as positive interop evidence.
  const dir=mkdtempSync(join(tmpdir(),'ynx-go-deploy-negative-'));
  try{
    const dto=JSON.parse(readFileSync(fixture));change(dto);
    const raw=JSON.stringify(dto),file=join(dir,'negative-public-copy.json');writeFileSync(file,raw);
    const r=run(file,createHash('sha256').update(raw).digest('hex'));
    assert.equal(r.status,1,r.stdout);assert.match(r.stderr,expected);
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test('negative omitted zero value cannot masquerade as the complete signed Go payload',()=>{
  negativeCopy(f=>{delete f.payload.value;},/complete signed Go payload, including value/);
});
test('negative consumed nonce is rejected by original SDK snapshot and action binding',()=>{
  negativeCopy(f=>{f.accountBefore.ledgerNonce=f.nonce;f.nonce=String(BigInt(f.nonce)+1n);},/PQ_ACTION_REVIEW_MISMATCH/);
});
