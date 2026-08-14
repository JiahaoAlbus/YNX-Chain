import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("AI Software Engineer exposes Tester-backed deployment review without execution", async () => {
  const panel = await read("frontend/src/chat/AgentPanel.tsx"),
    service = await read("services/agent-orchestrator/src/service.mjs");
  for (const action of ["prepare-deployment", "approve-deployment"])
    assert.ok(
      panel.includes(`"${action}"`) &&
        service.includes(`body.action === "${action}"`),
      `${action} must be wired through UI and orchestrator`,
    );
  assert.match(service, /deployment-review-once/);
  assert.match(service, /review-only-no-network-no-signing/);
  assert.match(service, /executable: false/);
  assert.match(panel, /Execution remains disabled/);
  assert.doesNotMatch(service, /fetch\(|privateKey|mnemonic|sendTransaction/);
});

test("AI model and context evidence is visible without invented cost", async () => {
  const panel = await read("frontend/src/chat/AgentPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/agent-orchestrator/src/service.mjs");
  assert.match(panel, /Requested context/);
  assert.match(panel, /Approved context/);
  assert.match(panel, /input \+.*output tokens/);
  assert.match(panel, /cost unreported by provider/);
  assert.match(client + service, /unreported-by-provider/);
  assert.match(service, /summarizeUsage/);
});
