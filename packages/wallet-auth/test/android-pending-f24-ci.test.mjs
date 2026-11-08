import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyF24Inputs,root} from '../../../scripts/ci/android-pending-f24-inputs.mjs';
test('single F24 MOD matches exact frozen journal before and all other inputs',()=>{const x=verifyF24Inputs();assert.equal(x.successor.productionMOD,1);assert.equal(x.intake.production.length,37);});
test('any changed retained input refuses before new F24 compilation',()=>{
 const t=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-f24-inputs-'));
 try{const x=verifyF24Inputs();for(const row of [...x.intake.production,...x.intake.controls,x.successor.controls]){const p=path.join(t,row.path);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(root,row.path),p);}const retained=x.intake.production.find(x=>!x.path.endsWith('/PendingProducer.cpp'));fs.appendFileSync(path.join(t,retained.path),'\n');assert.throws(()=>verifyF24Inputs(t),/F24_INPUT_BYTES/);}finally{fs.rmSync(t,{recursive:true,force:true});}
});
