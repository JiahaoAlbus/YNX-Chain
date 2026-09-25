import test from 'node:test';
import assert from 'node:assert/strict';
import {cardCallbackKind} from './providerCallback';
const base='https://card.ynxweb4.com/wallet-auth/callback';
test('application callback is preserved for the application verifier, not the login verifier',()=>{
  assert.equal(cardCallbackKind(base+'?cardApplicationApprovalResult=opaque'),'application');
  assert.equal(cardCallbackKind(base+'?result=approved&approval=opaque&nonce=n&state=s'),'session');
  assert.equal(cardCallbackKind(base+'?result=rejected&reason=user_rejected&nonce=n&state=s'),'session');
  assert.equal(cardCallbackKind(base+'?utm_source=wallet'),'none');
});
test('mixed and repeated callback discriminators are rejected',()=>{
  assert.equal(cardCallbackKind(base+'?result=approved&cardApplicationApprovalResult=opaque'),'invalid');
  assert.equal(cardCallbackKind(base+'?result=approved&result=rejected'),'invalid');
  assert.equal(cardCallbackKind(base+'?cardApplicationApprovalResult=a&cardApplicationApprovalResult=b'),'invalid');
  assert.equal(cardCallbackKind('https://other.example/wallet-auth/callback?result=approved'),'none');
});
