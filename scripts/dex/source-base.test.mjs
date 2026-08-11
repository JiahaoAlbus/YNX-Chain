import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveSourceBaseCommit } from "./source-base.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

test("release source binding permits evidence-only commits and rejects source drift", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ynx-dex-source-base-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "YNX Test"]);
    git(root, ["config", "user.email", "test@invalid.local"]);
    await mkdir(path.join(root, "contracts/dex"), { recursive: true });
    await writeFile(path.join(root, "contracts/dex/Pool.sol"), "contract Pool {}\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "source"]);
    const sourceCommit = git(root, ["rev-parse", "HEAD"]);
    await writeFile(path.join(root, "product-release.json"), JSON.stringify({ commit: sourceCommit }));
    await writeFile(path.join(root, "EVIDENCE.md"), "verified locally\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "evidence"]);

    assert.equal(await resolveSourceBaseCommit(root, ["contracts/dex"]), sourceCommit);

    await writeFile(path.join(root, "contracts/dex/Pool.sol"), "contract Pool { uint changed; }\n");
    await assert.rejects(resolveSourceBaseCommit(root, ["contracts/dex"]), /release source changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
