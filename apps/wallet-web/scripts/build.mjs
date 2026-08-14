import {createHash} from "node:crypto";
import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromiumManifest, firefoxManifest} from "../src/extension-manifest.js";
import {deriveCoreWalletAuthBinding} from "../src/core-auth-consumer.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const coreRegistry=JSON.parse(await readFile(resolve(root,"..","..","packages","wallet-auth","central-registry.json"),"utf8"));
const coreAuthBinding=deriveCoreWalletAuthBinding(coreRegistry);
await rm(dist, {recursive: true, force: true});
await mkdir(join(dist, "pwa"), {recursive: true});
for (const file of ["index.html", "manifest.webmanifest", "sw.js", "styles.css", "accessibility.css", "app.js"]) await cp(join(root, "public", file), join(dist, "pwa", file));
for (const file of ["provider.js", "i18n.js", "preferences.js"]) await cp(join(root, "src", file), join(dist, "pwa", file));
await cp(join(root, "src", "service-worker-policy.js"), join(dist, "pwa", "service-worker-policy.js"));
await cp(join(root, "public", "ynx-logo.png"), join(dist, "pwa", "ynx-logo.png"));
const pwaIntegrityFiles=["index.html","styles.css","accessibility.css","app.js","provider.js","i18n.js","preferences.js","service-worker-policy.js","ynx-logo.png","manifest.webmanifest"],assetIntegrity={};
for(const file of pwaIntegrityFiles)assetIntegrity[`./${file}`]=createHash("sha256").update(await readFile(join(dist,"pwa",file))).digest("hex");
assetIntegrity["./"]=assetIntegrity["./index.html"];
await writeFile(join(dist,"pwa","asset-integrity.js"),`export const ASSET_INTEGRITY=Object.freeze(${JSON.stringify(assetIntegrity)});\n`);

const variants = [
  ["chromium", chromiumManifest],
  ["firefox", firefoxManifest],
];
for (const [name, manifest] of variants) {
  const target = join(dist, name); await mkdir(target, {recursive: true});
  for (const file of ["index.html", "styles.css", "accessibility.css", "app.js"]) await cp(join(root, "public", file), join(target, file));
  for (const file of ["provider.js", "i18n.js", "preferences.js"]) await cp(join(root, "src", file), join(target, file));
  for (const file of ["service-worker.js", "content-script.js", "page-provider.js"]) await cp(join(root, "extension", file), join(target, file));
  await cp(join(root, "src", "extension-bridge.js"), join(target, "extension-bridge.js"));
  await cp(join(root, "src", "extension-rpc.js"), join(target, "extension-rpc.js"));
  await cp(join(root, "src", "core-auth-consumer.js"), join(target, "core-auth-consumer.js"));
  await cp(join(root, "src", "extension-sensitive-policy.js"), join(target, "extension-sensitive-policy.js"));
  await cp(join(root, "src", "active-tab-policy.js"), join(target, "active-tab-policy.js"));
  await writeFile(join(target,"core-auth-binding.js"),`export const CORE_WALLET_AUTH_BINDING=Object.freeze(${JSON.stringify(coreAuthBinding)});\n`);
  await cp(join(root, "public", "ynx-logo.png"), join(target, "ynx-logo.png"));
  const html = (await readFile(join(target, "index.html"), "utf8")).replace('<link rel="manifest" href="./manifest.webmanifest">', "");
  await writeFile(join(target, "index.html"), html);
  await writeFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log("Built PWA plus unsigned Chromium (Chrome/Edge) and Firefox extension directories.");
