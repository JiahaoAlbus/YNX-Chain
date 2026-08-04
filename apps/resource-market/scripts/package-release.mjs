#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const root = path.resolve(appDir, "../..");
const artifactRoot = path.resolve(root, "release/resource-market-artifacts");
const outDir = path.resolve(root, process.argv[2] || "release/resource-market-artifacts/candidate");

function assertSafeOutputDirectory(candidate) {
  const relative = path.relative(artifactRoot, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`output must be a child of ${artifactRoot}`);
  }
  let current = artifactRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`output path must not contain symlinks: ${current}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

assertSafeOutputDirectory(outDir);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: options.encoding === false ? undefined : "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

const productRelease = JSON.parse(fs.readFileSync(path.join(appDir, "product-release.json"), "utf8"));
const sourceCommit = run("git", ["rev-parse", "HEAD"]).trim();
const sourceCommittedAt = run("git", ["show", "-s", "--format=%cI", "HEAD"]).trim();
const sourceBranch = process.env.GITHUB_REF_NAME || run("git", ["branch", "--show-current"]).trim();
const workflowRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : null;
const workflowSha = process.env.GITHUB_SHA || sourceCommit;
if (workflowSha !== sourceCommit) {
  throw new Error(`workflow SHA ${workflowSha} does not match checked-out source ${sourceCommit}`);
}
const goVersion = run("go", ["version"]).trim();
const nodeVersion = process.version;
const npmVersion = run("npm", ["--version"]).trim();

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { goos: "linux", goarch: "amd64" },
  { goos: "linux", goarch: "arm64" },
  { goos: "darwin", goarch: "arm64" },
];

const binaries = [];
for (const target of targets) {
  const name = `ynx-resource-market-${target.goos}-${target.goarch}`;
  const output = path.join(outDir, name);
  run(
    "go",
    ["build", "-trimpath", "-buildvcs=true", "-o", output, "./apps/resource-market"],
    {
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: target.goos,
        GOARCH: target.goarch,
      },
    },
  );
  const metadataPath = `${output}.build-metadata.txt`;
  const buildMetadata = run("go", ["version", "-m", output]).replace(
    output,
    path.basename(output),
  );
  fs.writeFileSync(metadataPath, buildMetadata);
  binaries.push({
    file: path.basename(output),
    goos: target.goos,
    goarch: target.goarch,
    bytes: fs.statSync(output).size,
    sha256: sha256(output),
    buildMetadata: path.basename(metadataPath),
  });
}

fs.writeFileSync(
  path.join(outDir, "go-dependencies.json"),
  run("go", ["list", "-m", "-json", "all"]),
);
const npmSbom = JSON.parse(
  run("npm", ["sbom", "--sbom-format", "spdx"], { cwd: appDir }),
);
npmSbom.documentNamespace = `https://ynxweb4.com/spdx/resource-market/${encodeURIComponent(
  npmSbom.name,
)}/${sourceCommit}`;
npmSbom.creationInfo.created = new Date(sourceCommittedAt).toISOString();
fs.writeFileSync(
  path.join(outDir, "npm-sbom.spdx.json"),
  `${JSON.stringify(npmSbom, null, 2)}\n`,
);

for (const relativePath of [
  "RELEASE_NOTES.md",
  "THIRD_PARTY_NOTICES.md",
  "operator-inputs.request.json",
]) {
  fs.copyFileSync(path.join(appDir, relativePath), path.join(outDir, relativePath));
}
const packagedProductRelease = {
  ...productRelease,
  runtimeTestedSourceCommit: productRelease.sourceCommit,
  sourceCommit,
  candidateSourceCommit: sourceCommit,
  workingTreeDirty: false,
  generatedAt: sourceCommittedAt,
};
fs.writeFileSync(
  path.join(outDir, "product-release.json"),
  `${JSON.stringify(packagedProductRelease, null, 2)}\n`,
);
const publicProductMetadata = JSON.parse(
  fs.readFileSync(path.join(appDir, "public-product-metadata.json"), "utf8"),
);
fs.writeFileSync(
  path.join(outDir, "public-product-metadata.json"),
  `${JSON.stringify(
    {
      ...publicProductMetadata,
      runtimeTestedSourceCommit: publicProductMetadata.sourceCommit,
      sourceCommit,
    },
    null,
    2,
  )}\n`,
);
fs.copyFileSync(
  path.join(root, "release/integration/resource-market-contract.json"),
  path.join(outDir, "resource-market-contract.json"),
);
fs.copyFileSync(
  path.join(root, "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json"),
  path.join(outDir, "CROSS_PRODUCT_TEST_VECTORS.json"),
);

const provenance = {
  schemaVersion: "1.0",
  productNumber: "16",
  productId: productRelease.productId,
  productName: productRelease.name,
  version: productRelease.version,
  releaseClass: "unsigned-testnet-candidate",
  sourceRepository: "https://github.com/JiahaoAlbus/YNX-Chain",
  sourceCommit,
  sourceCommittedAt,
  branch: sourceBranch,
  buildEnvironment: {
    goVersion,
    nodeVersion,
    npmVersion,
    cgoEnabled: false,
  },
  buildEntrypoint: "node apps/resource-market/scripts/package-release.mjs",
  binaries,
  evidence: {
    packageWorkflowRun: workflowRunId,
    packageWorkflowSha: workflowSha,
    historicalPullRequest: 12,
    historicalTestedSource: "d683c7d28ce129daad358c84680e5980cf8ad069",
    historicalCandidateGateRun: 30417957999,
    historicalMergeCommit: "82241913b4dacf6bb6adebb537b7fa175c3aff59",
  },
  boundaries: {
    signed: false,
    hostedBeforePublication: false,
    authoritativeSettlementVerified: false,
    publicDeploymentVerified: false,
    productionApproved: false,
  },
  generatedAt: sourceCommittedAt,
};
fs.writeFileSync(path.join(outDir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);

const files = fs
  .readdirSync(outDir)
  .filter((name) => name !== "SHA256SUMS")
  .sort();
const checksums = files.map((name) => `${sha256(path.join(outDir, name))}  ${name}`);
fs.writeFileSync(path.join(outDir, "SHA256SUMS"), `${checksums.join("\n")}\n`);

console.log(
  JSON.stringify(
    {
      outDir,
      sourceCommit,
      version: productRelease.version,
      files: [...files, "SHA256SUMS"],
    },
    null,
    2,
  ),
);
