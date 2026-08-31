#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo=process.cwd(), commandSource=join(repo,'apps/finance/scripts/finance-phase3-openssh-serialized-command.sh');
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const n=p=>readFileSync(p).length;
const id='finance-combined-4f7fba323a89-20260831t041500z';
function make({silent=false, malformed=false}={}){
  const root=mkdtempSync('/tmp/ynx-phase3-openssh-');
  const stdin=join(root,'lease.json'),stdout=join(root,'stdout'),stderr=join(root,'stderr'),receipt=join(root,'receipt'),bootstrap=join(root,'bootstrap.sh');writeFileSync(stdin,'{"lease":{"signed":true}}\n');
  const lines=['phase=3','deployParent=/fixture/deploy','deployParentTuple=1:2:0:0:750:2:4096:directory','executor=/fixture/executor','executorTuple=1:3:0:0:700:1:10:regular file','executorBytes=10','executorSha256=abc','lease=/fixture/lease','leaseTuple=1:4:0:0:600:1:10:regular file','leaseBytes=10','leaseSha256=def','rollbackArgv0=/fixture/executor','rollbackArgv1=rollback','rollbackArgv2=/fixture/lease'];if(malformed)lines.pop();
  writeFileSync(bootstrap,`#!/bin/bash\nset -eu\ntest "$#" = 16\ncat >/dev/null\nprintf '%s\\n' ${lines.map(x=>JSON.stringify(x)).join(' ')}\n`);chmodSync(bootstrap,0o700);
  const sudo=join(root,'sudo'),ssh=join(root,'ssh'),counter=join(root,'ssh-count'),runner=join(root,'command.sh');writeFileSync(sudo,'#!/bin/bash\nset -eu\ntest "$1" = -n; shift\nexec "$@"\n');chmodSync(sudo,0o700);writeFileSync(ssh,silent?`#!/bin/bash\nprintf 1 >> ${JSON.stringify(counter)}\nexit 0\n`:`#!/bin/bash\nset -eu\nprintf 1 >> ${JSON.stringify(counter)}\nwhile [[ "$1" != ubuntu@43.153.202.237 ]]; do shift; done\nshift\ntest "$#" = 1\nexec /bin/bash -c "$1"\n`);chmodSync(ssh,0o700);
  writeFileSync(runner,readFileSync(commandSource,'utf8').replaceAll('/usr/bin/ssh',ssh).replaceAll('/usr/bin/sudo',sudo).replaceAll('/usr/bin/base64 -d','/opt/homebrew/bin/gbase64 -d'));chmodSync(runner,0o700);
  const args=[stdin,stdout,stderr,receipt,bootstrap,String(n(bootstrap)),sha(bootstrap),id,'/carrier','root','leases','carrier','archiveTuple','archiveSha','archiveBytes','envTuple','envSha','envBytes','executorB64','executorBytes','executorSha','leaseBytes','leaseSha'];
  return {root,stdin,stdout,stderr,receipt,args,counter,runner,env:{}};
}
function run(x){return spawnSync('/bin/bash',[x.runner,...x.args],{encoding:'utf8',env:x.env});}
for(const options of [{},{silent:true},{malformed:true}]){const x=make(options),r=run(x);if(!options.silent&&!options.malformed){assert.equal(r.status,0,`${r.stdout}${r.stderr}\nremote=${existsSync(x.stderr)?readFileSync(x.stderr,'utf8'):''}\nstdout=${existsSync(x.stdout)?readFileSync(x.stdout,'utf8'):''}\nreceipt=${existsSync(x.receipt)?readFileSync(x.receipt,'utf8'):''}`);assert.equal(readFileSync(x.counter,'utf8'),'1');assert.match(readFileSync(x.stdout,'utf8'),/^phase=3$/m);assert.match(readFileSync(x.receipt,'utf8'),/remoteExitStatus=0/);assert.match(readFileSync(x.receipt,'utf8'),/terminalReceiptValidated=true/);}else{assert.equal(r.status,65);assert.equal(readFileSync(x.counter,'utf8'),'1');assert.match(readFileSync(x.receipt,'utf8'),/remoteExitStatus=65/);assert.match(readFileSync(x.receipt,'utf8'),/terminalReceiptValidated=false/);}assert.equal(existsSync(x.stderr),true);rmSync(x.root,{recursive:true,force:true});}
{const x=make();x.args[6]='0';const r=run(x);assert.equal(r.status,65);assert.equal(existsSync(x.counter),false,'local preflight mismatch must not reach SSH');rmSync(x.root,{recursive:true,force:true});}
{const x=make();writeFileSync(x.stdout,'');writeFileSync(x.stderr,'');const r=run(x);assert.equal(r.status,65,'pre-created lease-declared output paths fail closed');assert.equal(existsSync(x.counter),false,'pre-created output paths must block before SSH');assert.equal(readFileSync(x.stdout).length,0,'pre-existing stdout is not overwritten');assert.equal(readFileSync(x.stderr).length,0,'pre-existing stderr is not overwritten');assert.equal(existsSync(x.receipt),false,'receipt remains absent when the outer caller violated the declared-output contract');rmSync(x.root,{recursive:true,force:true});}
console.log('finance phase3 serialized OpenSSH transport fixture: pass');
