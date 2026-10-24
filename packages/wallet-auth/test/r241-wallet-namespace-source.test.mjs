import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(new URL(p,import.meta.url));
const digest=b=>createHash('sha256').update(b).digest('hex');
test('R241 normal SDK input binds the repaired Wallet namespace and current package identity',()=>{
 const pkg=JSON.parse(read('../package.json')),lock=JSON.parse(read('../package-lock.json')),inventory=JSON.parse(read('../integration/SDK332_R140_NATIVE_COMPATIBILITY.json'));
 assert.equal(pkg.version,'1.3.0-pq.3.32-auth.37');assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);assert.equal(inventory.version,pkg.version);assert.deepEqual(inventory.publicExports,pkg.exports);
 assert.equal(inventory.NativeInputs.length,99);assert.equal(inventory.HelperInputs.length,5);
 const supplier=read('../../../scripts/ci/fixtures/auth-r241-namespace/SUPPLIER_HANDOFF.json');assert.equal(supplier.length,11797);assert.equal(digest(supplier),'aac646c3e69cce606c66db05f3591ee91e75f45e7ddd96ce9eb1b7542597322a');assert.deepEqual(inventory.supplierR241.handoff,{bytes:supplier.length,sha256:digest(supplier)});
 const row=inventory.NativeInputs.find(r=>r.path==='packages/wallet-auth/native/original-auth-identity-joint-owner.mm'),raw=read('../native/original-auth-identity-joint-owner.mm');
 assert.equal(row.bytes,raw.length);assert.equal(row.sha256,digest(raw));assert.equal(row.sha256,'de91b9b18cfab291c7bca0a3bdb88e16f911505be356ce3afc1da5a1d8d34ae5');
});
test('R241 successor preserves every byte outside the mismatched original current selector',()=>{
 const old=read('../../../scripts/ci/fixtures/auth-r241-namespace/original-auth-identity-joint-owner.mm'),actual=read('../native/original-auth-identity-joint-owner.mm');
 assert.equal(digest(old),'ec6aafa361e2b79e9f3c06071a1a890390e3ac19af795631b2b442f9aefbc082');
 const before='NSURL *expectedRegistry=YNXOriginalIDERegistryResources();',after='NSURL *expectedRegistry=_walletPQCatalog?YNXOriginalWalletPQRegistryResources():YNXOriginalIDERegistryResources();';
 assert.equal(old.toString().split(before).length,2);assert.equal(old.toString().replace(before,after),actual.toString());
});
