import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowsRoot = path.join(repoRoot, ".github", "workflows");
const workflowNames = (await readdir(workflowsRoot))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .sort();

assert.ok(workflowNames.length > 0, "no GitHub Actions workflows found");

let externalActionCount = 0;
const violations = [];

for (const name of workflowNames) {
  const source = await readFile(path.join(workflowsRoot, name), "utf8");
  for (const [index, rawLine] of source.split("\n").entries()) {
    const line = rawLine.trim().replace(/^-\s*/, "");
    if (!line.startsWith("uses:")) continue;

    const reference = line.slice("uses:".length).split("#", 1)[0].trim();
    if (reference.startsWith("./")) continue;

    externalActionCount += 1;
    if (!/^[^@\s]+@[0-9a-f]{40}$/.test(reference)) {
      violations.push(`${name}:${index + 1}: ${reference}`);
    }
  }
}

assert.ok(externalActionCount > 0, "no external GitHub Actions references found");
assert.deepEqual(
  violations,
  [],
  `external GitHub Actions must use immutable 40-character commit pins:\n${violations.join("\n")}`,
);

console.log(
  `github actions pin check passed: ${externalActionCount} external references use immutable commits`,
);
