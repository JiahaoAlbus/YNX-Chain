import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const s=readFileSync(new URL('./finance-production-rollback-first.sh',import.meta.url),'utf8');
for(const x of ['lease.signed','LEASE_ID','http_check','path.url','%{http_code}','verify_old_live','verify_candidate_live','verify_restored','verify_local_assets "$candidate"','relativePath','paths.basenames.$name','fresh.state.tuple','fresh.state.restoredTuple','candidate-state-stat','candidate-state-sha256','candidate_state_tuple','candidate_state_hash','newpid','MainPID','NRestarts','assert_exact_child archive','assert_exact_child newEnv','realpath -e','ELF 64-bit.*x86-64','$(bytes "$candidate/ynx-finance")','restore(){','trap \'restore\' EXIT','systemctl restart','current.next'])assert.ok(s.includes(x),x);
for(const x of ['ssh ','scp ','eth_requestAccounts','personal_sign','eval '])assert.equal(s.includes(x),false,x);
console.log('finance production command object: pass');
