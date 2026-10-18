import assert from "node:assert/strict";
import test from "node:test";
import {authorizationReviewReady,authorizationResultMatches} from "../scripts/callback-ui-gate.mjs";

const before={hidden:false,open:true,reviewId:"review-1",requestId:"review-1",resultCode:"AWAITING_APPROVAL",callbackEmitted:"false",authorityGranted:"false",productSessionCreated:"false"};
const result=action=>({...before,resultCode:action==="approve"?"CANONICAL_AUTHORIZATION_APPROVED":"USER_REJECTED",callbackEmitted:"true",authorityGranted:String(action==="approve")});
for(const action of ["approve","reject"])test(`${action} succeeds only for the same immutable displayed request`,()=>{
  assert.equal(authorizationReviewReady(before),true);
  assert.equal(authorizationResultMatches(before,result(action),action),true);
  for(const wrong of [{requestId:"review-previous"},{reviewId:"review-next"},{callbackEmitted:"false"},{resultCode:"AWAITING_APPROVAL"},{productSessionCreated:"true"},{authorityGranted:String(action!=="approve")}])assert.equal(authorizationResultMatches(before,{...result(action),...wrong},action),false);
});
test("stale completed state, missing response and unchanged pending state never pass the callback UI gate",()=>{
  for(const stale of [{hidden:true},{open:false},{reviewId:null},{requestId:"different"},{resultCode:"USER_REJECTED"},{callbackEmitted:"true"}])assert.equal(authorizationResultMatches({...before,...stale},result("reject"),"reject"),false);
  assert.equal(authorizationResultMatches(before,undefined,"approve"),false);
  assert.equal(authorizationResultMatches(before,before,"approve"),false);
  assert.equal(authorizationResultMatches(before,result("approve"),"unknown"),false);
});
test('reference return is only locator delivery, never authority or product-session completion',()=>{
 const reference={...result('approve'),returnKind:'reference',authorityGranted:'false'};
 assert.equal(authorizationResultMatches(before,reference,'approve'),true);
 for(const wrong of [{authorityGranted:'true'},{productSessionCreated:'true'},{returnKind:'unknown'},{requestId:'other'},{callbackEmitted:'false'}])assert.equal(authorizationResultMatches(before,{...reference,...wrong},'approve'),false);
 assert.equal(authorizationResultMatches(before,reference,'reject'),false);
 assert.equal(authorizationResultMatches(before,{...result('reject'),returnKind:'reference'},'reject'),false);
});
