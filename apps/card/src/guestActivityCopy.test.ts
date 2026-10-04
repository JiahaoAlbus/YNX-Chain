import test from 'node:test';
import assert from 'node:assert/strict';
import {locales} from './i18n';
import {guestActivityCount,guestActivityMore} from './guestActivityCopy';
test('Guest audit counts and pagination labels are explicit and localized',()=>{
 for(const locale of locales){
  const count=guestActivityCount(locale,5,12),more=guestActivityMore(locale);
  assert.ok(count.includes('5')&&count.includes('12'));assert.doesNotMatch(count,/\{shown\}|\{total\}/);
  assert.ok(more.length>4);
  if(locale==='en')assert.doesNotMatch(count+more,/[\u3400-\u9fff]/);
 }
 assert.equal(guestActivityCount('en',12,12),'Viewing 12 of 12 local DEMO events');
});
