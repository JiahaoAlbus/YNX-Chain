import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const load = (n) => readFile(resolve(here, "../web", n), "utf8");
test("Calendar is an accessible independent time product", async () => {
  const html = await load("index.html");
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /class="skip"/);
  assert.match(html, /id="timeline"[^>]*tabindex="-1"/);
  assert.match(html, /role="grid"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Sign in with YNX Wallet/);
  assert.match(html, /恢复已有 Calendar 账户/);
  assert.doesNotMatch(html, /\bynx1|0x[a-fA-F0-9]{8}/);
});
test("Calendar visual and responsive contract is restrained Klein blue", async () => {
  const css = await load("styles.css");
  assert.match(css, /#002fa7/i);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /forced-colors:\s*active/);
  assert.doesNotMatch(css, /linear-gradient\([^)]*(#|rgb)/i);
  assert.doesNotMatch(css, /neon|text-shadow/i);
});
test("Calendar offline, explicit approval, conflict and AI boundaries are wired", async () => {
  const [js, sw] = await Promise.all([load("app.js"), load("sw.js")]);
  for (const term of [
    "offlineQueue",
    "/preview",
    "approve-change",
    "accept-conflicts",
    "/revert",
    "/rsvp",
    "/share",
    "/v1/ai/jobs",
    "canonical request envelope",
  ])
    assert.ok(js.includes(term), `missing ${term}`);
  assert.match(js, /仍需逐项预览批准/);
  assert.match(js, /未修改日程/);
  assert.match(sw, /caches\.open/);
  assert.doesNotMatch(
    js,
    /wallet_proof|Authorization=`Bearer|ynx\.calendar\.session/,
  );
});
