import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {openSync,closeSync,readFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const module=new URL('./trusted-time.mjs',import.meta.url).href;
const code=`import{recordFinanceAuthorityPhase}from ${JSON.stringify(module)};recordFinanceAuthorityPhase('clock-fetch');recordFinanceAuthorityPhase('SECRET_ACCOUNT_PROOF_PATH');process.stdout.write('original-output');`;
test('optional reporter without FD preserves stdout and stderr',()=>{
 const out=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{},encoding:'utf8'});assert.equal(out.status,0);assert.equal(out.stdout,'original-output');assert.equal(out.stderr,'');
});
test('absent requested FD and a regular file are ignored, never written',()=>{
 const missing=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{YNX_FINANCE_AUTHORITY_PHASE_FD:'3'},encoding:'utf8'});assert.equal(missing.status,0);assert.equal(missing.stdout,'original-output');assert.equal(missing.stderr,'');
 const file=path.join(tmpdir(),`ynx-phase-regular-${process.pid}`),fd=openSync(file,'wx',0o600);
 try{const out=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{YNX_FINANCE_AUTHORITY_PHASE_FD:'3'},stdio:['ignore','pipe','pipe',fd],encoding:'utf8'});assert.equal(out.status,0);assert.equal(out.stdout,'original-output');assert.equal(out.stderr,'');assert.equal(readFileSync(file).length,0)}finally{closeSync(fd);unlinkSync(file)}
});
