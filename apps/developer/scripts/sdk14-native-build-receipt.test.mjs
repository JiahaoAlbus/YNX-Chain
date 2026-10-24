import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,rm,symlink,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateCanonicalNativeBuildReceipt,copyCanonicalIdentityHelper} from './package-identity-admission-source.mjs';
const inputs=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
test('actual A SDK36 record retains executed provenance and rejects changed or incomplete evidence',async()=>{
  const root=process.env.YNX_DEVELOPER_CANONICAL_NATIVE_ROOT;
  assert.ok(root,'Original fixed SDK36 component root required.');
  const original=JSON.parse(await readFile(join(root,inputs.nativeComponent.receipt.path)));
  const view=validateCanonicalNativeBuildReceipt(original,inputs,'arm64');
  assert.equal(view,original); // SDK36 producer uses the normal record directly.
  assert.equal(view.inputFiles.length,112);assert.equal(view.readbackOnly,false);
  assert.equal(view.nativeQualified,false);assert.equal(view.registrationAccepted,false);
  for(const mutate of [r=>r.helperBuild.inputFiles.pop(),r=>r.inputFiles.pop(),r=>r.exitCodes[0]=1,
    r=>r.nativeQualified=true,r=>r.helperBuild.executed=false,r=>r.ownedUndefinedScan.ownedUndefined.push('PUBLIC_FOREIGN_OWNED_SYMBOL'),r=>{delete r.ownedUndefinedScan;},r=>{r.helperBuild.ownedUndefinedScan={};},r=>r.registrationAccepted=true,r=>r.commands[0].argv.push('-DUNREVIEWED=1'),
    r=>r.helperBuild.output.sha256='0'.repeat(64),r=>r.inputFiles[0].sha256='0'.repeat(64)]){
    const changed=structuredClone(original);mutate(changed);
    assert.throws(()=>validateCanonicalNativeBuildReceipt(changed,inputs,'arm64'),/differs/);
  }
});
test('helper is copied to the original bundle contract, without install, and refuses replacement or symlink escape',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ynx-sdk14-helper-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const app=join(root,'Candidate.app'),code=join(app,'Contents/Resources/code');await mkdir(code,{recursive:true});
  const result=await copyCanonicalIdentityHelper(code);
  assert.equal(result.installed,false);assert.equal(result.registered,false);
  assert.equal((await stat(join(app,result.helper))).mode&0o777,0o755);
  assert.match(await readFile(join(app,result.plist),'utf8'),/<string>Contents\/Library\/HelperTools\/YNXIdentityReceiver<\/string>/);
  await assert.rejects(copyCanonicalIdentityHelper(code),/EEXIST/);
  const other=join(root,'Other.app'),otherCode=join(other,'Contents/Resources/code'),trap=join(root,'trap');
  await mkdir(otherCode,{recursive:true});await mkdir(trap);await symlink(trap,join(other,'Contents/Library'));
  await assert.rejects(copyCanonicalIdentityHelper(otherCode),/Regular helper bundle directory required/);
  assert.deepEqual(await readdir(trap),[]);
});
