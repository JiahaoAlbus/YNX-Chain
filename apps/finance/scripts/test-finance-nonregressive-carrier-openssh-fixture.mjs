#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const source=readFileSync(new URL('./finance-nonregressive-carrier-openssh.sh',import.meta.url),'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
function make({silent=false}={}){
  const root=mkdtempSync('/tmp/finance-carrier-ssh-'),archive=join(root,'candidate.tgz'),lease=join(root,'lease.json'),stdout=join(root,'stdout'),stderr=join(root,'stderr'),receipt=join(root,'receipt'),bootstrap=join(root,'bootstrap.sh'),ssh=join(root,'ssh'),sudo=join(root,'sudo'),counter=join(root,'count'),runner=join(root,'runner.sh');
  writeFileSync(archive,'archive');writeFileSync(lease,'{"lease":{"signed":true,"kind":"FINANCE_NONREGRESSIVE_CARRIER_PREPARATION"}}\n');
  writeFileSync(bootstrap,'#!/bin/bash\nset -eu\ncat >/dev/null\nprintf "phase=carrier-preparation\\ncarrier=/fixture\\n"\n');
  writeFileSync(sudo,'#!/bin/bash\nset -eu\ntest "$1" = -n;shift;exec "$@"\n');chmodSync(sudo,0o700);
  writeFileSync(ssh,silent?`#!/bin/bash\nprintf 1 >> ${JSON.stringify(counter)}\nexit 0\n`:`#!/bin/bash\nset -eu\nprintf 1 >> ${JSON.stringify(counter)}\nwhile [[ "$1" != ubuntu@43.153.202.237 ]];do shift;done;shift;exec /bin/bash -c "$1"\n`);chmodSync(ssh,0o700);
  writeFileSync(runner,source.replaceAll('/usr/bin/ssh',ssh).replaceAll('/usr/bin/sudo',sudo).replaceAll('/Users/huangjiahao/Downloads/Huang.pem',join(root,'identity')).replaceAll('/Users/huangjiahao/.ssh/known_hosts',join(root,'known_hosts')).replaceAll('/usr/bin/base64 -d','/opt/homebrew/bin/gbase64 -d').replaceAll('/opt/homebrew/bin/gmv -T --','/bin/mv --'));chmodSync(runner,0o700);
  const ab=readFileSync(archive),lb=readFileSync(lease),bb=readFileSync(bootstrap);
  return{root,counter,stdout,stderr,receipt,runner,args:[archive,lease,stdout,stderr,receipt,bootstrap,String(bb.length),sha(bb),String(ab.length),sha(ab),String(lb.length),sha(lb)]};
}
for(const options of [{},{silent:true}]){const x=make(options),r=spawnSync('/bin/bash',[x.runner,...x.args],{encoding:'utf8'});if(!options.silent){assert.equal(r.status,0,`${r.stdout}${r.stderr}`);assert.equal(readFileSync(x.counter,'utf8'),'1');assert.match(readFileSync(x.receipt,'utf8'),/terminalReceiptValidated=true/);assert.match(readFileSync(x.receipt,'utf8'),/leaseSha256=/);}else{assert.equal(r.status,65);assert.match(readFileSync(x.receipt,'utf8'),/terminalReceiptValidated=false/);}rmSync(x.root,{recursive:true,force:true});}
{const x=make();x.args[11]='0'.repeat(64);const r=spawnSync('/bin/bash',[x.runner,...x.args]);assert.equal(r.status,1);assert.equal(existsSync(x.counter),false,'lease mismatch blocks before ssh');rmSync(x.root,{recursive:true,force:true});}
console.log('finance non-regressive carrier OpenSSH fixture: pass');
