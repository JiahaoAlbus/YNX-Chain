import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildLiteralReplacement } from "../frontend/src/search/literalReplace.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

test("literal project replacement counts and changes exact text across files", () => {
  const plan = buildLiteralReplacement(
    { "a.ts": "Alpha a.b ALPHA", "b.ts": "aXb a.b", "c.ts": "unchanged" },
    "a.b",
    "$&",
    false,
  );
  assert.equal(plan.matches, 2);
  assert.deepEqual(plan.changedPaths, ["a.ts", "b.ts"]);
  assert.equal(plan.files["a.ts"], "Alpha $& ALPHA");
  assert.equal(plan.files["b.ts"], "aXb $&");
  assert.equal(plan.files["c.ts"], "unchanged");
  const sensitive = buildLiteralReplacement({ "a.ts": "Name name NAME" }, "Name", "value", true);
  assert.equal(sensitive.matches, 1);
  assert.equal(sensitive.files["a.ts"], "value name NAME");
});

test("project replace UI previews, confirms and leaves changed paths dirty", async () => {
  const workbench = await readFile(`${root}/frontend/src/app/Workbench.tsx`, "utf8");
  assert.match(workbench, /literal matches in/);
  assert.match(workbench, /window\.confirm/);
  assert.match(workbench, /recoverable in Workspace History/);
  assert.match(workbench, /setDirty.*changed/s);
  assert.match(workbench, /collaborationReadOnly/);
  assert.doesNotMatch(workbench, /ChevronDown/);
});
