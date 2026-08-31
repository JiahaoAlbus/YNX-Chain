import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Source Control exposes revision-safe local branch workflows", async () => {
  const panel = await read("frontend/src/scm/SourceControlPanel.tsx"),
    workbench = await read("frontend/src/app/Workbench.tsx"),
    service = await read("services/git-service/src/service.mjs");
  for (const action of ["create-branch", "checkout", "merge", "delete-branch"])
    assert.ok(
      panel.includes(`"${action}"`) && service.includes(`body.action === "${action}"`),
      `${action} must be wired through both UI and broker`,
    );
  assert.match(workbench, /revision=\{project\.remoteRevision\}/);
  assert.match(panel, /expectedRevision: revision/);
  assert.match(panel, /crypto\.randomUUID\(\)/);
  assert.match(panel, /window\.confirm/);
  assert.match(service, /workspaceStore\.put/);
  assert.match(service, /git_merge_conflict/);
  assert.match(service, /\["merge", "--abort"\]/);
});

test("remote Git UI remains an honest no-credential preview boundary", async () => {
  const panel = await read("frontend/src/scm/SourceControlPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/git-service/src/service.mjs");
  assert.match(panel, /No credentials are stored in the browser/);
  assert.match(panel, /Previewing never performs a network request/);
  assert.match(client, /action: "remote-preview"/);
  assert.match(service, /server-side-credential-broker-required/);
  assert.match(service, /executable: false/);
  assert.doesNotMatch(panel, /action:\s*["'](?:pull|push|create-pr)["']/);
  assert.doesNotMatch(service, /fetch\(|GIT_ASKPASS.*body|authorization/i);
});
