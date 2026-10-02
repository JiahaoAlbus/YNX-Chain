import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryEntry} from './discovery-entry.mjs';
const person='sp_'+'A'.repeat(32),token='B'.repeat(32);
test('original personal code retains exact stable identifier',()=>{
 const value=`https://social.ynxweb4.com/people/${person}`;
 assert.deepEqual(discoveryEntry(value),{source:'qr',value,personId:person});
 assert.equal(Object.isFrozen(discoveryEntry(value)),true);
});
test('invitation is a distinct unredeemed capability, not a person identity',()=>{
 const value=`https://social.ynxweb4.com/invite/${token}`;
 assert.deepEqual(discoveryEntry(value),{source:'invite',value,personId:null});
});
test('rejects normalization, callback authority and unrelated schemes',()=>{
 const original=`https://social.ynxweb4.com/people/${person}`;
 for(const value of [original+'?',original+'#',original+'?approved=true',original+'/',original.replace('/people/','/%70eople/'),original.replace('https:','http:'),original.replace('social.','evil.'),original.replace('.com/','.com:443/'),original.replace('//','//user@'),`ynxsocial://invite/${token}`,`wc:${token}`,`ethereum:${token}`,person,' '+original,null,{},original.replace(person,'ynx1'+'a'.repeat(38))]) assert.throws(()=>discoveryEntry(value));
});
