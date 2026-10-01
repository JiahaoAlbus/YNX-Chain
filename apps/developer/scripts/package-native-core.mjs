import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OPENVSCODE_X64 } from "../services/codeoss-service/src/upstream.mjs";
import { runtimeTreeDigest } from "../services/codeoss-service/src/derived-runtime.mjs";

const [archive, destination, license, notices, logo192] = process.argv.slice(2);
if (!archive || !destination || !license || !notices || !logo192) throw new Error("Usage: node scripts/package-native-core.mjs <official-x64.tar.gz> <NEW-output-directory> <LICENSE.txt> <ThirdPartyNotices.txt> <verified-ynx-icon-192.png>");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
for (const [path, expected] of [[archive, OPENVSCODE_X64.sha256], [license, OPENVSCODE_X64.licenseSha256], [notices, OPENVSCODE_X64.noticesSha256], [logo192, "37efed414f0cd67490f002d91c553adf875c6da6c207bc69b6a1fc1ea64dde9e"]])
  if (digest(await readFile(path)) !== expected) throw new Error("Artifact or brand provenance mismatch.");
const root = resolve(destination); await mkdir(root, { mode: 0o755 }); // refuse existing output
const extracted = spawnSync("tar", ["-xzf", resolve(archive), "--strip-components=1", "-C", root], { stdio: "inherit", shell: false });
if (extracted.status !== 0) throw new Error("Official artifact extraction failed.");
const productPath = join(root, "product.json"), product = JSON.parse(await readFile(productPath, "utf8"));
if (product.commit !== OPENVSCODE_X64.commit) throw new Error("Official product commit mismatch.");
product.nameShort = "YNX Developer"; product.nameLong = "YNX Developer";
await writeFile(productPath, JSON.stringify(product, null, 2) + "\n");
const server = join(root, "resources", "server"), logo = await readFile(logo192);
await writeFile(join(server, "code-192.png"), logo);
const brand = fileURLToPath(new URL("../native/ynx-brand/ynx-logo.png", import.meta.url));
await cp(brand, join(server, "code-512.png"));
const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header[6] = 192; header[7] = 192;
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(logo.length, 14); header.writeUInt32LE(22, 18);
await writeFile(join(server, "favicon.ico"), Buffer.concat([header, logo]));
const manifestPath = join(server, "manifest.json"), webManifest = JSON.parse(await readFile(manifestPath, "utf8"));
webManifest.name = "YNX Developer"; webManifest.short_name = "YNX Developer"; webManifest.theme_color = "#002FA7"; webManifest.background_color = "#FFFFFF";
await writeFile(manifestPath, JSON.stringify(webManifest, null, 2) + "\n");
await cp(license, join(root, "LICENSE.txt")); await cp(notices, join(root, "ThirdPartyNotices.txt"));
const manifest = { product: "YNX Developer", upstreamVersion: OPENVSCODE_X64.version, upstreamCommit: OPENVSCODE_X64.commit,
  upstreamArchiveSha256: OPENVSCODE_X64.sha256, license: "MIT", modifications: ["product names", "server icons/favicon/web manifest"], treeSha256: await runtimeTreeDigest(root) };
const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n"); await writeFile(join(root, "YNX-DERIVED-RUNTIME.json"), bytes, { flag: "wx" });
console.log(JSON.stringify({ path: root, manifestSha256: digest(bytes), treeSha256: manifest.treeSha256 }));
