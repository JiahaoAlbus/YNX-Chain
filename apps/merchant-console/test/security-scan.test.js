import test from "node:test";
import assert from "node:assert/strict";

import { scanRuntimeText } from "../scripts/check-runtime-source.mjs";

test("runtime source scan permits translated todo words", () => {
  const translated = 'const es = "Todo está disponible"; const pt = "Todos os registos";';
  assert.deepEqual(scanRuntimeText(translated), []);
});

test("runtime source scan rejects actionable placeholders and credential material", () => {
  const samples = [
    "// todo: implement this",
    "const marker = 'TODO';",
    "const status = 'Coming soon';",
    "const endpoint = 'https://example.com';",
    "-----BEGIN PRIVATE KEY-----",
    "AKIA1234567890ABCDEF",
    "sk_live_1234567890",
  ];
  for (const sample of samples) {
    assert.notEqual(scanRuntimeText(sample).length, 0, sample);
  }
});
