import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { boundedReadFetch } from "../frontend/src/runtime/client.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

test("bounded connection recovery retries transient reads and never accepts a mutation", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response("{}", { status: attempts < 3 ? 503 : 200 });
  };
  try {
    const response = await boundedReadFetch("/runtime/health");
    assert.equal(response.status, 200);
    assert.equal(attempts, 3);
    await assert.rejects(
      boundedReadFetch("/runtime/tasks", { method: "POST" }),
      /read-only requests only/,
    );
    assert.equal(attempts, 3, "a mutation must not reach fetch through the retry path");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workbench exposes manual retry and reconnects safe reads when the browser returns online", async () => {
  const workbench = await readFile(`${root}/frontend/src/app/Workbench.tsx`, "utf8"),
    chain = await readFile(`${root}/frontend/src/chain/ChainPanel.tsx`, "utf8"),
    agent = await readFile(`${root}/frontend/src/chat/AgentPanel.tsx`, "utf8");
  assert.match(workbench, /connected · block/);
  assert.match(workbench, /offline · retry/);
  assert.match(workbench, /addEventListener\("online", handleOnline\)/);
  assert.match(workbench, /"Reconnect"/);
  assert.match(chain, /Retry connection/);
  assert.match(agent, /Retry models/);
});
