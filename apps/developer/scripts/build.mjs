import { access, cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const client = fileURLToPath(new URL("../../../packages/developer-client/src/", import.meta.url));
const brandLogo = fileURLToPath(new URL("../../../assets/brand/ynx-logo.png", import.meta.url));
const monacoCandidates = [
  fileURLToPath(new URL("../../../node_modules/monaco-editor/min/vs/", import.meta.url)),
  fileURLToPath(new URL("../node_modules/monaco-editor/min/vs/", import.meta.url)),
];
const monaco = await firstReadableDirectory(monacoCandidates);
await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/client`, { recursive: true });
for (const file of ["index.html", "styles.css", "app.js", "manifest.webmanifest", "icon.svg"]) await cp(`${root}/${file}`, `${dist}/${file}`);
await cp(brandLogo, `${dist}/ynx-logo.png`);
await cp(client, `${dist}/client`, { recursive: true });
await mkdir(`${dist}/monaco`, { recursive: true });
await cp(monaco, `${dist}/monaco/vs`, { recursive: true });
console.log("Built standalone Web Product to apps/developer/dist (not a signed desktop release).");

async function firstReadableDirectory(candidates) {
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch {}
  }
  throw new Error(`The reviewed Monaco asset directory is unavailable. Checked: ${candidates.join(", ")}`);
}
