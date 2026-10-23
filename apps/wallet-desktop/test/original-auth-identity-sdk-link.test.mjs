import test from 'node:test';
import assert from 'node:assert/strict';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {originalAuthIdentityStartupStatus,originalAuthIdentityIDEStartupStatus,originalAuthIdentityStartupUnresolved,acquireOriginalAuthIdentityJointConfiguration} from '../../../packages/wallet-auth/src/original-auth-identity-private-joint-registration.js';

test('selected SDK private caller links actual Main Vault branding without reading secrets or selecting Native',async()=>{
 let guardCalls=0;
 const vault=new PasswordWalletVault({filePath:'/PUBLIC-NOT-OPENED/sdk-private-caller.json',authorization:{current(){assert.fail('No authorization or secret access in module-link test')}}});
 for(const status of [originalAuthIdentityStartupStatus(vault),originalAuthIdentityIDEStartupStatus(vault)]){
  assert.equal(status.initialized,false);assert.equal(status.implementingModuleAvailable,false);assert.equal(status.nativeQualified,false);assert.equal(status.resourceSupplied,false);
 }
 assert.equal(originalAuthIdentityStartupUnresolved(vault),false);
 assert.throws(()=>originalAuthIdentityStartupStatus({}),e=>e.data?.code==='ADMISSION_ORIGINAL_VAULT_REQUIRED');
 await assert.rejects(acquireOriginalAuthIdentityJointConfiguration(vault,{assert(){guardCalls++}}),{code:'AUTH_IDENTITY_NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED'});
 assert.equal(guardCalls,1);assert.equal(originalAuthIdentityStartupUnresolved(vault),false);
});
