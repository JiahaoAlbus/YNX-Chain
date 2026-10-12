import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("current macOS DMG candidate preserves direct install evidence without a public-release claim", async () => {
  const [record, handoff] = await Promise.all([
    readFile(`${root}/evidence/desktop/macos-current-ccab67b2.json`, "utf8").then(JSON.parse),
    readFile(`${root}/docs/integration/DEVELOPER_MACOS_DMG_CANDIDATE_HANDOFF_20260831.md`, "utf8"),
  ]);
  assert.equal(record.artifact.filename.endsWith(".dmg"), true);
  assert.equal(record.artifact.sourceCommit, "ccab67b2ceaeeaeb962dd6e67696bb3f73835120");
  assert.equal(record.artifact.sourceTree, "38524871d45f8239377ed832fe04b51bceee476f");
  assert.equal(record.artifact.sha256, "71eb57a55521ea42949ed24d8f5b078a3b9cfa1032cabcd2ca2717c64e6fe775");
  for (const key of ["dmgMounted", "isolatedInstallCopy", "coldLaunch", "boundedCppCompile", "cppDocumentSymbols", "workspaceSecondLaunchPersistence", "childCleanup"]) assert.equal(record.verification[key], true, key);
  assert.equal(record.publication.downloadHosted, false);
  assert.equal(record.publication.externalHttpsReadback, false);
  assert.equal(record.publication.productionSigned, false);
  assert.equal(record.boundaries.publicRuntimeSourceBound, false);
  assert.match(handoff, /Replace any public macOS installer wording that points to a ZIP/);
  assert.match(handoff, /productionSigned=false/);
});
