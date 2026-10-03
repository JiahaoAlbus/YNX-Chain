import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";

test("Desktop brand uses the exact original YNX graphic, preserving its wide aspect ratio", async () => {
  const bytes = await readFile(new URL("../src/ynx-logo.png", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d");
  assert.equal(bytes.readUInt32BE(16), 798);
  assert.equal(bytes.readUInt32BE(20), 420);
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const selector of [".brand img", ".dialog-brand img"]) {
    const rules = css.slice(css.indexOf(selector + "{")).split("}")[0];
    assert.match(rules, /height:auto/);
    assert.match(rules, /aspect-ratio:798\/420/);
    assert.match(rules, /object-fit:contain/);
    assert.match(rules, /flex-shrink:0/);
  }
});

test("Sidebar and every business or custody dialog retain the original YNX logo and Wallet name", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const sidebar = html.match(/<[^>]+class="brand"[^>]*>[\s\S]*?<\/div>/)?.[0];
  assert.ok(sidebar);
  assert.match(sidebar, /src="ynx-logo\.png"/);
  assert.match(sidebar, /Wallet/);
  const dialogs = [...html.matchAll(/<dialog\b[^>]*>([\s\S]*?)<\/dialog>/g)];
  assert.ok(dialogs.length >= 10);
  for (const [whole, content] of dialogs) {
    assert.match(content, /^<div class="dialog-brand"><img src="ynx-logo\.png" width="798" height="420" alt="Original YNX logo"><span>YNX Wallet<\/span><\/div>/, whole.slice(0, 90));
  }
});
