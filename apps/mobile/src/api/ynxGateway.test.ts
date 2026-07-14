import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchGatewayHealth, fetchSquareFeed } from "./ynxGateway";

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
