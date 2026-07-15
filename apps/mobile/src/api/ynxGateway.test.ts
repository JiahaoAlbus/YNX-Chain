import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchGatewayHealth, fetchSquareComments, fetchSquareFeed, fetchSquareFollowing, fetchSquareProfile } from "./ynxGateway";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("validates live-feed response fields", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ posts: [{ id: "post-1", author: "ynx1owner", content: "hello", commentCount: 1, reactionCount: 2, createdAt: "2026-07-14T00:00:00Z" }] }), { status: 200 });
  const posts = await fetchSquareFeed();
  assert.equal(posts[0]?.content, "hello");
});

test("rejects malformed and failed responses", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ posts: [{ id: 1 }] }), { status: 200 });
  await assert.rejects(fetchSquareFeed(), /invalid payload/);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
  await assert.rejects(fetchGatewayHealth(), /unavailable/);
});

test("validates Square comments and following reads", async () => {
  const responses = [
    { comments: [{ id: "comment_1", postId: "post_1", author: "ynx1owner", authorDevice: "device_1", content: "reply", status: "active", createdAt: "2026-07-15T00:00:00Z" }] },
    { following: ["ynx1llllllllllllllllllllllllllllllllyj698f"] },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify(responses.shift()), { status: 200 });
  assert.equal((await fetchSquareComments("post_1"))[0]?.content, "reply");
  assert.equal((await fetchSquareFollowing("ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"))[0], "ynx1llllllllllllllllllllllllllllllllyj698f");
});

test("validates public Square profile counts", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", displayName: "Alice", bio: "Native profile", createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T00:00:00Z", followerCount: 4, followingCount: 2, postCount: 7 }), { status: 200 });
  const profile = await fetchSquareProfile("ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80");
  assert.equal(profile.displayName, "Alice");
  assert.equal(profile.postCount, 7);
});

test("rejects malformed Square social reads before use", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ comments: [{ id: 1 }] }), { status: 200 });
  await assert.rejects(fetchSquareComments("post_1"), /invalid payload/);
  await assert.rejects(fetchSquareComments("../escape"), /post ID is invalid/);
  await assert.rejects(fetchSquareFollowing("0x0000000000000000000000000000000000000000"), /profile account is invalid/);
  await assert.rejects(fetchSquareProfile("0x0000000000000000000000000000000000000000"), /profile account is invalid/);
});
