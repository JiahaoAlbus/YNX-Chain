import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("container port preview is reviewed, capability-scoped and opaque-origin", async () => {
  const workbench = await read("frontend/src/app/Workbench.tsx"),
    dialog = await read("frontend/src/runtime/PortPreviewDialog.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/runtime-profile-service/src/service.mjs"),
    styles = await read("frontend/src/styles.css");
  assert.match(workbench, /short-lived container loopback preview/);
  assert.match(workbench, /Remote SSH port forwarding is not enabled/);
  assert.match(dialog, /sandbox="allow-scripts"/);
  assert.doesNotMatch(dialog, /allow-same-origin/);
  assert.match(dialog, /cannot inherit IDE cookies or authorization headers/);
  assert.match(dialog, /WebSocket upgrades are not forwarded/);
  assert.match(client, /approval: "preview-port-once"/);
  assert.match(client, /revokePortPreview/);
  assert.match(service, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(service, /container-loopback-only/);
  assert.match(service, /access-control-allow-origin":"null"/);
  assert.match(service, /PREVIEW_REQUEST_HEADERS/);
  assert.doesNotMatch(service, /PREVIEW_REQUEST_HEADERS[^;]*cookie/);
  assert.match(styles, /\.main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.editor-actions\s*\{[^}]*overflow-x:\s*auto !important/);
});
