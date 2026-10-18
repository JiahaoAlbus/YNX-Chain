import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {createPQKeyPreparationSource} from '../src/wallet-pq-key-source.mjs';
import {createDualPQKeyPreparation} from '../src/wallet-pq-key-preparation.mjs';
import * as keys from '../../../packages/wallet-auth/src/pq-wallet-key-backup.js';
import * as backup from '../../../packages/wallet-auth/src/pq-wallet-backup.js';
import * as contract from '../../../packages/wallet-auth/src/pq-wallet-contract.js';
import {pqPublicBindingToRegistrationKeys} from '../../../packages/wallet-auth/src/pq-wallet-authorization.js';
import {parsePQAccountAuthorization} from '../../../packages/wallet-auth/src/pq-wallet-policy.js';
// QA-only entry: actual Wallet custody/storage and sole SDK crypto. Never opens
// a user profile, broadcasts, uses CLI/ENV passwords or logs private material.
let input='',size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>65536)throw Error('QA_INPUT_LIMIT');input+=chunk;}
const options=JSON.parse(input);input='';
assert(['create','restore'].includes(options.operation));assert(path.isAbsolute(options.directory));assert(path.basename(options.directory).startsWith('ynx-pq-cold-qa-'));
const directory=await fs.lstat(options.directory);assert(directory.isDirectory()&&!directory.isSymbolicLink());assert.equal(directory.mode&0o777,0o700);
const sdk=Object.freeze({...keys,...backup,...contract}),filePath=path.join(options.directory,'wallet-vault-v3.json'),lifecycle=new DesktopKeyLifecycle();lifecycle.setFocused(true);
const vault=new PasswordWalletVault({filePath,authorization:lifecycle,pqSDK:sdk});lifecycle.authorizer=vault.authorizer();let controller;
try{
 if(options.operation==='create'){
  await assert.rejects(fs.stat(filePath),{code:'ENOENT'});
  await lifecycle.custody(guard=>vault.setup({password:options.password,confirmation:options.password},guard));await lifecycle.unlock({password:options.password});
  const account=await lifecycle.run(()=>vault.createAccount());lifecycle.setAccount(account.account);await lifecycle.unlock({password:options.password});
  const source=createPQKeyPreparationSource({sdk,repository:{assertCanPrepare:()=>vault.assertPQPreparationAvailable(),saveKeys:value=>vault.savePQKeys(value),readKeys:value=>vault.readPQKeys(value),verifySavedKeys:value=>vault.verifySavedPQKeys(value)},getOriginalNetwork:async()=>({chainId:options.chainId,owner:account.account}),getRegisteredBinding:async()=>{throw Error('QA_NO_CHAIN_REGISTRATION');},readRestoreInput:async()=>{throw Error('QA_NO_EXTERNAL_RECOVERY_INPUT');}});
  controller=createDualPQKeyPreparation({lifecycle,source,getBinding:()=>({account:account.account,network:options.chainId}),id:()=> 'QA-fresh-process-original'});
  assert.equal((await controller.generate()).persisted,true);
  const material=controller.selectRetainedOutcome(value=>value.record.material),binding=source.selectOriginal(material,value=>value.binding);
  const encrypted=await fs.readFile(filePath);assert.equal(encrypted.includes(options.password),false);assert.equal(encrypted.includes('pkcs8'),false);
  lifecycle.lock();assert.equal(source.selectOriginal(material,value=>sdk.readPQWalletKeyCleanupOutcome(value.handle).cleanupComplete),true);
  process.stdout.write(JSON.stringify({pid:process.pid,binding,vaultDigest:createHash('sha256').update(encrypted).digest('hex'),persisted:true,keyRetired:true}));
 }else{
  const before=await fs.readFile(filePath),record=JSON.parse(before);assert.equal(record.activeAccount,options.binding.owner);
  lifecycle.setAccount(record.activeAccount);await lifecycle.unlock({password:options.password});
  const registration=pqPublicBindingToRegistrationKeys(options.binding);
  // Explicit synthetic policy, not chain registration or human GUI approval.
  const snapshot=parsePQAccountAuthorization({owner:record.activeAccount,executionHeight:'30',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:options.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:registration.algorithmVersion,owner:record.activeAccount,pkA:registration.pkA,pkB:registration.pkB,revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}]}, {chainId:options.chainId,owner:record.activeAccount,nativeChainId:'6423'});
  const transfer={chainId:options.chainId,nativeChainId:'6423',from:record.activeAccount,to:'0x'+'22'.repeat(20),amount:'3',fee:'1',nonce:'9007199254740994'};
  let restoredPublic,retiredHandle;
  const signed=await lifecycle.run(()=>vault.withPQKeys(options.binding,handle=>{retiredHandle=handle;restoredPublic=sdk.readPQWalletKeyPublic(handle);sdk.assertPQPublicBindingMatches(restoredPublic,options.binding);return sdk.signPQWalletNativeTransfer(handle,transfer,snapshot);}));
  assert.equal(sdk.readPQWalletKeyCleanupOutcome(retiredHandle).cleanupComplete,true);assert.equal(vault.pqCleanupUnresolved(),false);
  const wire=Buffer.from(signed.body);await fs.writeFile(path.join(options.directory,'restored-qa-transfer.wire'),wire,{flag:'wx',mode:0o600});
  assert.deepEqual(await fs.readFile(filePath),before);
  process.stdout.write(JSON.stringify({pid:process.pid,binding:restoredPublic,wireHash:createHash('sha256').update(wire).digest('hex'),wireBytes:wire.length,transfer,provider:'portable',keyRetired:true,vaultUnchanged:true,broadcast:false}));
 }
}finally{controller?.dispose();lifecycle.lock();options.password=null;}
