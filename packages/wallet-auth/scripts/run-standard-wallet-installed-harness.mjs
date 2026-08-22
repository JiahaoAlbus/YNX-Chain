#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "ynx-standard-wallet-installed-harness-"));
try {
  const packDirectory = join(temporary, "pack");
  const consumerDirectory = join(temporary, "consumer");
  await mkdir(packDirectory);
  await mkdir(consumerDirectory);
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", packDirectory], { cwd: packageRoot, encoding: "utf8" }))[0];
  const tarball = join(packDirectory, packed.filename);
  const bytes = await readFile(tarball);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(consumerDirectory, "package.json"), `${JSON.stringify({ private: true, type: "module", dependencies: { "@ynx-chain/wallet-auth": `file:${tarball}` } }, null, 2)}\n`);
  execFileSync("npm", ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"], { cwd: consumerDirectory, stdio: "pipe" });
  const harness = join(consumerDirectory, "installed-consumer.mjs");
  await cp(join(packageRoot, "harness", "installed-consumer.mjs"), harness);
  const output = execFileSync(process.execPath, [harness], { cwd: consumerDirectory, encoding: "utf8" });
  const result = JSON.parse(output);
  if (result.status !== "PASS" || result.packageImportedFromInstalledArtifact !== true) throw new Error("Installed Standard Wallet harness did not pass");
  process.stdout.write(`${JSON.stringify({ ...result, package: { name: packed.name, version: packed.version, sha256, bytes: bytes.length, entries: packed.entryCount } })}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
