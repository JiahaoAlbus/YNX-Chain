import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await rm(dist, {recursive: true, force: true});
await mkdir(join(dist, "pwa"), {recursive: true});
for (const file of ["index.html", "manifest.webmanifest", "sw.js", "styles.css", "app.js"]) await cp(join(root, "public", file), join(dist, "pwa", file));
for (const file of ["provider.js", "i18n.js"]) await cp(join(root, "src", file), join(dist, "pwa", file));
await cp(join(root, "public", "ynx-logo.png"), join(dist, "pwa", "ynx-logo.png"));

const variants = [
  ["chromium", {manifest_version:3,name:"YNX Wallet Testnet Companion",version:"0.1.0",description:"Run fail-closed YNX Testnet wallet actions against the active DApp tab.",permissions:["activeTab","scripting","storage"],background:{service_worker:"service-worker.js",type:"module"},action:{default_popup:"index.html",default_title:"YNX Wallet"},icons:{"128":"ynx-logo.png"}}],
  ["firefox", {manifest_version:3,name:"YNX Wallet Testnet Companion",version:"0.1.0",description:"Run fail-closed YNX Testnet wallet actions against the active DApp tab.",permissions:["activeTab","scripting","storage"],background:{scripts:["service-worker.js"],type:"module"},action:{default_popup:"index.html",default_title:"YNX Wallet"},icons:{"128":"ynx-logo.png"},browser_specific_settings:{gecko:{id:"wallet-testnet@ynxweb4.com",strict_min_version:"128.0"}}}],
];
for (const [name, manifest] of variants) {
  const target = join(dist, name); await mkdir(target, {recursive: true});
  for (const file of ["index.html", "styles.css", "app.js"]) await cp(join(root, "public", file), join(target, file));
  for (const file of ["provider.js", "i18n.js"]) await cp(join(root, "src", file), join(target, file));
  await cp(join(root, "extension", "service-worker.js"), join(target, "service-worker.js"));
  await cp(join(root, "public", "ynx-logo.png"), join(target, "ynx-logo.png"));
  const html = (await readFile(join(target, "index.html"), "utf8")).replace('<link rel="manifest" href="./manifest.webmanifest">', "");
  await writeFile(join(target, "index.html"), html);
  await writeFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log("Built PWA plus unsigned Chromium (Chrome/Edge) and Firefox extension directories.");
