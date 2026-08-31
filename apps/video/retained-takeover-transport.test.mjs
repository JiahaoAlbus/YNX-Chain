import assert from "node:assert/strict";
import {lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {cleanupPlacement, createCarrier, placeCarrier, validatePlacement} from "./scripts/video-retained-takeover-transport.mjs";

const objects = {
  "video-runtime-controlled-takeover.sh": await readFile(new URL("./scripts/video-runtime-controlled-takeover.sh", import.meta.url)),
  "video-retained-evidence-guard.mjs": await readFile(new URL("./scripts/video-retained-evidence-guard.mjs", import.meta.url)),
  "video-retained-evidence-inventory-p0311.json": await readFile(new URL("./release/evidence/p0-077/successor-20260831/video-retained-evidence-inventory-p0311.json", import.meta.url))
};
const carrier = createCarrier(objects);

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "ynx-video-control-")), parent = join(base, "control-plane"), root = join(parent, "video-viewer-wallet-560c467d");
  await mkdir(parent);
  const info = await import("node:fs/promises").then(({lstat}) => lstat(parent));
  const expectedParent = {dev: String(info.dev), ino: String(info.ino), uid: info.uid, gid: info.gid, mode: info.mode & 0o7777, nlink: info.nlink};
  await writeFile(join(parent, "preserve.sibling"), "preserve\n");
  expectedParent.nlink = (await import("node:fs/promises").then(({lstat}) => lstat(parent))).nlink;
  return {base, parent, root, expectedParent};
}

test("transport places exact three-object carrier, observes it and cleans only its root", async () => {
  const f = await fixture();
  const receipt = await placeCarrier(carrier, f);
  assert.equal(receipt.status, "PLACED_AWAITING_SIGNED_EXECUTION_BINDINGS");
  assert.equal((await validatePlacement(f.root, f.expectedParent)).carrier.sha256, receipt.carrier.sha256);
  assert.equal((await cleanupPlacement(f.root, f.expectedParent)).status, "EXACT_PLACEMENT_CLEANED_PARENT_PRESERVED");
  assert.equal(await readFile(join(f.parent, "preserve.sibling"), "utf8"), "preserve\n");
  await rm(f.base, {recursive: true});
});

for (const [label, option] of [["placement failure", {failAfterObject: 0}], ["prewrite failure", {failBeforeReceipt: true}]]) {
  test(`transport ${label} removes only its exact stage and preserves parent siblings`, async () => {
    const f = await fixture();
    await assert.rejects(placeCarrier(carrier, {...f, ...option}));
    assert.equal(await readFile(join(f.parent, "preserve.sibling"), "utf8"), "preserve\n");
    assert.deepEqual((await import("node:fs/promises").then(({readdir}) => readdir(f.parent))).sort(), ["preserve.sibling"]);
    await rm(f.base, {recursive: true});
  });
}

test("transport refuses cleanup before deleting owned bytes when a foreign stage child appears", async () => {
  const f = await fixture();
  await assert.rejects(placeCarrier(carrier, {...f, afterObject: async ({index, stage}) => {
    if (index === 0) { await writeFile(join(stage, "foreign"), "foreign\n"); throw new Error("FORCED_FOREIGN_STAGE"); }
  }}), /FOREIGN_STAGE_CHILD/);
  const stage = `${f.root}.next`;
  assert.deepEqual((await readdir(stage)).sort(), ["foreign", "video-runtime-controlled-takeover.sh"]);
  assert.deepEqual(await readFile(join(stage, "video-runtime-controlled-takeover.sh")), objects["video-runtime-controlled-takeover.sh"]);
  assert.equal(await readFile(join(f.parent, "preserve.sibling"), "utf8"), "preserve\n");
  await rm(f.base, {recursive: true});
});

test("transport refuses cleanup before deleting anything after a same-byte inode replacement", async () => {
  const f = await fixture();
  let oldInode;
  await assert.rejects(placeCarrier(carrier, {...f, afterObject: async ({index, target}) => {
    if (index === 0) {
      oldInode = (await lstat(target)).ino;
      const body = await readFile(target);
      await rm(target); await writeFile(target, body, {mode: 0o700});
      throw new Error("FORCED_REPLACEMENT");
    }
  }}), /SUBSTITUTED/);
  const target = join(`${f.root}.next`, "video-runtime-controlled-takeover.sh");
  assert.notEqual((await lstat(target)).ino, oldInode);
  assert.deepEqual(await readFile(target), objects["video-runtime-controlled-takeover.sh"]);
  assert.equal(await readFile(join(f.parent, "preserve.sibling"), "utf8"), "preserve\n");
  await rm(f.base, {recursive: true});
});
