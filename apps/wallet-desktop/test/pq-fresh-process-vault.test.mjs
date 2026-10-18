import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createVerifier,decodeMember} from '../../../packages/wallet-auth/node_modules/@ynx/batch-v01-candidate/src/index.mjs';
import {pqPublicBindingToRegistrationKeys,encodePQNativeTransfer} from '../../../packages/wallet-auth/src/pq-wallet-authorization.js';
const worker=fileURLToPath(new URL('./pq-fresh-process-vault-worker.mjs',import.meta.url));
function run(input){const result=spawnSync(process.execPath,['--max-old-space-size=192',worker],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},input:JSON.stringify(input),encoding:'utf8',timeout:45000,maxBuffer:1048576});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
test('actual Wallet creates encrypted dual keys and a completely new process restores both full public keys and signs',async t=>{
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-pq-cold-qa-'));await fs.chmod(directory,0o700);t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const password=randomBytes(32).toString('base64url'),chainId='71'.repeat(32),created=run({operation:'create',directory,password,chainId});
 // Trusted parent freezes BOTH full public keys and original typed message
 // before entering the new restore/signing process. Go State []byte JSON uses
 // base64; its small fixture revision/heights are safe exact integer literals.
 const originalTransfer=Object.freeze({chainId,nativeChainId:'6423',from:created.binding.owner,to:'0x'+'22'.repeat(20),amount:'3',fee:'1',nonce:'9007199254740994'});
 const originalMessage=Buffer.from(encodePQNativeTransfer(originalTransfer));
 const originalState=Buffer.from(JSON.stringify({version:'YNX-ACCOUNT-POLICY/v1',networkId:Buffer.from(chainId,'hex').toString('base64'),enableAt:10,records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:created.binding.owner,pkA:Buffer.from(created.binding.pkA,'base64url').toString('base64'),pkB:Buffer.from(created.binding.pkB,'base64url').toString('base64'),revision:1,registeredAt:10,activeFrom:20,ledgerNonce:1}]}));
 const restored=run({operation:'restore',directory,password,chainId,binding:created.binding});assert.notEqual(created.pid,restored.pid);assert.deepEqual(restored.binding,created.binding);
 assert.deepEqual(restored.transfer,originalTransfer);
 assert.equal(Buffer.from(restored.binding.pkA,'base64url').length,2592);assert.equal(Buffer.from(restored.binding.pkB,'base64url').length,64);assert.equal(restored.broadcast,false);assert.equal(restored.vaultUnchanged,true);assert.equal(restored.keyRetired,true);
 const wire=await fs.readFile(path.join(directory,'restored-qa-transfer.wire'));assert.equal(createHash('sha256').update(wire).digest('hex'),restored.wireHash);
 assert.deepEqual(Buffer.from(decodeMember(wire).message),originalMessage);
 const pk=pqPublicBindingToRegistrationKeys(created.binding),verifier=createVerifier({provider:'portable',chainId:Buffer.from(chainId,'hex'),purpose:'TX-BATCH',resolveTrustedOwner:()=>({algorithmVersion:'YNX-BATCH/v0.1',enabled:true,owner:created.binding.owner,chainId:Buffer.from(chainId,'hex'),pkA:Buffer.from(pk.pkA,'hex'),pkB:Buffer.from(pk.pkB,'hex'),purpose:'TX-BATCH',policyRevision:'QA-synthetic-not-chain',activeFrom:0,revokedAt:null})});assert.equal(verifier.verifyOne(wire,{height:0}),true);
 // This is actual fresh-process Wallet/SDK crypto, not GUI or Go acceptance.
 assert.equal((await fs.readFile(path.join(directory,'wallet-vault-v3.json'))).includes(password),false);
 const publicOutput=process.env.YNX_PQ_QA_PUBLIC_OUTPUT_DIR;
 if(publicOutput){
  assert(path.isAbsolute(publicOutput));assert(path.basename(publicOutput).startsWith('wallet-pq-fresh-process-proof-'));const stat=await fs.lstat(publicOutput);assert(stat.isDirectory()&&!stat.isSymbolicLink());
  const publicFiles=[];for(const [name,bytes] of [['state.json',originalState],['message.bin',originalMessage],['member.bin',wire]]){const target=path.join(publicOutput,name);await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});publicFiles.push({path:target,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  await fs.writeFile(path.join(publicOutput,'PUBLIC_EVIDENCE.json'),JSON.stringify({state:'FRESH_PROCESS_WALLET_ENCRYPTED_RECOVERY_PUBLIC_GO_INPUTS_NOT_GO_ACCEPTANCE',createPID:created.pid,restorePID:restored.pid,fullPublicKeyBytes:[2592,64],height:'30',owner:created.binding.owner,purpose:'TX-BATCH',files:publicFiles,originalMessageFrozenBeforeRestore:true,privateVaultAndPasswordNotCopied:true,JSVerified:true,GoVerified:false,GUIApproval:false,broadcast:false},null,2)+'\n',{flag:'wx',mode:0o600});
 }
});
