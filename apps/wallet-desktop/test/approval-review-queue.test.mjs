import assert from "node:assert/strict";
import { test } from "node:test";
import { ApprovalReviewQueue } from "../src/approval-review-queue.mjs";

test("an incoming login cannot replace a message the user is reviewing or approving", () => {
  const queue = new ApprovalReviewQueue({ now: () => 1000 });
  queue.enqueue("provider", { id: "message-A", origin: "https://a.example" });
  queue.enqueue("authorization", { id: "login-B", origin: "https://b.example" });
  assert.equal(queue.current.review.id, "message-A");
  const action = queue.begin(queue.current.key);
  queue.enqueue("proposal", { id: 3 });
  assert.equal(action.review.id, "message-A");
  assert.equal(queue.begin("authorization:login-B"), null);
  assert.equal(queue.finish("authorization:login-B"), false);
  queue.finish(action.key);
  assert.equal(queue.current.review.id, "login-B");
});

test("a request expired during signing cannot promote another request until that action settles", () => {
  let now = 1000;
  const queue = new ApprovalReviewQueue({ now: () => now });
  queue.enqueue("provider", { id: "expiring", expiresAt: new Date(1500).toISOString() });
  queue.enqueue("provider", { id: "later" });
  const action = queue.begin(queue.current.key);
  now = 2000;
  queue.sweep();
  assert.equal(queue.current.key, action.key);
  assert.equal(queue.begin("provider:later"), null);
  queue.finish(action.key);
  assert.equal(queue.current.review.id, "later");
});

test("expired, duplicate and out-of-order actions never target the next approval", () => {
  let now = 1000;
  const queue = new ApprovalReviewQueue({ now: () => now });
  assert.equal(queue.enqueue("authorization", { id: "expired", expiresAt: new Date(500).toISOString() }), false);
  queue.enqueue("proposal", { id: 1 });
  queue.enqueue("proposal", { id: 1, origin: "https://replacement.example" });
  queue.enqueue("provider", { id: 1 });
  assert.equal(queue.count, 2);
  assert.equal(queue.current.review.origin, undefined);
  queue.remove("proposal", 1);
  assert.equal(queue.begin("proposal:1"), null);
  assert.equal(queue.current.key, "provider:1");
  now += 300_001;
  assert.equal(queue.begin("provider:1"), null);
  assert.equal(queue.current, null);
});

test("account setup refreshes only the original unsigned request and callback retries retain that review", () => {
  const queue = new ApprovalReviewQueue({ now: () => 1000 });
  const request = { productId: "creator-studio", nonce: "original" };
  queue.enqueue("authorization", { id: "login", account: null, request });
  queue.enqueue("provider", { id: "later" });
  assert.equal(queue.refreshAuthorization({ id: "login", account: "account-A", request: { ...request, nonce: "changed" } }), false);
  assert.equal(queue.refreshAuthorization({ id: "login", account: "account-A", request }), true);
  const approval = queue.begin("authorization:login");
  assert.equal(approval.review.account, "account-A");
  assert.equal(queue.refreshAuthorization({ id: "login", account: "account-B", request }), false);
  queue.finish(approval.key, { remove: false });
  assert.equal(queue.current.key, approval.key);
  assert.equal(queue.current.review.account, "account-A");
  queue.begin(approval.key);
  queue.finish(approval.key);
  assert.equal(queue.current.key, "provider:later");
});
