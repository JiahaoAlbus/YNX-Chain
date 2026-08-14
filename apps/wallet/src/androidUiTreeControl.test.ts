import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const control = resolve("scripts/android-ui-tree-control.mjs");

test("point prefers the unique clickable accessibility node over its text child", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ynx-wallet-ui-tree-"));
  const tree = join(directory, "tree.xml");
  try {
    await writeFile(
      tree,
      '<hierarchy><node text="" content-desc="Create a new Wallet" clickable="true" bounds="[10,20][110,220]"><node text="Create a new Wallet" content-desc="" clickable="false" bounds="[20,40][100,80]" /></node></hierarchy>',
    );
    const result = spawnSync(process.execPath, [control, "point", tree, "Create a new Wallet"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "60 120");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("point rejects multiple clickable accessibility nodes with the same label", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ynx-wallet-ui-tree-"));
  const tree = join(directory, "tree.xml");
  try {
    await writeFile(
      tree,
      '<hierarchy><node text="" content-desc="Approve" clickable="true" bounds="[0,0][10,10]" /><node text="" content-desc="Approve" clickable="true" bounds="[20,0][30,10]" /></hierarchy>',
    );
    const result = spawnSync(process.execPath, [control, "point", tree, "Approve"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /2 matches and 2 clickable accessibility matches/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
