import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const load = (n) => readFile(resolve(here, "../web", n), "utf8");
test("Calendar is an accessible independent time product", async () => {
  const html = await load("index.html");
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /class="skip"/);
  assert.match(html, /id="timeline"[^>]*tabindex="-1"/);
  assert.match(html, /role="grid"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Sign in with YNX Wallet/);
  assert.match(html, /data-i18n="recover"/);
  assert.match(html, /id="guest-try"[^>]*data-i18n="try_guest"/);
  assert.match(html, /id="locale-picker"/);
  assert.match(html, /src="\/ynx-logo\.png"/);
  assert.doesNotMatch(html, /class="mark(?:\s|\")/);
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
  assert.match(css, /\.form-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.toast\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.signin-frame\s*\{[^}]*grid-template-columns/s);
  assert.doesNotMatch(css, /linear-gradient\([^)]*(#|rgb)/i);
  assert.doesNotMatch(css, /neon|text-shadow/i);
  assert.match(css, /repeat\(var\(--visible-days, 7\), minmax\(0, 1fr\)\)/);
  assert.match(css, /\.month-grid\s*\{[^}]*min-width:\s*0/s);
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
    "connectCalendarWallet",
    "WALLET_NOT_INSTALLED",
    "private Calendar sync is degraded",
    "guestEventsKey",
    "Local draft saved on this device",
    "no sync, sharing, AI, or chain writes",
  ])
    assert.ok(js.includes(term), `missing ${term}`);
  assert.match(js, /each change still requires preview and approval/);
  assert.match(js, /the calendar was not changed/);
  assert.match(sw, /caches\.open/);
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(sw, /ynx-logo\.png/);
  assert.match(sw, /ynx-app-icon\.png/);
  assert.doesNotMatch(
    js,
    /wallet_proof|Authorization=`Bearer|ynx\.calendar\.session/,
  );
});
