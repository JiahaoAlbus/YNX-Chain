import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidence = JSON.parse(await readFile(new URL("../evidence/integration/developer-wallet-migration-evidence-segments-20260821.json", import.meta.url), "utf8"));

test("Developer Wallet migration evidence remains source-only and segmented", () => {
  assert.equal(evidence.status, "SOURCE_CONSUMED_PRODUCTS_UNCONNECTED");
  assert.equal(evidence.evaluatedBy.commit, "e8125d56f8c28efbfa0f87c673717c620ca023e7");
  assert.equal(evidence.input.sharedSource.commit, "98c6d5d784d212df8981a53b17118a511e246ad2");
  assert.equal(evidence.result.sourceAccepted, true);
  assert.equal(evidence.result.productsConnected, 0);
  assert.equal(evidence.result.migratedV2, false);
  assert.deepEqual(evidence.result.missing, [
    "source-bound-public-runtime",
    "visible-standard-wallet-lifecycle",
    "exact-approve-reject-callback",
    "product-session-v2-lifecycle",
  ]);
});
