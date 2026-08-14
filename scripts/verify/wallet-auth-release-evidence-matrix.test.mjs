import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const matrix = JSON.parse(readFileSync("release/integration/wallet-auth-release-evidence-matrix.json", "utf8"));
const vectorSet = JSON.parse(readFileSync("docs/integration/WALLET_AUTH_RELEASE_TEST_VECTORS.json", "utf8"));
const verifier = "scripts/verify/wallet-auth-release-evidence-matrix.mjs";

for (const vector of vectorSet.vectors) {
  test(vector.id, () => {
    const candidate = structuredClone(matrix);
    const platform = candidate.platforms.find((entry) => entry.id === vector.mutation.platformId);
    assert.ok(platform, `missing platform ${vector.mutation.platformId}`);
    if (Object.hasOwn(vector.mutation, "status")) platform.status = vector.mutation.status;
    if (Object.hasOwn(vector.mutation, "value")) platform.gates[vector.mutation.gate] = vector.mutation.value;
    if (Object.hasOwn(vector.mutation, "evidenceBindings")) platform.evidenceBindings[vector.mutation.gate] = vector.mutation.evidenceBindings;
    const candidatePath = join(tmpdir(), `ynx-wallet-release-vector-${process.pid}-${vector.id}.json`);
    writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
    const result = spawnSync(process.execPath, [verifier, candidatePath], { encoding: "utf8" });
    assert.equal(result.status, vector.expectedExit, result.stdout || result.stderr);
    assert.match(result.stderr, new RegExp(vector.expectedErrorContains.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
}
