import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("rejection consumes pending request before returning and cannot create a Product Session", () => {
  const start = app.indexOf('if (decision.kind === "rejected")');
  const end = app.indexOf("const approval = decision.approval", start);
  const branch = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(branch, /deleteItemAsync\(PENDING_KEY\)/);
  assert.match(branch, /No Social session was created/);
  assert.match(branch, /return;/);
  assert.doesNotMatch(branch, /walletChallenge|api\.login|setSession/);
});

test("no Android activity consumes pending request and exposes safe alternatives only", () => {
  const start = app.indexOf("if (!opened.opened)");
  const end = app.indexOf("setError(null)", start);
  const branch = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(branch, /deleteItemAsync\(PENDING_KEY\)/);
  assert.match(branch, /setWalletUnavailable\(true\)/);
  assert.match(branch, /No Social session was created/);
  assert.doesNotMatch(branch, /api\.login|setSession/);
  assert.match(app, /YNX_WALLET_DOWNLOAD_URL/);
  assert.match(app, /METAMASK_MOBILE_DAPP_URL/);
});
