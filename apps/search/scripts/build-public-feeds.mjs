import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTITY_REGISTRY } from "../src/entities.js";
import { buildPublicFeeds } from "../src/public-feeds.js";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(appRoot, "../..");
const outputDirectory = resolve(repositoryRoot, "release/public/search");
const metadata = JSON.parse(await readFile(resolve(repositoryRoot, "public-product-metadata.json"), "utf8"));
const release = JSON.parse(await readFile(resolve(repositoryRoot, "product-release.json"), "utf8"));
const files = buildPublicFeeds({ metadata, release, entityRegistry: ENTITY_REGISTRY });

await mkdir(outputDirectory, { recursive: true });
for (const [name, contents] of Object.entries(files)) {
  const path = resolve(outputDirectory, name);
  if (dirname(path) !== outputDirectory) throw new Error("public feed path escaped output directory");
  await writeFile(path, contents, { mode: 0o644 });
}
console.log(`wrote ${Object.keys(files).length} deterministic public Search feed files to release/public/search`);
