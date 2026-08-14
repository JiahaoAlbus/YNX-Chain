#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [command, file, expected] = process.argv.slice(2);
if (!command || !file) fail("usage: android-ui-tree-control.mjs point|assert-label|assert-secret-free tree.xml [exact-label]");
const body = await readFile(file, "utf8");
assertSecretFree(body);

if (command === "assert-secret-free") {
  console.log(JSON.stringify({ verified: true, secretMaterialRecorded: false }));
} else if (command === "assert-label" || command === "point") {
  if (!expected) fail("an exact accessibility label is required");
  const matches = [...body.matchAll(/<node\b([^>]*)\/?\s*>/g)]
    .map((match) => attributes(match[1] ?? ""))
    .filter((node) => node.text === expected || node["content-desc"] === expected);
  const accessibleMatches = matches.filter((node) => node["content-desc"] === expected && node.clickable === "true");
  const selected = matches.length === 1 ? matches[0] : accessibleMatches.length === 1 ? accessibleMatches[0] : undefined;
  if (!selected) {
    fail(
      `expected one unambiguous UI node named ${JSON.stringify(expected)}, found ${matches.length} matches and ${accessibleMatches.length} clickable accessibility matches`,
    );
  }
  if (command === "assert-label") console.log(JSON.stringify({ verified: true, label: expected }));
  else {
    const bounds = selected.bounds?.match(/^\[(\d+),(\d+)]\[(\d+),(\d+)]$/);
    if (!bounds) fail("matched UI node has no canonical bounds");
    const [, left, top, right, bottom] = bounds.map(Number);
    if (!(right > left && bottom > top)) fail("matched UI node has empty bounds");
    console.log(`${Math.floor((left + right) / 2)} ${Math.floor((top + bottom) / 2)}`);
  }
} else fail(`unsupported command: ${command}`);

function attributes(value) {
  return Object.fromEntries([...value.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], decode(match[2] ?? "")]));
}
function decode(value) { return value.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"); }
function assertSecretFree(value) {
  if (/(?:text|content-desc)="\s*[0-9a-fA-F]{64}\s*"/.test(value)) fail("UI tree contains 64-character recovery material");
  if (/\b(?:secretHex|accountSecret|mnemonic)\b/i.test(value)) fail("UI tree contains a forbidden secret field name");
}
function fail(message) { console.error(`Wallet Android UI tree rejected: ${message}`); process.exit(1); }
