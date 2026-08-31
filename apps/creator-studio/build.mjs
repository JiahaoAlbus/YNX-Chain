import {copyFile, mkdir, rm, stat, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const output = join(root, "dist");
const upstreamCatalog = Object.freeze({
  commit: "7a89550d4964ea38b854cbd03f18775494c2f513",
  path: "apps/video/i18n/catalog.json",
  blob: "ba01f2a1bed92537e30b0f4a0359e3927bd1deea",
  sha256: "4c86e3e1cdeac6d9c4570891d70bab4c3486c6a4429dd33fd1029f046ca9ecff",
});
const runtimeFiles = Object.freeze([
  "app.js",
  "enhancements.css",
  "i18n.js",
  "index.html",
  "server.mjs",
  "standard-wallet-connect-state.js",
  "styles.css",
  "wallet-auth.js",
  "wallet-callback.html",
  "assets/metamask.svg",
  "assets/ynx-logo.png",
  "assets/ynx-wallet.svg",
]);

function sourceCommit() {
  if (process.env.YNX_CREATOR_SOURCE_COMMIT) return process.env.YNX_CREATOR_SOURCE_COMMIT;
  return execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
}

function gitValue(args) {
  return execFileSync("git", args, {cwd: root, encoding: "utf8"}).trim();
}

async function digest(path) {
  const bytes = await (await import("node:fs/promises")).readFile(path);
  return {bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
}

await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
for (const file of runtimeFiles) {
  const source = join(root, file);
  if (!(await stat(source)).isFile()) throw new Error(`Required Creator Studio runtime file is missing: ${file}`);
  const target = join(output, file);
  await mkdir(dirname(target), {recursive: true});
  await copyFile(source, target);
}

const catalogRef = `${upstreamCatalog.commit}:${upstreamCatalog.path}`;
if (gitValue(["rev-parse", catalogRef]) !== upstreamCatalog.blob) {
  throw new Error("Creator Studio catalog upstream blob does not match the approved release input.");
}
const catalogTarget = join(output, "i18n/catalog.json");
await mkdir(dirname(catalogTarget), {recursive: true});
await writeFile(catalogTarget, execFileSync("git", ["show", catalogRef], {cwd: root}));
if ((await digest(catalogTarget)).sha256 !== upstreamCatalog.sha256) {
  throw new Error("Creator Studio catalog SHA-256 does not match the approved release input.");
}

const files = [];
const artifactFiles = [...runtimeFiles, "i18n/catalog.json"];
for (const file of artifactFiles.slice().sort()) files.push({path: file, ...(await digest(join(output, file)))});
const manifest = {
  schemaVersion: 1,
  product: "ynx-creator-studio",
  sourceCommit: sourceCommit(),
  sourceTree: gitValue(["rev-parse", "HEAD^{tree}"]),
  outputDirectory: "dist",
  upstreamCatalog,
  files,
};
await writeFile(join(output, "creator-studio.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Creator Studio release artifact written to ${relative(root, output)}/`);
