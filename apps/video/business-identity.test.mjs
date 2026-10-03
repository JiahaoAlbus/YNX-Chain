import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoBusinessIdentity} from './business-identity.js';
import {videoScope} from './product-session.js';
const session=(account='ynx1a')=>({account,sessionBinding:'original_'+account,deviceId:'device',deviceKey:'original-key',expiresAt:'2026-10-04T00:00:00Z'});
const now=()=>Date.parse('2026-10-03T00:00:00Z');
test('Video private identity requires original account readback, not approved session alone',async()=>{
 let resolve;const calls=[];const identity=createVideoBusinessIdentity({now,read:(path,options)=>{calls.push({path,options});return new Promise(r=>resolve=r)}}),s=session();
 const options={signal:new AbortController().signal};const pending=identity.verify(s,options);assert.equal(identity.matches(s),false);resolve({schemaVersion:1,account:s.account});await pending;assert.equal(identity.matches(s),true);assert.deepEqual(calls,[{path:'/v1/account',options}]);assert.equal(videoScope('/v1/account'),'video:account');
});
test('mismatched business account and unsupported response cannot enable private identity',async()=>{
 for(const reply of [{schemaVersion:1,account:'ynx1b'},{account:'ynx1a'},null]){const identity=createVideoBusinessIdentity({now,read:async()=>reply}),s=session();await assert.rejects(identity.verify(s),/different account/);assert.equal(identity.matches(s),false);}
});
test('late A readback after B verification or disconnect cannot publish A identity',async()=>{
 let finishA;const identity=createVideoBusinessIdentity({now,read:()=>new Promise(r=>finishA=r)}),a=session(),b=session('ynx1b');const pending=identity.verify(a);identity.invalidate();finishA({schemaVersion:1,account:a.account});await assert.rejects(pending,{name:'AbortError'});assert.equal(identity.matches(a),false);assert.equal(identity.matches(b),false);
});
test('concurrent replacement retains B identity when A returns last',async()=>{
 const completions=[];const identity=createVideoBusinessIdentity({now,read:()=>new Promise(r=>completions.push(r))}),a=session(),b=session('ynx1b');const first=identity.verify(a),second=identity.verify(b);completions[1]({schemaVersion:1,account:b.account});await second;completions[0]({schemaVersion:1,account:a.account});await assert.rejects(first,{name:'AbortError'});assert.equal(identity.matches(b),true);assert.equal(identity.matches(a),false);
});
test('expiry during await or changed session binding invalidates business confirmation',async()=>{
 let time=now(),resolve;const identity=createVideoBusinessIdentity({now:()=>time,read:()=>new Promise(r=>resolve=r)}),s=session();const pending=identity.verify(s);time=Date.parse(s.expiresAt);resolve({schemaVersion:1,account:s.account});await assert.rejects(pending,{name:'AbortError'});assert.equal(identity.matches(s),false);
 time=now();const next=identity.verify(s);s.sessionBinding='replaced';resolve({schemaVersion:1,account:s.account});await assert.rejects(next,{name:'AbortError'});assert.equal(identity.matches(s),false);
});
