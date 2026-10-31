import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

test('actual Mac Native unsigned23 constructor matches fixed SDK DATA and refuses changed body metadata', {skip:process.platform !== 'darwin'}, async t => {
  const root=fileURLToPath(new URL('..',import.meta.url));
  const directory=await mkdtemp(path.join(tmpdir(),'ynx-v5-unsigned-public-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const fixture=JSON.parse(await readFile(new URL('./fixtures/http-v5-public-body-data.json',import.meta.url),'utf8'));
  const executable=path.join(directory,'public-data-driver');
  execFileSync('/usr/bin/clang++',['-std=c++17','-fobjc-arc','-Werror','-Wall','-Wextra','-Wno-unused-parameter','-mmacosx-version-min=13.0',
    '-I'+path.join(root,'native'),path.join(root,'native/original-product-device-v5-unsigned.mm'),path.join(root,'test/fixtures/http-v5-unsigned-driver.mm'),'-framework','Foundation','-o',executable],{encoding:'utf8'});
  const run=request=>JSON.parse(execFileSync(executable,[],{input:JSON.stringify(request),encoding:'utf8'}));
  const good=run(fixture.request);
  assert.equal(good.ok,true);assert.equal(good.canonicalOriginal,fixture.expectedCanonical);
  const parsed=JSON.parse(good.canonicalOriginal);assert.equal(Object.keys(parsed).length,23);assert.equal(parsed.path,'/api/v1/ide/deployments');
  assert.equal(parsed.packageId,null);assert.equal(parsed.method,'POST');assert.equal(parsed.version,'5');
  const changed=fn=>{const r=structuredClone(fixture.request);fn(r);assert.equal(run(r).ok,false);};
  changed(r=>r.actualBodyLength++);
  changed(r=>r.actualBodyLength=68288513);
  changed(r=>r.actualBodyLength=0);
  changed(r=>r.actualContentType+='X');
  changed(r=>{r.actualContentType='multipart/form-data; boundary="quoted"';r.bodyDATA.contentType=r.actualContentType;});
  changed(r=>r.bodyDATA.bodyBinding.bytes='0267');
  changed(r=>r.bodyDATA.bodyBinding.sha3_512='F'.repeat(128));
  changed(r=>r.bodyDATA.bodyBinding.sha512='a'.repeat(127));
  changed(r=>r.bodyDATA.bodyDigest='a'.repeat(63));
  changed(r=>r.bodyDATA.SourceAdmission=true);
  changed(r=>r.bodyDATA.bodyBinding.extra=true);
  changed(r=>delete r.identity.packageId);
  changed(r=>r.identity.registered=true);
  changed(r=>r.identity.bundleId=false);
  changed(r=>r.identity.origin='https://example.invalid\n');
  changed(r=>r.nonce='short');
  changed(r=>r.expiresAtMs=r.issuedAtMs);
  changed(r=>r.expiresAtMs=r.issuedAtMs+30001);
  changed(r=>r.issuedAtMs=253402300800000);
  // This constructor is DATA only: actual body hash verification, Source
  // qualification/current and the private effect remain owning Core/Native.
  const dataOnly=structuredClone(fixture.request);dataOnly.bodyDATA.bodyBinding.sha3_512='0'.repeat(128);
  assert.equal(run(dataOnly).ok,true);
});
