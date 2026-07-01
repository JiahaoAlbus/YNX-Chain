import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [packageName, outDir, ...inputs] = process.argv.slice(2);
if (!packageName || !outDir || inputs.length === 0) {
  console.error("usage: node scripts/package/build-package.mjs <package-name> <out-dir> <input...>");
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const copied = [];
for (const input of inputs) {
  if (!fs.existsSync(input)) throw new Error(`missing package input: ${input}`);
  const stat = fs.statSync(input);
  if (stat.isDirectory()) {
    for (const file of walk(input)) copyFile(file);
  } else {
    copyFile(input);
  }
}

const generatedAt = new Date().toISOString();
const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const files = copied.sort((a, b) => a.file.localeCompare(b.file)).map((entry) => {
  const body = fs.readFileSync(path.join(outDir, entry.file));
  return {
    file: entry.file,
    source: entry.source,
    bytes: body.length,
    sha256: crypto.createHash("sha256").update(body).digest("hex")
  };
});

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({
  package: packageName,
  generatedAt,
  gitCommit,
  status: packageStatus(packageName),
  files
}, null, 2) + "\n");

for (const file of walk(outDir)) {
  console.log(file);
}
console.log(`${packageName} generated ${outDir}`);

function copyFile(source) {
  const relative = source.replace(/^\.\//, "");
  const target = path.join(outDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied.push({ file: relative, source });
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function packageStatus(name) {
  if (name.includes("public-proof")) return "local-proof-ready; public endpoint evidence required after real deployment";
  if (name.includes("mainnet")) return "readiness-draft; mainnet not launched";
  if (name.includes("chainlist")) return "draft-ready; public URLs and proof hashes required before submission";
  return "review-ready with local verification evidence; public deployment proof required for final submission";
}
