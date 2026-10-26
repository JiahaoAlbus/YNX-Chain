import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const specification = JSON.parse(fs.readFileSync(path.join(here, "hardhat-zod4-compat.json"), "utf8"));
const maximumFileBytes = 8 * 1024 * 1024;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(`hardhat-zod4-compat: ${message}`); };
const identity = (s) => [s.dev, s.ino, s.mode, s.uid, s.gid, s.nlink, s.size, s.mtimeNs, s.ctimeNs];
const equalIdentity = (a, b) => identity(a).every((value, index) => value === identity(b)[index]);

function safePath(root, relative) {
  if (typeof relative !== "string" || relative.split("/").some((part) => !part || part === "." || part === "..")) fail("invalid fixed path");
  const parts = relative.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const s = fs.lstatSync(current, { bigint: true });
    if (s.isSymbolicLink() || (s.mode & 0o022n) !== 0n) fail("unsafe dependency path");
    if (s.uid !== BigInt(process.getuid())) fail("dependency owner mismatch");
    if (index < parts.length - 1 && !s.isDirectory()) fail("dependency parent is not a directory");
  }
  return current;
}

function readOriginal(root, relative) {
  const filename = safePath(root, relative);
  const before = fs.lstatSync(filename, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximumFileBytes)) fail("unsafe dependency file");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!equalIdentity(before, fs.fstatSync(fd, { bigint: true }))) fail("dependency changed before read");
    const raw = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < raw.length) {
      const count = fs.readSync(fd, raw, length, raw.length - length, length);
      if (count === 0) break;
      length += count;
    }
    if (length !== Number(before.size)) fail("dependency read length changed");
    if (!equalIdentity(before, fs.fstatSync(fd, { bigint: true })) || !equalIdentity(before, fs.lstatSync(filename, { bigint: true }))) fail("dependency changed during read");
    const value = raw.subarray(0, length);
    return { filename, relative, raw: value, stat: before, sha256: sha256(value) };
  } finally {
    fs.closeSync(fd);
  }
}

function unchanged(root, original) {
  const current = readOriginal(root, original.relative);
  if (!equalIdentity(current.stat, original.stat) || !current.raw.equals(original.raw)) fail("dependency changed after preflight");
}

function patchedBytes(original, patch) {
  let text = original.raw.toString("utf8");
  if (!Buffer.from(text).equals(original.raw)) fail("dependency is not UTF-8");
  for (const change of patch.replacements) {
    const pieces = text.split(change.before);
    if (pieces.length !== change.count + 1) fail("fixed patch does not match original");
    text = pieces.join(change.after);
  }
  const raw = Buffer.from(text);
  if (sha256(raw) !== patch.afterSHA256) fail("fixed patch output hash mismatch");
  return raw;
}

// This is a fixed dependency adaptation, not a generic patch runner. npm's
// normal install still verifies the official tarball integrities in the lock.
// All originals are checked before any mutation. A partial group is UNKNOWN:
// it is rejected, never completed or rolled back by a subsequent invocation.
export function applyHardhatZod4Compat(root = repository) {
  if (typeof process.getuid !== "function" || !path.isAbsolute(root) || path.resolve(root) !== fs.realpathSync(root)) fail("canonical POSIX project root required");
  const rootStat = fs.lstatSync(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== BigInt(process.getuid()) || (rootStat.mode & 0o022n) !== 0n) fail("unsafe project root");
  const packageJSON = readOriginal(root, "package.json");
  const lockOriginal = readOriginal(root, "package-lock.json");
  const declaration = JSON.parse(packageJSON.raw);
  const lock = JSON.parse(lockOriginal.raw);
  if (declaration.devDependencies?.hardhat !== "3.11.1" || declaration.devDependencies?.["@nomicfoundation/hardhat-ethers"] !== "4.0.15" || declaration.devDependencies?.zod !== "4.6.7" || declaration.overrides?.zod !== "$zod" || declaration.overrides?.["@nomicfoundation/hardhat-zod-utils"] !== "3.0.5") fail("project dependency contract mismatch");
  const originals = [packageJSON, lockOriginal];
  for (const pkg of specification.packages) {
    const prefix = `node_modules/${pkg.name}`;
    const original = readOriginal(root, `${prefix}/package.json`);
    const installed = JSON.parse(original.raw);
    const locked = lock.packages?.[prefix];
    if (original.sha256 !== pkg.packageJSONSHA256 || installed.name !== pkg.name || installed.version !== pkg.version || locked?.version !== pkg.version || locked?.integrity !== pkg.integrity || locked?.resolved !== pkg.tarball) fail(`fixed package identity mismatch: ${pkg.name}`);
    originals.push(original);
  }
  for (const entry of specification.originals) {
    const original = readOriginal(root, `node_modules/${entry.package}/${entry.path}`);
    if (original.sha256 !== entry.sha256) fail("unmodified upstream dependency hash mismatch");
    originals.push(original);
  }
  const plans = specification.patches.map((patch) => {
    const original = readOriginal(root, `node_modules/${patch.package}/${patch.path}`);
    if (original.sha256 !== patch.beforeSHA256 && original.sha256 !== patch.afterSHA256) fail("unknown or modified dependency patch");
    return { patch, original, applied: original.sha256 === patch.afterSHA256 };
  });
  const parents = new Set(plans.map(({ original }) => path.dirname(original.filename)));
  for (const parent of parents) {
    if (fs.readdirSync(parent).some((name) => name.startsWith(".ynx-zod4-compat-"))) fail("partial dependency patch retained");
  }
  const alreadyApplied = plans.every(({ applied }) => applied);
  if (!alreadyApplied && plans.some(({ applied }) => applied)) fail("partial dependency patch group");
  const report = { version: specification.version, classification: "compatibility-patch", status: alreadyApplied ? "already-applied" : "applied", packages: specification.packages.map(({ name, version }) => ({ name, version })), files: plans.map(({ patch }) => ({ package: patch.package, path: patch.path, sha256: patch.afterSHA256 })) };
  if (alreadyApplied) {
    for (const original of [...originals, ...plans.map(({ original }) => original)]) unchanged(root, original);
    return report;
  }
  for (const plan of plans) plan.output = patchedBytes(plan.original, plan.patch);
  for (const original of [...originals, ...plans.map(({ original }) => original)]) unchanged(root, original);
  // Leave any incomplete temporary files for diagnosis. Their presence blocks
  // re-entry; an install failure must not silently repair a mixed source tree.
  for (const plan of plans) {
    const temporary = path.join(path.dirname(plan.original.filename), `.ynx-zod4-compat-${process.pid}-${randomBytes(8).toString("hex")}`);
    const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, Number(plan.original.stat.mode & 0o777n));
    try {
      fs.writeFileSync(fd, plan.output);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    plan.temporary = temporary;
  }
  for (const plan of plans) {
    unchanged(root, plan.original);
    fs.renameSync(plan.temporary, plan.original.filename);
    const fd = fs.openSync(path.dirname(plan.original.filename), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (!readOriginal(root, plan.original.relative).raw.equals(plan.output)) fail("dependency patch readback mismatch");
  }
  for (const original of originals) unchanged(root, original);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) fail("no command arguments are accepted");
  process.stdout.write(`${JSON.stringify(applyHardhatZod4Compat())}\n`);
}
