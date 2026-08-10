import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTITY_REGISTRY } from "../src/entities.js";
import { buildPublicFeeds } from "../src/public-feeds.js";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(appRoot, "../..");
const outputDirectory = resolve(repositoryRoot, "release/public/search");
const metadata = JSON.parse(await readFile(resolve(repositoryRoot, "release/search/public-product-metadata.json"), "utf8"));
const release = JSON.parse(await readFile(resolve(appRoot, "product-release.json"), "utf8"));
const expected = buildPublicFeeds({ metadata, release, entityRegistry: ENTITY_REGISTRY });

for (const [name, contents] of Object.entries(expected)) {
  const actual = await readFile(resolve(outputDirectory, name), "utf8");
  if (actual !== contents) throw new Error(`${name} is stale; run npm run feeds`);
}
console.log(`verified ${Object.keys(expected).length} deterministic public Search feed files`);
