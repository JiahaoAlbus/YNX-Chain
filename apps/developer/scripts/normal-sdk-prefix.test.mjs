import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { copyPinnedSDKPrefix } from './package-identity-admission-sdk-prefix.mjs';
async function fixture(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-sdk-prefix-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const prefix=join(root,'source');await mkdir(prefix);const body='export const fixed=null;\n';await writeFile(join(prefix,'fixed.mjs'),body);
  return {prefix,destination:join(root,'app/vendor/identity-admission'),sourceCommit:'a'.repeat(40),files:[{path:'fixed.mjs',bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')}]};
}
test('whole prefix copies exact pinned bytes without executing source and refuses replay',async t=>{
  const f=await fixture(t),r=await copyPinnedSDKPrefix(f);
  assert.equal(await readFile(join(f.destination,'fixed.mjs'),'utf8'),'export const fixed=null;\n');
  assert.equal(r.sourceLeaves,1);assert.equal(r.sharedModulesExecuted,false);assert.equal(r.RootAdmission,false);
  await assert.rejects(copyPinnedSDKPrefix(f),{code:'EEXIST'});
});
test('changed, symbolic and escaping SDK inputs refuse instead of partial source substitution',async t=>{
  const changed=await fixture(t);await writeFile(join(changed.prefix,'fixed.mjs'),'modified');await assert.rejects(copyPinnedSDKPrefix(changed),/source differs/);
  const symbolic=await fixture(t);await rm(join(symbolic.prefix,'fixed.mjs'));await symlink('/outside/unprovided',join(symbolic.prefix,'fixed.mjs'));await assert.rejects(copyPinnedSDKPrefix(symbolic),/source differs/);
  const escaped=await fixture(t);escaped.files[0].path='../escape';await assert.rejects(copyPinnedSDKPrefix(escaped),/inventory/);
});
