import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyJournalInputs,assertStrongJournalExport,root} from '../../../scripts/ci/android-pending-journal-inputs.mjs';
test('six exact supplier CAS preserve all other role inputs and Git before bytes',()=>{
 const x=verifyJournalInputs();assert.equal(x.retained,31);assert.equal(x.production.length,37);assert.equal(x.controls.length,3);
});
test('changed retained input is refused before compiler or runtime work',()=>{
 const t=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-journal-pins-'));
 try{const x=verifyJournalInputs();for(const row of [...x.production,...x.controls]){const p=path.join(t,row.path);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(root,row.path),p);}fs.appendFileSync(path.join(t,x.production[0].path),'\n');assert.throws(()=>verifyJournalInputs(t),/JOURNAL_INPUT_BYTES/);}finally{fs.rmSync(t,{recursive:true,force:true});}
});
test('new journal methods must be strong definitions, not weak or duplicate',()=>{
 const name='ynx_auth_android_pending_source_copy_journal_constraints_v1';assertStrongJournalExport('0000 T '+name,name);assert.throws(()=>assertStrongJournalExport('0000 W '+name,name),/JOURNAL_STRONG/);assert.throws(()=>assertStrongJournalExport('0000 T '+name+'\n0001 T '+name,name),/JOURNAL_STRONG/);
});

test('explicit F24 successor preserves original six-CAS lineage',()=>{const p=path.join(root,'packages/wallet-auth/native/android-pending-producer-role/F24_SUCCESSOR.json');if(fs.existsSync(p)){const f=JSON.parse(fs.readFileSync(p,'utf8'));assert.equal(f.productionMOD,1);assert.equal(f.after.sha256,'536c6a21d4450ac0c654a128a9f27693ea67d05ddf708d6f5f9bce60012052a6');verifyJournalInputs();}});
