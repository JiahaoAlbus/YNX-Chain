import test from 'node:test';import assert from 'node:assert/strict';
import {profileLocator} from './profile-share.mjs';
const id='sp_'+'p'.repeat(32),link='https://social.ynxweb4.com/people/'+id;
test('personal code uses the existing stable Social identifier across handle changes',()=>{assert.equal(profileLocator({id,handle:'old'}),link);assert.equal(profileLocator({id,handle:'new',privacy:{profileQrPayload:link}}),link)});
for(const profile of [{id:'ynx1'+'a'.repeat(38)},{id:'sp_bad'},{id,privacy:{profileQrPayload:'https://social.ynxweb4.com/invite/old'}},{id,privacy:{profileQrPayload:link+'?wallet=secret'}}])test('personal code rejects wallet identity, wrong type or retargeted locator '+JSON.stringify(profile),()=>{assert.throws(()=>profileLocator(profile))});
