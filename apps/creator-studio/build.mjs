import {copyFile, mkdir, readdir, rm, stat, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const output = join(root, "dist");
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
  "assets/ynx-wallet.svg",
]);

function sourceCommit() {
  if (process.env.YNX_CREATOR_SOURCE_COMMIT) return process.env.YNX_CREATOR_SOURCE_COMMIT;
  return execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
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

const files = [];
for (const file of runtimeFiles.slice().sort()) files.push({path: file, ...(await digest(join(output, file)))});
const manifest = {
  schemaVersion: 1,
  product: "ynx-creator-studio",
  sourceCommit: sourceCommit(),
  outputDirectory: "dist",
  files,
};
await writeFile(join(output, "creator-studio.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Creator Studio release artifact written to ${relative(root, output)}/`);
