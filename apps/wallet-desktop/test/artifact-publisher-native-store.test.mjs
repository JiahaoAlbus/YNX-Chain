import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {encodePublisherCustodyRecordData} from '../src/artifact-publication/publisher-custody-record.mjs';
test('native purpose Keychain store compiles normally and passes explicit PUBLIC no-system-Keychain cases', {skip:process.platform!=='darwin'}, t=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-publisher-native-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const source=path.join(root,'native/original-artifact-publisher-store.mm'),fixture=path.join(root,'test/native/artifact-publisher-store-public.mm');
 const common=['clang++','-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-Wall','-Wextra','-Werror'];
 const syntax=spawnSync('/usr/bin/xcrun',[...common,'-fsyntax-only',source],{encoding:'utf8',timeout:30000});assert.equal(syntax.status,0,syntax.stderr);
 const binary=path.join(temp,'PUBLIC-store-test');
 const compile=spawnSync('/usr/bin/xcrun',[...common,'-DYNX_PUBLISHER_STORE_PUBLIC_TEST=1',source,fixture,'-framework','Foundation','-framework','Security','-framework','LocalAuthentication','-o',binary],{encoding:'utf8',timeout:30000});assert.equal(compile.status,0,compile.stderr);
 // Deliberately fake PUBLIC material, not actual generated private keys. Real
 // custody plaintext must never be passed through files or subprocess IPC.
 const publicRecord=path.join(temp,'PUBLIC-fake-record.bin');
 fs.writeFileSync(publicRecord,encodePublisherCustodyRecordData(Buffer.from('PUBLIC-JS-to-Native'),{format:'YNX-BATCH/KEY-MATERIAL/v1',algorithmVersion:'YNX-BATCH/v0.1',suite:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',pkcs8A:Buffer.alloc(54),pkcs8B:Buffer.alloc(150),pkA:Buffer.alloc(2592),pkB:Buffer.alloc(64)}),{mode:0o600});
 const run=spawnSync(binary,[publicRecord],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.match(/^PASS /gm)?.length,11);assert.match(run.stdout,/systemKeychainOperations=0 sourceGrant=0 approval=0 signature=0/);
});
