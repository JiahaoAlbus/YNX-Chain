#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo=process.cwd(), command=join(repo,'apps/finance/scripts/finance-phase3-openssh-serialized-command.sh');
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const n=p=>readFileSync(p).length;
const id='p0999-finance-phase3-20260823T150000Z';
function make({silent=false, malformed=false}={}){
  const root=mkdtempSync('/tmp/ynx-phase3-openssh-'),bin=join(root,'bin');mkdirSync(bin);
  for(const [name,body] of [['base64','#!/bin/sh\nexec /opt/homebrew/bin/gbase64 "$@"\n'],['sha256sum','#!/bin/sh\nexec /opt/homebrew/bin/gsha256sum "$@"\n'],['mv','#!/bin/sh\nexec /opt/homebrew/bin/gmv "$@"\n']]){writeFileSync(join(bin,name),body);chmodSync(join(bin,name),0o755);}
  const stdin=join(root,'lease.json'),stdout=join(root,'stdout'),stderr=join(root,'stderr'),receipt=join(root,'receipt'),bootstrap=join(root,'bootstrap.sh');writeFileSync(stdin,'{"lease":{"signed":true}}\n');
  const lines=['phase=3','deployParent=/fixture/deploy','deployParentTuple=1:2:0:0:750:2:4096:directory','executor=/fixture/executor','executorTuple=1:3:0:0:700:1:10:regular file','executorBytes=10','executorSha256=abc','lease=/fixture/lease','leaseTuple=1:4:0:0:600:1:10:regular file','leaseBytes=10','leaseSha256=def','rollbackArgv0=/fixture/executor','rollbackArgv1=rollback','rollbackArgv2=/fixture/lease'];if(malformed)lines.pop();
  writeFileSync(bootstrap,`#!/bin/bash\nset -eu\ntest "$#" = 16\ncat >/dev/null\nprintf '%s\\n' ${lines.map(x=>JSON.stringify(x)).join(' ')}\n`);chmodSync(bootstrap,0o700);
  const sudo=join(root,'sudo'),ssh=join(root,'ssh');writeFileSync(sudo,'#!/bin/bash\nset -eu\ntest "$1" = -n; shift\nexec "$@"\n');chmodSync(sudo,0o700);writeFileSync(ssh,silent?'#!/bin/bash\nexit 0\n':'#!/bin/bash\nset -eu\nwhile [[ "$1" != ubuntu@43.153.202.237 ]]; do shift; done\nshift\ntest "$#" = 1\nexec /bin/bash -c "$1"\n');chmodSync(ssh,0o700);
  const args=[stdin,stdout,stderr,receipt,bootstrap,String(n(bootstrap)),sha(bootstrap),id,'/carrier','root','leases','carrier','archiveTuple','archiveSha','archiveBytes','envTuple','envSha','envBytes','executorB64','executorBytes','executorSha','leaseBytes','leaseSha'];
  return {root,stdin,stdout,stderr,receipt,args,env:{...process.env,PATH:`${bin}:${process.env.PATH}`,FINANCE_PHASE3_TRANSPORT_TEST_ROOT:'1',FINANCE_PHASE3_SSH_BIN:ssh,FINANCE_PHASE3_SUDO_BIN:sudo}};
}
function run(x){return spawnSync('/bin/bash',[command,...x.args],{encoding:'utf8',env:x.env});}
for(const options of [{},{silent:true},{malformed:true}]){const x=make(options),r=run(x);if(!options.silent&&!options.malformed){assert.equal(r.status,0,`${r.stdout}${r.stderr}\nremote=${existsSync(x.stderr)?readFileSync(x.stderr,'utf8'):''}\nstdout=${existsSync(x.stdout)?readFileSync(x.stdout,'utf8'):''}\nreceipt=${existsSync(x.receipt)?readFileSync(x.receipt,'utf8'):''}`);assert.match(readFileSync(x.stdout,'utf8'),/^phase=3$/m);assert.match(readFileSync(x.receipt,'utf8'),/terminalReceiptValidated=true/);}else{assert.equal(r.status,65);assert.match(readFileSync(x.receipt,'utf8'),/terminalReceiptValidated=false/);}assert.equal(existsSync(x.stderr),true);rmSync(x.root,{recursive:true,force:true});}
console.log('finance phase3 serialized OpenSSH transport fixture: pass');
