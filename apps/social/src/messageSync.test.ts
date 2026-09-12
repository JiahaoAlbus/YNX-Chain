import assert from "node:assert/strict";
import test from "node:test";
import { SocialAPI } from "./api";

test("message synchronization follows cursors and deduplicates overlapping pages", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify(urls.length === 1
      ? { messages: [{ id: "a" }, { id: "b" }], nextCursor: "b", hasMore: true }
      : { messages: [{ id: "b" }, { id: "c" }], nextCursor: "c", hasMore: false }));
  };
  try {
    const result = await new SocialAPI("https://example.invalid", "local-test-token").messages("conversation");
    assert.deepEqual(result.messages.map((message) => message.id), ["a", "b", "c"]);
    assert.match(urls[1]!, /after=b$/);
  } finally { globalThis.fetch = original; }
});

test("a nonadvancing synchronization cursor fails instead of looping", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ messages: [], nextCursor: "", hasMore: true }));
  try {
    await assert.rejects(new SocialAPI("https://example.invalid", "local-test-token").messages("conversation"), /did not advance/);
  } finally { globalThis.fetch = original; }
});
