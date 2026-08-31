import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname);
const script = resolve(root, "scripts/verify-public-browser.mjs");

test("public browser acceptance is source-bound and non-sensitive", () => {
  execFileSync(process.execPath, ["--check", script]);
  const source = readFileSync(script, "utf8");
  assert.match(source, /https:\/\/web4\.ynxweb4\.com\/video\//);
  assert.match(source, /560c467d61e74f7939b8ce527f14316c736b88a7/);
  assert.match(source, /launchPersistentContext/);
  assert.match(source, /cold-launch/);
  assert.match(source, /second-launch/);
  assert.match(source, /context\.pages\(\)\.length, 1/);
  assert.match(source, /consoleErrors\.length, 0/);
  assert.match(source, /methods, \[\]/);
  assert.match(source, /accountRequested: false/);
  assert.match(source, /signatureRequested: false/);
  assert.match(source, /transactionRequested: false/);
});
