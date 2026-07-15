import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const client = fileURLToPath(new URL("../../../packages/developer-client/src/", import.meta.url));
await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/client`, { recursive: true });
for (const file of ["index.html", "styles.css", "app.js", "manifest.webmanifest", "icon.svg"]) await cp(`${root}/${file}`, `${dist}/${file}`);
await cp(client, `${dist}/client`, { recursive: true });
console.log("Built standalone Web Product to apps/developer/dist (not a signed desktop release).");
