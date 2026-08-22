import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const s=readFileSync(new URL('./finance-production-rollback-first.sh',import.meta.url),'utf8');
for(const x of ['lease.signed','absent "$stage"','absent "$backup"','absent "$release"','assert_fresh','ELF 64-bit','restore(){','trap \'restore\' EXIT','systemctl restart','current.next'])assert.ok(s.includes(x),x);
for(const x of ['ssh ','scp ','eth_requestAccounts','personal_sign'])assert.equal(s.includes(x),false,x);
console.log('finance production command object: pass');
