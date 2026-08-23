import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root=mkdtempSync(join(tmpdir(),'ynx-finance-p3-'));
const id='p0237-finance-phase3-20260823T040000Z';
const shaBuffer=b=>createHash('sha256').update(b).digest('hex');
const sha=p=>shaBuffer(readFileSync(p)); const bytes=p=>readFileSync(p).length;
const stat=p=>spawnSync('/opt/homebrew/bin/gstat',['-Lc','%d:%i:%u:%g:%a:%h:%s:%F',p],{encoding:'utf8'}).stdout.trim();

function make({deployFails=false}={}){
  const d=mkdtempSync(join(root,'r-')),ynx=join(d,'opt','ynx'),carrier=join(ynx,'stage','finance','p0228-finance-phase1-20260822T234100Z');
  mkdirSync(carrier,{recursive:true}); mkdirSync(join(ynx,'leases'),{recursive:true});
  const archive=join(carrier,'candidate.tgz'),env=join(carrier,'finance.env'); writeFileSync(archive,'archive');chmodSync(archive,0o600);writeFileSync(env,'KEY=redacted\n');chmodSync(env,0o640);
  const executor=Buffer.from(`#!/bin/bash\nset -euo pipefail\ntest -f "$2"\nif [[ "$1" == rollback ]]; then echo rollback-ok; exit 0; fi\n${deployFails?'exit 71':'echo deploy-ok'}\n`);
  const lease=Buffer.from(`${JSON.stringify({lease:{signed:true,kind:'FINANCE_ROLLBACK_FIRST_PRODUCTION_DEPLOYMENT',id}})}\n`);
  const boot=readFileSync(new URL('./finance-phase3-stdin-deployment-bootstrap.sh',import.meta.url),'utf8').replaceAll('/opt/ynx',ynx).replaceAll('stat -Lc','/opt/homebrew/bin/gstat -Lc').replaceAll('base64 -d','base64 -D').replaceAll('mv -T --','/bin/mv --');
  return {d,ynx,carrier,archive,env,executor,lease,boot,args:[id,carrier,stat(ynx),stat(join(ynx,'leases')),stat(carrier),stat(archive),sha(archive),String(bytes(archive)),stat(env),sha(env),String(bytes(env)),executor.toString('base64'),String(executor.length),shaBuffer(executor),String(lease.length),shaBuffer(lease)]};
}
const run=(x,input=x.lease)=>spawnSync('/bin/bash',['-c',x.boot,'phase3',...x.args],{input,encoding:null});

let x=make(),r=run(x);assert.equal(r.status,0,String(r.stderr));assert.match(String(r.stdout),/deploy-ok/);const parent=join(x.ynx,'leases','finance'),exec=join(parent,`${id}.executor.sh`),lease=join(parent,`${id}.json`);assert.equal(sha(exec),shaBuffer(x.executor));assert.equal(sha(lease),shaBuffer(x.lease));assert.equal(lstatSync(exec).mode&0o777,0o700);assert.equal(lstatSync(lease).mode&0o777,0o600);
x=make();r=run(x,Buffer.concat([x.lease,Buffer.from('x')]));assert.notEqual(r.status,0);assert.equal(lstatSync(join(x.ynx,'leases','finance'),{throwIfNoEntry:false}),undefined);
x=make();writeFileSync(join(x.carrier,'foreign'),'keep');x.args[4]=stat(x.carrier);assert.notEqual(run(x).status,0);assert.equal(readFileSync(join(x.carrier,'foreign'),'utf8'),'keep');assert.equal(lstatSync(join(x.ynx,'leases','finance'),{throwIfNoEntry:false}),undefined);
x=make();const preserved=join(x.d,'preserved');mkdirSync(preserved);writeFileSync(join(preserved,'sentinel'),'keep');symlinkSync(preserved,join(x.ynx,'leases','finance'));assert.notEqual(run(x).status,0);assert.equal(readFileSync(join(preserved,'sentinel'),'utf8'),'keep');
x=make({deployFails:true});r=run(x);assert.notEqual(r.status,0);const failedParent=join(x.ynx,'leases','finance'),failedExec=join(failedParent,`${id}.executor.sh`),failedLease=join(failedParent,`${id}.json`);assert.equal(sha(failedExec),shaBuffer(x.executor));assert.equal(sha(failedLease),shaBuffer(x.lease));const rollback=spawnSync('/bin/bash',[failedExec,'rollback',failedLease],{encoding:'utf8'});assert.equal(rollback.status,0,rollback.stderr);assert.match(rollback.stdout,/rollback-ok/);

rmSync(root,{recursive:true,force:true});console.log('finance phase3 stdin deployment bootstrap fixture: pass');
