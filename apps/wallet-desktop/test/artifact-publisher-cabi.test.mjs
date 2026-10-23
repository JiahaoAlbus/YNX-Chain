import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const delivery=process.env.WALLET_ARTIFACT_CABI_DELIVERY;
const generator=process.env.WALLET_ARTIFACT_CABI_SYNTHETIC_GENERATOR;
const source=process.env.WALLET_ARTIFACT_CABI_SOURCE_ROOT;
const runtime=process.env.WALLET_ARTIFACT_CABI_SDK_RUNTIME;
test('actual Main fixed private CABI body + exact supplied archive + original synthetic generator and SDK20 dual-AND verifier',{skip:process.platform!=='darwin'||!delivery||!generator||!source||!runtime?'requires exact original qualified Native archive, synthetic test generator and matching original SDK20 source/runtime':false},async t=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-main-cabi-synthetic-'));
 // Only generated test-only private files are removed. No user key/data is
 // read. Filesystem removal is not a physical-erasure guarantee.
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 for(const [name,length,pin]of [['ynx_artifact_release.h',5089,'1da905e0b38581ad34a9cf995c36f8d368425df9242a35f4e49d7b41c8100616'],['libynx_artifact_release.a',6994968,'c11e9522e0cfaf585987796a03e08b2acff99b5282c1c3622a65ad3b6211c643']]){const b=fs.readFileSync(path.join(delivery,name));assert.equal(b.length,length);assert.equal(sha(b),pin);}
 for(const name of ['original-artifact-publisher-store.h','original-artifact-publisher-cabi.h']){const out=path.join(temp,'apps/wallet-desktop/native',name);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(root,'native',name),out);}
 const inventory=JSON.parse(fs.readFileSync(new URL('./fixtures/auth20-native-inventory.json',import.meta.url)));
 for(const name of ['original-ide-project-authority-data.h','original-ide-auth-proof-data.h']){const p=inventory.NativeInputs.find(p=>p.path==='packages/wallet-auth/native/'+name);assert(p);const b=fs.readFileSync(path.join(source,p.path));assert.equal(b.length,p.bytes);assert.equal(sha(b),p.sha256);const out=path.join(temp,p.path);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}
 const fixture=path.join(temp,'apps/wallet-desktop/test/native/artifact-publisher-cabi-public.mm');fs.mkdirSync(path.dirname(fixture),{recursive:true});fs.copyFileSync(path.join(root,'test/native/artifact-publisher-cabi-public.mm'),fixture);
 const fault=path.join(path.dirname(fixture),'artifact-publisher-cabi-fault-public.mm');fs.copyFileSync(path.join(root,'test/native/artifact-publisher-cabi-fault-public.mm'),fault);
 const faultBinary=path.join(temp,'PUBLIC-fault-boundary');
 const faultCompile=spawnSync('/usr/bin/xcrun',['clang++','-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-Wall','-Wextra','-Werror','-I'+delivery,fault,'-framework','Foundation','-o',faultBinary],{encoding:'utf8',timeout:30000});assert.equal(faultCompile.status,0,faultCompile.stderr);
 const faultRun=spawnSync(faultBinary,[],{encoding:'utf8',timeout:10000});assert.equal(faultRun.status,0,faultRun.stderr);assert.equal(faultRun.stdout.match(/^PASS /gm)?.length,6);assert.match(faultRun.stdout,/DOUBLES_ONLY actualCrypto=0/);
 const binary=path.join(temp,'synthetic-cabi');
 const compile=spawnSync('/usr/bin/xcrun',['clang++','-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-Wall','-Wextra','-Werror','-I'+delivery,fixture,path.join(delivery,'libynx_artifact_release.a'),'-framework','Foundation','-framework','CoreFoundation','-framework','Security','-pthread','-lm','-o',binary],{encoding:'utf8',timeout:30000});assert.equal(compile.status,0,compile.stderr);
 const input=path.join(temp,'input'),output=path.join(temp,'public-output');fs.mkdirSync(output,{mode:0o700});
 const generate=spawnSync(generator,['generate',input],{encoding:'utf8',timeout:30000});assert.equal(generate.status,0,generate.stderr);assert.match(generate.stdout,/SYNTHETIC_INPUT_READY/);
 const run=spawnSync(binary,[input,output],{encoding:'utf8',timeout:30000});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.match(/^PASS /gm)?.length,7);assert.match(run.stdout,/actualCABI=1 userKeys=0 Source=0 approval=0/);
 // Only public R/manifest/member enter JS. Private DER/custody never does.
 const req=createRequire(path.join(runtime,'package.json'));assert.equal(req('./package.json').version,'1.3.0-pq.3.32-auth.20');
 const module=req.resolve('@ynx-chain/wallet-auth/ide-artifact-signature');assert(fs.realpathSync(module).startsWith(fs.realpathSync(runtime)+path.sep));
 const moduleBytes=fs.readFileSync(module);assert.equal(moduleBytes.length,11352);assert.equal(sha(moduleBytes),'cb4c2e730c207c1c4aeb96fef3ce73f1776915cc1abeb977c5b32d0d3f8ca01a');
 const {inspectIDEArtifactSignatureData,inspectIDEArtifactPublisherPublicOriginalData}=await import(pathToFileURL(module));
 const r=fs.readFileSync(path.join(input,'registration.bin')),m=fs.readFileSync(path.join(input,'manifest.json'));
 const one=fs.readFileSync(path.join(output,'memberOriginal.bin')),two=fs.readFileSync(path.join(output,'memberOriginal-second.bin'));assert(!one.equals(two),'standalone synthetic math calls must not reuse a randomized batch');
 for(const member of [one,two]){const view=inspectIDEArtifactSignatureData(new Uint8Array(member),new Uint8Array(m),new Uint8Array(r));assert.equal(view.signatureVerified,true);assert.equal(view.dataOnly,true);assert.equal(view.publicationAuthorized,false);}
 const batch=await import(pathToFileURL(req.resolve('@ynx/batch-v01-candidate')));
 for(const branch of ['sigmaA','sigmaB']){const member=batch.decodeMember(one);member.certificate[branch][0]^=1;assert.throws(()=>inspectIDEArtifactSignatureData(batch.encodeMember(member),m,r),{code:'IDE_ARTIFACT_SIGNATURE_DATA_INVALID'});}
 // Public-only reproducible evidence. Remove precisely the generated synthetic
 // private fixture files FIRST; never publish their bytes or even their hashes.
 for(const name of ['SYNTHETIC-ONLY-a.der','SYNTHETIC-ONLY-b.der']){fs.unlinkSync(path.join(input,name));assert(!fs.existsSync(path.join(input,name)));}
 const evidence=process.env.WALLET_ARTIFACT_CABI_PUBLIC_EVIDENCE;
 if(evidence){
  assert(path.isAbsolute(evidence)&&fs.realpathSync(evidence)===evidence);const stat=fs.lstatSync(evidence);assert(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0);
  const publisher=inspectIDEArtifactPublisherPublicOriginalData(r),pin=b=>({bytes:b.length,sha256:sha(b)});
  const publicResult={version:'YNX-MAIN-ARTIFACT-CABI-PUBLIC-INTEROP/v1',syntheticOnly:true,actualCABI:true,protocolCommit:'395bb8d991bc0659b922baa09bb7b13b3c2baa5e',sdkVersion:'1.3.0-pq.3.32-auth.20',purpose:'ARTIFACT-RELEASE',n:1,index:0,registrationOriginalBase64:r.toString('base64'),manifestOriginalBase64:m.toString('base64'),memberOriginalBase64:one.toString('base64'),secondMemberOriginalBase64:two.toString('base64'),publicPins:{registration:pin(r),manifest:pin(m),member:pin(one),secondMember:pin(two)},dualANDVerified:true,typedN1Inspected:true,subjectOwner:publisher.subjectOwner,projectId:publisher.projectId,publisherId:publisher.publisherId,MainPrivateCopyWipeAssertions:true,actualArchiveNativeCases:7,controlledBoundaryCases:6,controlledBoundaryCrypto:false,bothBranchTamperRejected:true,syntheticPrivateFilesRemoved:true,physicalEraseClaimed:false,Source:false,actualUserApproval:false,installedApp:false,broadcast:false,publisherAuthorized:false};
  fs.writeFileSync(path.join(evidence,'PUBLIC-INTEROP.json'),JSON.stringify(publicResult,null,2)+'\n',{flag:'wx',mode:0o600});
 }
});
