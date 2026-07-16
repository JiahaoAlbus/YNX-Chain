import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const source = readFileSync("src/App.tsx", "utf8");
test("contains separate operator domains, role gates and truthful SLO language", () => {
  assert.ok(source.includes("No historical uptime inferred"));
  assert.ok(source.includes("Central infrastructure ownership"));
  assert.ok(source.includes("required after explicit operator approval"));
});
