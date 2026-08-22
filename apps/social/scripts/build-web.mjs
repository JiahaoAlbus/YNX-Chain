import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(appRoot, "web");
const outputRoot = join(appRoot, "dist", "social-web");
const files = [
  "index.html",
  "app.js",
  "styles.css",
  "wallet-provider.js",
  "assets/metamask.svg",
  "assets/ynx-wallet.svg",
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const manifest = [];
for (const relativePath of files) {
  const sourcePath = join(sourceRoot, relativePath);
  const outputPath = join(outputRoot, relativePath);
  await mkdir(dirname(outputPath), { recursive: true });
  await cp(sourcePath, outputPath, { force: true });

  const bytes = await readFile(outputPath);
  const metadata = await stat(outputPath);
  manifest.push({
    path: relativePath,
    bytes: metadata.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

process.stdout.write(`${JSON.stringify({ outputDirectory: "dist/social-web", files: manifest }, null, 2)}\n`);
