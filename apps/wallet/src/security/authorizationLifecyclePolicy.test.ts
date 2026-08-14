import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAuthorizationAttemptActive } from "./authorizationLifecyclePolicy";

const attempt=Object.freeze({generation:4,account:"ynx1-reviewed"}),current=Object.freeze({generation:4,account:"ynx1-reviewed"}),expiresAt="2026-08-14T12:05:00.000Z";

test("an unchanged foreground review remains active before its exact expiry",()=>{
  assert.doesNotThrow(()=>assertAuthorizationAttemptActive(attempt,current,expiresAt,new Date("2026-08-14T12:04:59.999Z")));
});

test("background dismissal, account drift and expiry fail closed",()=>{
  assert.throws(()=>assertAuthorizationAttemptActive(attempt,{...current,generation:5},expiresAt,new Date("2026-08-14T12:04:00.000Z")),/dismissed|background/);
  assert.throws(()=>assertAuthorizationAttemptActive(attempt,{...current,account:"ynx1-other"},expiresAt,new Date("2026-08-14T12:04:00.000Z")),/account changed/);
  assert.throws(()=>assertAuthorizationAttemptActive(attempt,current,expiresAt,new Date(expiresAt)),/expired/);
  assert.throws(()=>assertAuthorizationAttemptActive(attempt,current,"2026-08-14T12:05:00Z",new Date("2026-08-14T12:04:00.000Z")),/expiry is invalid/);
  assert.throws(()=>assertAuthorizationAttemptActive(attempt,current,expiresAt,new Date(Number.NaN)),/time is invalid/);
});
