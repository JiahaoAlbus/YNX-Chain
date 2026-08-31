import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const self = fileURLToPath(import.meta.url);
const targets = ["src", "public", "scripts", "index.html", "package.json"];
const forbidden = [
  "127.0.0.1:38091",
  "install-staging-routes.py",
  "web4-music.caddy",
];

async function files(target) {
  const absolute = path.join(root, target);
  const entry = await readdir(absolute, { withFileTypes: true }).catch(() => []);
  if (Array.isArray(entry) && entry.length && entry[0].isDirectory !== undefined) {
    return (await Promise.all(entry.map(async (item) => item.isDirectory()
      ? files(path.join(target, item.name))
      : [path.join(root, target, item.name)]))).flat();
  }
  return [absolute];
}

const candidates = (await Promise.all(targets.map(files))).flat();
const violations = [];
for (const candidate of candidates) {
  if (candidate === self) continue;
  const body = await readFile(candidate, "utf8").catch(() => "");
  for (const value of forbidden) {
    if (body.includes(value)) violations.push(`${path.relative(root, candidate)} contains ${value}`);
  }
}
if (violations.length) throw new Error(`legacy route quarantine failed:\n${violations.join("\n")}`);
console.log("DEX executable source has no legacy Shop/Music 38091 route reference.");
