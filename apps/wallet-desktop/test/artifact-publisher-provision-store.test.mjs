import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {encodePublisherCustodyRecordData} from '../src/artifact-publication/publisher-custody-record.mjs';
const supplier=process.env.WALLET_PUBLISHER_PROVISION_SDK42_PACKAGE;
test('Native publisher provisioning checkpoints retain the same generated record across unknown storage and cold owners',{
 skip:process.platform!=='darwin'?'macOS Foundation/Keychain boundary':!supplier?'requires original SDK42 Native supplier package':false,
},t=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-publisher-provision-public-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const inventory=JSON.parse(fs.readFileSync(new URL('./fixtures/auth42-native-inventory.json',import.meta.url)));
 const leaves=['original-auth-identity-source-authority.h','original-ide-publication-artifact.h','original-ide-publication-artifact.mm','original-ide-wallet-identity-source.h','original-ide-wallet-peer-launch.h','original-ide-identity-peer-endpoint.h','original-ide-identity-peer-wire.h','original-ide-project-authority-data.h','original-ide-auth-proof-data.h'];
 for(const leaf of leaves){const relative='packages/wallet-auth/native/'+leaf,pin=inventory.NativeInputs.find(p=>p.path===relative);assert(pin);const bytes=fs.readFileSync(path.join(supplier,'native',leaf));assert.equal(bytes.length,pin.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);const output=path.join(temp,relative);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}
 for(const relative of ['native/original-artifact-publisher-store.h','native/original-artifact-publisher-store.mm','test/native/artifact-publisher-store-public.mm']){const output=path.join(temp,'apps/wallet-desktop',relative);fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(path.join(root,relative),output);}
 const binary=path.join(temp,'PUBLIC-provision-store'),build=spawnSync('/usr/bin/xcrun',['clang++','-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-Wall','-Wextra','-Werror','-DYNX_PUBLISHER_STORE_PUBLIC_TEST=1','-DYNX_PUBLISHER_PROVISION_PUBLIC_TEST=1',path.join(temp,'apps/wallet-desktop/native/original-artifact-publisher-store.mm'),path.join(temp,'packages/wallet-auth/native/original-ide-publication-artifact.mm'),path.join(temp,'apps/wallet-desktop/test/native/artifact-publisher-store-public.mm'),'-framework','Foundation','-framework','Security','-framework','LocalAuthentication','-framework','AppKit','-o',binary],{encoding:'utf8',timeout:30000});
 assert.equal(build.status,0,build.stderr);
 const run=spawnSync(binary,[],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.match(/^PASS_PROVISION /gm)?.length,9,run.stdout);assert.match(run.stdout,/generation=0 signature=0 Source=0 registered=0 systemKeychainOperations=0/);
 // Same newly compiled Native store also retains the existing43 behavior.
 // This file contains only deliberately fake PUBLIC structural material.
 const publicRecord=path.join(temp,'PUBLIC-fake-record.bin');fs.writeFileSync(publicRecord,encodePublisherCustodyRecordData(Buffer.from('PUBLIC-JS-to-Native'),{format:'YNX-BATCH/KEY-MATERIAL/v1',algorithmVersion:'YNX-BATCH/v0.1',suite:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',pkcs8A:Buffer.alloc(54),pkcs8B:Buffer.alloc(150),pkA:Buffer.alloc(2592),pkB:Buffer.alloc(64)}),{mode:0o600});
 const prior=spawnSync(binary,[publicRecord],{encoding:'utf8',timeout:10000});assert.equal(prior.status,0,prior.stderr);assert.equal(prior.stdout.match(/^PASS /gm)?.length,43,prior.stdout);assert.match(prior.stdout,/systemKeychainOperations=0 sourceGrant=0 approval=0 signature=0/);
});
