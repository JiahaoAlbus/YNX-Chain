import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile, chmod} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const PRODUCTION_ROOT = "/opt/ynx-release-control-plane/video-viewer-wallet-560c467d";
const ORDER = Object.freeze([
  "video-runtime-controlled-takeover.sh",
  "video-retained-evidence-guard.mjs",
  "video-retained-evidence-inventory-p0311.json"
]);
const EXPECTED = Object.freeze({
  "video-runtime-controlled-takeover.sh": Object.freeze({mode: 0o700, bytes: 16126, sha256: "216c5c14fd25bf2b817f67c5b4ea73cc76821a31dac459841d2258e4f49f07c6"}),
  "video-retained-evidence-guard.mjs": Object.freeze({mode: 0o600, bytes: 3127, sha256: "b451d2ccfd2be3ac7a1a1517516e51a43b86f352c7fe9717e94f22f4f2ef8298"}),
  "video-retained-evidence-inventory-p0311.json": Object.freeze({mode: 0o600, bytes: 2370, sha256: "22c23b3f026599867229684d42a49ba3d183fc8e0ce675823ba595a77589192b"})
});
const stable = (value) => JSON.stringify(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mode = (info) => info.mode & 0o7777;

async function absent(path) {
  try { await lstat(path); throw new Error(`PATH_NOT_ABSENT:${path}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

async function identity(path) {
  const info = await lstat(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, `NON_ORDINARY_FILE:${path}`);
  const bytes = await readFile(path);
  return {dev: String(info.dev), ino: String(info.ino), uid: info.uid, gid: info.gid, mode: mode(info), nlink: info.nlink, bytes: bytes.length, sha256: sha256(bytes)};
}

async function directoryIdentity(path) {
  const info = await lstat(path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), `NON_ORDINARY_DIRECTORY:${path}`);
  return {dev: String(info.dev), ino: String(info.ino), uid: info.uid, gid: info.gid, mode: mode(info), nlink: info.nlink};
}
const directoryCore = ({dev, ino, uid, gid, mode}) => ({dev, ino, uid, gid, mode});

function decode(raw) {
  let carrier;
  try { carrier = JSON.parse(raw.toString("utf8")); } catch { throw new Error("CARRIER_JSON_INVALID"); }
  assert.equal(stable(carrier) + "\n", raw.toString("utf8"), "CARRIER_NOT_CANONICAL_OR_EXTRA");
  assert.equal(carrier.schemaVersion, "ynx-video-retained-takeover-carrier/1");
  assert.deepEqual(carrier.objects?.map((entry) => entry.name), ORDER);
  for (const entry of carrier.objects) {
    const expected = EXPECTED[entry.name];
    assert.deepEqual({mode: entry.mode, bytes: entry.bytes, sha256: entry.sha256}, expected, `CARRIER_METADATA_INVALID:${entry.name}`);
    const decoded = Buffer.from(entry.base64, "base64");
    assert.equal(decoded.toString("base64"), entry.base64, `CARRIER_BASE64_NON_CANONICAL:${entry.name}`);
    assert.equal(decoded.length, expected.bytes, `CARRIER_BYTES_INVALID:${entry.name}`);
    assert.equal(sha256(decoded), expected.sha256, `CARRIER_SHA_INVALID:${entry.name}`);
    entry.decoded = decoded;
  }
  return carrier;
}

async function removeExact(path, expected) {
  let actual;
  try { actual = await identity(path); } catch (error) {
    if (error.code === "ENOENT") return;
    throw new Error(`IDENTITY_BOUND_CLEANUP_REFUSED:${path}:${error.message}`);
  }
  assert.deepEqual(actual, expected, `IDENTITY_BOUND_CLEANUP_REFUSED:${path}:SUBSTITUTED`);
  await rm(path);
}

async function cleanStage(stage, created) {
  const actualNames = (await readdir(stage)).sort(), expectedNames = created.map((entry) => entry.name).sort();
  assert.deepEqual(actualNames, expectedNames, `FOREIGN_STAGE_CHILD:${actualNames.join(",")}`);
  for (const entry of created) assert.deepEqual(await identity(join(stage, entry.name)), entry.identity, `IDENTITY_BOUND_CLEANUP_REFUSED:${entry.name}:SUBSTITUTED`);
  for (const entry of [...created].reverse()) await removeExact(join(stage, entry.name), entry.identity);
  assert.deepEqual(await readdir(stage), []);
  await rmdir(stage);
}

export function createCarrier(objects) {
  return Buffer.from(stable({schemaVersion: "ynx-video-retained-takeover-carrier/1", objects: ORDER.map((name) => {
    const bytes = objects[name], expected = EXPECTED[name];
    assert.ok(Buffer.isBuffer(bytes));
    return {name, mode: expected.mode, bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString("base64")};
  })}) + "\n");
}

export async function placeCarrier(raw, {root = PRODUCTION_ROOT, expectedParent, failAfterObject = -1, failBeforeReceipt = false, afterObject} = {}) {
  const carrier = decode(raw), parent = dirname(root), stage = `${root}.next`, created = [];
  assert.ok(expectedParent, "EXPECTED_PARENT_IDENTITY_REQUIRED");
  assert.deepEqual(directoryCore(await directoryIdentity(parent)), directoryCore(expectedParent), "CONTROL_PARENT_IDENTITY_MISMATCH");
  await absent(root); await absent(stage);
  await mkdir(stage, {mode: 0o700});
  try {
    for (let index = 0; index < carrier.objects.length; index += 1) {
      const entry = carrier.objects[index], target = join(stage, entry.name);
      await writeFile(target, entry.decoded, {flag: "wx", mode: entry.mode});
      await chmod(target, entry.mode);
      const placed = await identity(target);
      assert.deepEqual({mode: placed.mode, bytes: placed.bytes, sha256: placed.sha256}, EXPECTED[entry.name], `PLACED_OBJECT_MISMATCH:${entry.name}`);
      created.push({name: entry.name, identity: placed});
      if (afterObject) await afterObject({index, target, stage});
      if (index === failAfterObject) throw new Error("FIXTURE_PLACEMENT_FAILURE");
    }
    if (failBeforeReceipt) throw new Error("FIXTURE_PREWRITE_FAILURE");
    const receipt = {schemaVersion: "ynx-video-retained-takeover-placement/1", status: "PLACED_AWAITING_SIGNED_EXECUTION_BINDINGS", root, parent: expectedParent, carrier: {bytes: raw.length, sha256: sha256(raw)}, objects: Object.fromEntries(created.map((entry) => [entry.name, entry.identity]))};
    const receiptBytes = Buffer.from(stable(receipt) + "\n"), receiptPath = join(stage, "placement.receipt.json");
    await writeFile(receiptPath, receiptBytes, {flag: "wx", mode: 0o600});
    await chmod(receiptPath, 0o600);
    created.push({name: "placement.receipt.json", identity: await identity(receiptPath)});
    await rename(stage, root);
    return validatePlacement(root, expectedParent);
  } catch (error) {
    await cleanStage(stage, created);
    throw error;
  }
}

export async function validatePlacement(root = PRODUCTION_ROOT, expectedParent) {
  assert.deepEqual(directoryCore(await directoryIdentity(dirname(root))), directoryCore(expectedParent), "CONTROL_PARENT_IDENTITY_MISMATCH");
  const names = (await readdir(root)).sort();
  assert.deepEqual(names, [...ORDER, "placement.receipt.json"].sort(), "PLACEMENT_TREE_NOT_EXACT");
  const receipt = JSON.parse(await readFile(join(root, "placement.receipt.json"), "utf8"));
  assert.equal(receipt.root, root);
  assert.deepEqual(receipt.parent, expectedParent);
  for (const name of ORDER) assert.deepEqual(await identity(join(root, name)), receipt.objects[name], `PLACEMENT_OBJECT_SUBSTITUTED:${name}`);
  return receipt;
}

export async function cleanupPlacement(root = PRODUCTION_ROOT, expectedParent) {
  const receipt = await validatePlacement(root, expectedParent);
  for (const name of [...ORDER].reverse()) await removeExact(join(root, name), receipt.objects[name]);
  const receiptPath = join(root, "placement.receipt.json"), receiptIdentity = await identity(receiptPath);
  await removeExact(receiptPath, receiptIdentity);
  assert.deepEqual(await readdir(root), []);
  await rmdir(root);
  assert.deepEqual(await directoryIdentity(dirname(root)), expectedParent, "CONTROL_PARENT_CHANGED_AFTER_CLEANUP");
  return {status: "EXACT_PLACEMENT_CLEANED_PARENT_PRESERVED"};
}

async function stdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks); }
const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  const command = process.argv[2], expectedParent = JSON.parse(process.env.YNX_VIDEO_CONTROL_PARENT_IDENTITY_JSON || "null");
  if (command === "place") process.stdout.write(`${stable(await placeCarrier(await stdin(), {expectedParent}))}\n`);
  else if (command === "observe") process.stdout.write(`${stable(await validatePlacement(PRODUCTION_ROOT, expectedParent))}\n`);
  else if (command === "cleanup") process.stdout.write(`${stable(await cleanupPlacement(PRODUCTION_ROOT, expectedParent))}\n`);
  else throw new Error("usage: video-retained-takeover-transport.mjs place|observe|cleanup");
}
