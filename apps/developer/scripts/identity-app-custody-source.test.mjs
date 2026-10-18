import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {identityAppCustodyPins,verifyIdentityAppCustodySource} from './identity-app-custody-source.mjs';
test('App successor requires its own explicit root, never silently uses sealed NAPI sources',async()=>{
  await assert.rejects(verifyIdentityAppCustodySource('relative'),/source root required/);
  assert.equal(identityAppCustodyPins.length,2);
});
test('exact R109 App source verifies; changed or symlinked holder is refused',{
  skip:!process.env.YNX_DEVELOPER_CANONICAL_APP_NATIVE_ROOT?'Exact Auth R109 source not supplied':false,
},async()=>{
  const source=process.env.YNX_DEVELOPER_CANONICAL_APP_NATIVE_ROOT;
  assert.equal((await verifyIdentityAppCustodySource(source)).nativeQualified,false);
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'ynx-app-custody-'));
  try{
    await fs.mkdir(path.join(root,'packages/wallet-auth/native'),{recursive:true});
    for(const pin of identityAppCustodyPins)await fs.copyFile(path.join(source,pin.path),path.join(root,pin.path));
    await verifyIdentityAppCustodySource(root);
    const holder=path.join(root,identityAppCustodyPins[1].path);
    await fs.appendFile(holder,'\n');await assert.rejects(verifyIdentityAppCustodySource(root),/source differs/);
    await fs.unlink(holder);await fs.symlink(path.join(source,identityAppCustodyPins[1].path),holder);
    await assert.rejects(verifyIdentityAppCustodySource(root),/source differs/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
