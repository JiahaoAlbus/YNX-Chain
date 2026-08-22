import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const s=readFileSync(new URL('./finance-production-rollback-first.sh',import.meta.url),'utf8');
for(const x of ['lease.signed','LEASE_ID','http_check','path.url','%{http_code}','verify_old_live','verify_candidate_live','verify_local_assets "$candidate"','relativePath','paths.$name.basename','fresh.state.tuple','fresh.state.restoredTuple','candidate-state-sha256','newpid','MainPID','NRestarts','absent "$stage"','absent "$backup"','absent "$release"','realpath -e','ELF 64-bit.*x86-64','$(bytes "$candidate/ynx-finance")','restore(){','trap \'restore\' EXIT','systemctl restart','current.next'])assert.ok(s.includes(x),x);
for(const x of ['ssh ','scp ','eth_requestAccounts','personal_sign','eval '])assert.equal(s.includes(x),false,x);
console.log('finance production command object: pass');
