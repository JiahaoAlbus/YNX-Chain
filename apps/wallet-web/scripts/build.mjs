import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromiumManifest, firefoxManifest} from "../src/extension-manifest.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await rm(dist, {recursive: true, force: true});
await mkdir(join(dist, "pwa"), {recursive: true});
for (const file of ["index.html", "manifest.webmanifest", "sw.js", "styles.css", "accessibility.css", "app.js"]) await cp(join(root, "public", file), join(dist, "pwa", file));
for (const file of ["provider.js", "i18n.js"]) await cp(join(root, "src", file), join(dist, "pwa", file));
await cp(join(root, "src", "service-worker-policy.js"), join(dist, "pwa", "service-worker-policy.js"));
await cp(join(root, "public", "ynx-logo.png"), join(dist, "pwa", "ynx-logo.png"));

const variants = [
  ["chromium", chromiumManifest],
  ["firefox", firefoxManifest],
];
for (const [name, manifest] of variants) {
  const target = join(dist, name); await mkdir(target, {recursive: true});
  for (const file of ["index.html", "styles.css", "accessibility.css", "app.js"]) await cp(join(root, "public", file), join(target, file));
  for (const file of ["provider.js", "i18n.js"]) await cp(join(root, "src", file), join(target, file));
  for (const file of ["service-worker.js", "content-script.js", "page-provider.js"]) await cp(join(root, "extension", file), join(target, file));
  await cp(join(root, "src", "extension-bridge.js"), join(target, "extension-bridge.js"));
  await cp(join(root, "public", "ynx-logo.png"), join(target, "ynx-logo.png"));
  const html = (await readFile(join(target, "index.html"), "utf8")).replace('<link rel="manifest" href="./manifest.webmanifest">', "");
  await writeFile(join(target, "index.html"), html);
  await writeFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log("Built PWA plus unsigned Chromium (Chrome/Edge) and Firefox extension directories.");
