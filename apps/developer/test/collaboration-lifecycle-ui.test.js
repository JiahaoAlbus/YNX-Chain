import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("collaboration UI lists durable access and confirms immediate revocation", async () => {
  const panel = await read("frontend/src/collaboration/CollaborationPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/collaboration-service/src/service.mjs");
  assert.match(panel, /ACCESS · \{members\.length\}/);
  assert.match(panel, /window\.confirm/);
  assert.match(client + service, /revoke-member-once/);
  assert.match(service, /access-revoked/);
  assert.match(service, /4003/);
  assert.match(service, /currentAccess/);
});

test("collaboration UI retries disconnected rooms only after durable access validation", async () => {
  const panel = await read("frontend/src/collaboration/CollaborationPanel.tsx");
  assert.match(panel, /collaborationAccess\(roomId\)/);
  assert.match(panel, /setReconnectTick/);
  assert.match(panel, /1500/);
  assert.match(panel, /Disconnected rooms\s+retry after 1\.5 seconds and revalidate durable access first/);
  assert.match(panel, /Terminal\s+input remains separately permissioned and off by default/);
});
