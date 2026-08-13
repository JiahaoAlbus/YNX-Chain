import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import "./build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist"), artifacts = join(root, "artifacts");
execFileSync(process.execPath, ["--test", "test/i18n.test.js", "test/provider.test.js"], {cwd:root, stdio:"inherit"});
await mkdir(artifacts, {recursive: true});
const entries = [
  ["ynx-wallet-web-pwa-0.1.0.zip", "pwa", "modern browser with Service Worker support", "unsigned-web-bundle", ["PWA"]],
  ["ynx-wallet-chrome-edge-0.1.0.zip", "chromium", "Chrome 120 / Edge 120", "unsigned-unpacked-extension", ["Chrome", "Edge"]],
  ["ynx-wallet-firefox-0.1.0.zip", "firefox", "Firefox 128", "unsigned-unpacked-extension", ["Firefox"]],
];
const records = [];
for (const [name, folder, minimumOS, signingClass, browsers] of entries) {
  const output = join(artifacts, name);
  execFileSync("zip", ["-X", "-q", "-r", output, "."], {cwd: join(dist, folder)});
  const data = await readFile(output); const info = await stat(output);
  records.push({name, path:`artifacts/${name}`, bytes:info.size, sha256:createHash("sha256").update(data).digest("hex"), minimumOS, signingClass, browsers, installedLocal:false, productionSigned:false, storeReleased:false});
}
const manifest = {schemaVersion:1,productId:"wallet-web",version:"0.1.0-testnet-preview.1",sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT || "uncommitted-source-tree",implementedLocal:true,testedLocal:true,installedLocal:false,integratedCentral:false,deployedStaging:false,deployedPublic:false,downloadHosted:false,productionSigned:false,storeReleased:false,artifacts:records};
await writeFile(join(root, "artifact-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
