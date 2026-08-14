import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Project Test presents exact discovery and one-time no-network review", async () => {
  const workbench = await read("frontend/src/app/Workbench.tsx"),
    client = await read("frontend/src/runtime/client.ts");
  assert.match(workbench, /Test project/);
  assert.match(workbench, /testCandidates/);
  assert.match(workbench, /maximumFiles: 32/);
  assert.match(workbench, /maximumPhases: 20/);
  assert.match(workbench, /Approve tests once/);
  assert.match(workbench + client, /test-once/);
  assert.match(workbench, /network: false/);
  assert.match(client, /task: "test-project"/);
});

test("workspace test broker allowlists runners and never invokes package scripts", async () => {
  const runtime = await read("services/workspace-agent/src/runtime.mjs"),
    serviceTest = await read("services/workspace-agent/test/runtime.test.mjs");
  for (const runner of ["javascript", "python", "go", "c", "cpp", "rust", "java", "solidity"])
    assert.match(runtime, new RegExp(`language: "${runner}"`));
  assert.match(runtime, /test_file_limit/);
  assert.match(runtime, /test_phase_limit/);
  assert.match(runtime, /tests_missing/);
  assert.match(runtime, /"--offline", "--locked"/);
  assert.match(runtime, /invalid_cargo_manifest/);
  assert.match(runtime, /invalid_cargo_lock/);
  assert.doesNotMatch(runtime, /npm\s+(?:run\s+)?test|package\.json.*scripts/s);
  assert.match(serviceTest, /CPP-TEST-PASS/);
  assert.match(serviceTest, /C-TEST-PASS/);
  assert.match(serviceTest, /MathOpsTest/);
  assert.match(serviceTest, /CounterTest/);
  const hardhatRunner = await read("services/workspace-agent/src/hardhat-solidity-test.mjs");
  assert.match(hardhatRunner, /Pinned Hardhat 3\.9\.0 runtime is required/);
  assert.match(hardhatRunner, /fb59b825b7d57f9de89cd9de2415b12aab1fcc7eb2573fd2bf5c9b969eacf4d9/);
  assert.match(hardhatRunner, /preferWasm: true/);
  assert.doesNotMatch(hardhatRunner, /https?:\/\//);
  const image = await read("scripts/build-cloud-toolchain-image.sh");
  assert.match(image, /junit_version="1\.14\.2"/);
  assert.match(image, /5566ffe2aa48263867bca745925f73bf7b01591b30d9a60f191c0b16fa0955e9/);
  assert.match(serviceTest, /sandbox\.network, false/);
});
