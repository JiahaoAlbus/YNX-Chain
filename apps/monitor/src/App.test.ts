import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const source = readFileSync("src/App.tsx", "utf8");
test("contains separate operator domains, role gates and truthful SLO language", () => {
  for (const marker of ["No historical uptime inferred", "Central infrastructure ownership", "required after explicit operator approval", "eth_requestAccounts", "personal_sign", "ensureYNXTestnet", "accountsChanged", "chainChanged", "disconnect"]) assert.ok(source.includes(marker), marker);
  assert.equal(source.includes("ynx-wallet://authorize"), false, "web Monitor must not navigate top-level to a Wallet scheme");
  assert.equal(source.includes("Signed wallet payload"), false, "web Monitor must not ask operators to paste a signature");
});
