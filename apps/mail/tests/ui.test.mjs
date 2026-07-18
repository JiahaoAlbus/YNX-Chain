import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const load = (n) => readFile(resolve(here, "../web", n), "utf8");
test("Mail is an accessible independent reading and writing product", async () => {
  const html = await load("index.html");
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /class="skip"/);
  assert.match(html, /id="reading-pane"[^>]*tabindex="-1"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Sign in with YNX Wallet/);
  assert.match(html, /恢复已有 Mail 账户/);
  assert.doesNotMatch(html, /\bynx1|0x[a-fA-F0-9]{8}/);
});
test("Mail visual and responsive contract is restrained Klein blue", async () => {
  const css = await load("styles.css");
  assert.match(css, /#002fa7/i);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /forced-colors:\s*active/);
  assert.doesNotMatch(css, /linear-gradient\([^)]*(#|rgb)/i);
  assert.doesNotMatch(css, /neon|text-shadow/i);
});
test("Mail offline, approval, attachment, Trust and AI boundaries are wired", async () => {
  const [html, js, sw] = await Promise.all([
    load("index.html"),
    load("app.js"),
    load("sw.js"),
  ]);
  for (const term of [
    "offlineDraft",
    "confirm-send",
    "/v1/reports",
    "/v1/ai/jobs",
    "canonical request envelope",
  ])
    assert.ok(js.includes(term), `missing ${term}`);
  assert.match(js, /10\s*\*\s*1024\s*\*\s*1024/);
  assert.ok(html.includes("review-send"));
  assert.match(sw, /caches\.open/);
  assert.match(js, /AI 结果仅应用到草稿/);
  assert.match(html, /AI 只读取你勾选的当前邮件/);
  assert.doesNotMatch(
    js,
    /wallet_proof|Authorization=`Bearer|ynx\.mail\.session/,
  );
});
