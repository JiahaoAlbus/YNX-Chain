import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const inside = (root, target) => { const p = path.relative(root, target); return p === "" || (!p.startsWith(`..${path.sep}`) && p !== ".." && !path.isAbsolute(p)); };

function expectedRecords(records, linksAllowed) {
  if (!Array.isArray(records) || records.length === 0) throw new Error("Empty or invalid frozen inventory");
  const seen = new Set();
  return records.map(record => {
    const p = record.path;
    if (typeof p !== "string" || !p || p.includes("\\") || p.includes("\0") || path.posix.normalize(p) !== p || path.isAbsolute(p) || p.startsWith("/") || p === ".." || p.startsWith("../") || seen.has(p) || (!linksAllowed && (p === "node_modules" || p.startsWith("node_modules/")))) throw new Error("Invalid or duplicate inventory path");
    seen.add(p);
    const kind = record.kind ?? "file";
    if (kind === "link" && linksAllowed && typeof record.target === "string" && !path.isAbsolute(record.target)) return { path: p, kind, target: record.target };
    if (kind !== "file" || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error("Invalid frozen file record");
    return { path: p, kind, bytes: record.bytes, sha256: record.sha256 };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export async function inventoryContainedTree(directory, linksAllowed = true) {
  const root = await realpath(directory), records = [];
  async function walk(relative = "") {
    for (const name of await readdir(path.join(root, relative))) {
      const p = relative ? `${relative}/${name}` : name, file = path.join(root, p), stat = await lstat(file);
      if (stat.isDirectory()) await walk(p);
      else if (stat.isSymbolicLink()) {
        const target = await readlink(file);
        if (!linksAllowed || path.isAbsolute(target) || !inside(root, await realpath(file))) throw new Error(`External or forbidden link: ${p}`);
        records.push({ path: p, kind: "link", target });
      } else if (stat.isFile()) {
        const bytes = await readFile(file);
        records.push({ path: p, kind: "file", bytes: bytes.length, sha256: digest(bytes) });
      } else throw new Error(`Unsupported filesystem object: ${p}`);
    }
  }
  await walk();
  return records.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function exact(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} differs from frozen inventory`);
}

// This prepares a new package only. It neither activates a Host/provider nor
// replaces the application's SDK link. The release owner selects the resulting
// package in an isolated build and still runs packaged-source verification.
export async function stageContainedSdk({ packageDirectory, softwareDirectory, manifestPath, manifestSha256, outputParent }) {
  if (!/^[a-f0-9]{64}$/.test(manifestSha256 ?? "")) throw new Error("Explicit frozen manifest SHA256 required");
  const manifestBytes = await readFile(manifestPath);
  if (digest(manifestBytes) !== manifestSha256) throw new Error("Frozen manifest SHA256 mismatch");
  const manifest = JSON.parse(manifestBytes);
  const sources = expectedRecords(manifest.sources, false), software = expectedRecords(manifest.software, true);
  const sourceRoot = await realpath(packageDirectory), softwareRoot = await realpath(softwareDirectory), parent = await realpath(outputParent);
  // Canonical roots prevent /tmp versus /private/tmp false escape reports.
  if (inside(sourceRoot, parent) || inside(softwareRoot, parent) || inside(sourceRoot, softwareRoot) || inside(softwareRoot, sourceRoot)) throw new Error("Input and output trees must not overlap");
  exact(await inventoryContainedTree(sourceRoot, false), sources, "SDK source");
  exact(await inventoryContainedTree(softwareRoot), software, "SDK locked software");
  const metadata = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  if (metadata.name !== "@ynx-chain/wallet-auth") throw new Error("Not the Wallet SDK package");
  const stage = await mkdtemp(path.join(parent, "ynx-contained-sdk-")), output = path.join(stage, "wallet-auth");
  await mkdir(output);
  async function copy(root, destination, records) {
    for (const record of records) {
      const input = path.join(root, record.path), target = path.join(destination, record.path);
      await mkdir(path.dirname(target), { recursive: true });
      if (record.kind === "link") {
        if (await readlink(input) !== record.target || !inside(root, await realpath(input))) throw new Error(`Input link changed: ${record.path}`);
        await symlink(record.target, target);
      } else {
        const stat = await lstat(input);
        if (!stat.isFile()) throw new Error(`Input file changed: ${record.path}`);
        const bytes = await readFile(input);
        if (bytes.length !== record.bytes || digest(bytes) !== record.sha256) throw new Error(`Input bytes changed: ${record.path}`);
        await writeFile(target, bytes, { flag: "wx", mode: stat.mode & 0o777 });
        await chmod(target, stat.mode & 0o777);
      }
    }
  }
  try {
    await copy(sourceRoot, output, sources);
    exact(await inventoryContainedTree(output, false), sources, "Staged SDK source");
    const nested = path.join(output, "node_modules"); await mkdir(nested);
    await copy(softwareRoot, nested, software);
    exact(await inventoryContainedTree(nested), software, "Staged SDK software");
    // Recheck both originals after copying: a changed input is not success.
    exact(await inventoryContainedTree(sourceRoot, false), sources, "SDK source after copy");
    exact(await inventoryContainedTree(softwareRoot), software, "SDK software after copy");
    const receipt = { kind: "CONTAINED_SDK_STAGE", packageDirectory: output, manifestSha256, sourceFiles: sources.length, softwareRecords: software.length, byteExact: true, originalInputsRechecked: true, applicationLinkChanged: false, sdkEvaluated: false, buildOrReleaseVerified: false };
    await writeFile(path.join(stage, "stage-receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    return receipt;
  } catch (error) {
    throw new Error(`Staging failed; preserved partial at ${stage}: ${error.message}`, { cause: error });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [packageDirectory, softwareDirectory, manifestPath, manifestSha256, outputParent, ...extra] = process.argv.slice(2);
  if (!outputParent || extra.length) throw new Error("Usage: node scripts/stage-contained-sdk.mjs PACKAGE_DIR LOCKED_NODE_MODULES MANIFEST_JSON MANIFEST_SHA256 EXISTING_OUTPUT_PARENT");
  console.log(JSON.stringify(await stageContainedSdk({ packageDirectory, softwareDirectory, manifestPath, manifestSha256, outputParent }), null, 2));
}
