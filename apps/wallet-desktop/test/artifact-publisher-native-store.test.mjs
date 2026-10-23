import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {encodePublisherCustodyRecordData} from '../src/artifact-publication/publisher-custody-record.mjs';
test('native purpose Keychain store compiles normally and passes explicit PUBLIC no-system-Keychain cases', {skip:process.platform!=='darwin'}, t=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-publisher-native-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 // Compose ONLY the exact original SDK19 headers/typed manifest implementation
 // plus current Main-owned leaves. No provider injection into production.
 const supplier=process.env.WALLET_PUBLISHER_SDK19_SOURCE??path.resolve(root,'../..'),inventory=JSON.parse(fs.readFileSync(new URL('./fixtures/auth19-native-inventory.json',import.meta.url)));
 const supplierFiles=['original-auth-identity-source-authority.h','original-ide-publication-artifact.h','original-ide-publication-artifact.mm'].map(n=>'packages/wallet-auth/native/'+n);
 for(const relative of supplierFiles){const p=inventory.NativeInputs.find(p=>p.path===relative);assert(p);const bytes=fs.readFileSync(path.join(supplier,relative));assert.equal(bytes.length,p.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),p.sha256);const out=path.join(temp,relative);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}
 for(const relative of ['native/original-artifact-publisher-store.h','native/original-artifact-publisher-store.mm','test/native/artifact-publisher-store-public.mm']){const out=path.join(temp,'apps/wallet-desktop',relative);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(root,relative),out);}
 const source=path.join(temp,'apps/wallet-desktop/native/original-artifact-publisher-store.mm'),fixture=path.join(temp,'apps/wallet-desktop/test/native/artifact-publisher-store-public.mm');
 const common=['clang++','-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-Wall','-Wextra','-Werror'];
 const syntax=spawnSync('/usr/bin/xcrun',[...common,'-fsyntax-only',source],{encoding:'utf8',timeout:30000});assert.equal(syntax.status,0,syntax.stderr);
 const binary=path.join(temp,'PUBLIC-store-test');
 const compile=spawnSync('/usr/bin/xcrun',[...common,'-DYNX_PUBLISHER_STORE_PUBLIC_TEST=1',source,path.join(temp,'packages/wallet-auth/native/original-ide-publication-artifact.mm'),fixture,'-framework','Foundation','-framework','Security','-framework','LocalAuthentication','-o',binary],{encoding:'utf8',timeout:30000});assert.equal(compile.status,0,compile.stderr);
 // Deliberately fake PUBLIC material, not actual generated private keys. Real
 // custody plaintext must never be passed through files or subprocess IPC.
 const publicRecord=path.join(temp,'PUBLIC-fake-record.bin');
 fs.writeFileSync(publicRecord,encodePublisherCustodyRecordData(Buffer.from('PUBLIC-JS-to-Native'),{format:'YNX-BATCH/KEY-MATERIAL/v1',algorithmVersion:'YNX-BATCH/v0.1',suite:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',pkcs8A:Buffer.alloc(54),pkcs8B:Buffer.alloc(150),pkA:Buffer.alloc(2592),pkB:Buffer.alloc(64)}),{mode:0o600});
 const run=spawnSync(binary,[publicRecord],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.match(/^PASS /gm)?.length,20);assert.match(run.stdout,/systemKeychainOperations=0 sourceGrant=0 approval=0 signature=0/);
});
