import test from 'node:test';import assert from 'node:assert/strict';
import {checkedPrivacySettings} from './privacySettings';
const account='ynx1'+'a'.repeat(38);
const record={account,discoverableByHandle:true,contactsMatching:false,allowRecommendations:false,allowRequestsFrom:'contacts',avatarUrl:'https://example.test/original-avatar.png'};
test('verified privacy remains bound to the original account without contact upload consent',()=>{const result=checkedPrivacySettings(record,account);assert.equal(result.contactsMatching,false);assert.equal(result.avatarUrl,record.avatarUrl);assert.equal(Object.isFrozen(result),true)});
for(const value of [{...record,account:'ynx1'+'b'.repeat(38)},{...record,contactsMatching:'false'},{...record,allowRequestsFrom:'all'},{...record,profileQrPayload:42},null])test('privacy read rejects wrong identity or ambiguous server fields '+JSON.stringify(value),()=>{assert.throws(()=>checkedPrivacySettings(value,account))});
