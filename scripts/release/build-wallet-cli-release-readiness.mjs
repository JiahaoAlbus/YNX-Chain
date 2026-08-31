import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const output = path.resolve(root, process.argv[2] ?? "release/wallet-cli/readiness");
const manifestPath = path.join(root, "release/wallet-cli/artifacts/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const sourceCommit = "68b68bbcbc7a301c113db82a2183537191976ff0";
assert.equal(manifest.sourceCommit, sourceCommit);
assert.equal(manifest.artifacts.length, 6);

const sha256 = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
const artifacts = manifest.artifacts.map(entry => {
  const absolute = path.join(root, entry.path);
  const bytes = fs.readFileSync(absolute);
  assert.equal(bytes.length, entry.bytes, `${entry.artifactId} byte mismatch`);
  assert.equal(sha256(bytes), entry.sha256, `${entry.artifactId} SHA mismatch`);
  return {...entry, filename: path.basename(entry.path)};
}).sort((a, b) => a.artifactId.localeCompare(b.artifactId));

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-wallet-cli-sbom-"));
let goVersion;
try {
  const sample = artifacts.find(entry => entry.target.goos === "linux" && entry.target.goarch === "amd64");
  const binary = path.join(temporary, "ynx-wallet-cli");
  fs.writeFileSync(binary, zlib.gunzipSync(fs.readFileSync(path.join(root, sample.path))));
  const buildInfo = execFileSync("go", ["version", "-m", binary], {encoding: "utf8"});
  goVersion = buildInfo.match(/^.*:\s+(go\d+\.\d+\.\d+)$/m)?.[1];
  assert.match(goVersion ?? "", /^go\d+\.\d+\.\d+$/);
  assert.match(buildInfo, /\n\s+path\s+github\.com\/JiahaoAlbus\/YNX-Chain\/cmd\/ynx-wallet-cli\n/);
  assert.doesNotMatch(buildInfo, /\n\s+dep\s+/);
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}

fs.mkdirSync(output, {recursive: true});
const writeJSON = (filename, value) => fs.writeFileSync(path.join(output, filename), `${JSON.stringify(value, null, 2)}\n`);
fs.writeFileSync(path.join(output, "SHA256SUMS"), `${artifacts.map(entry => `${entry.sha256}  ${entry.filename}`).join("\n")}\n`);

const downloadManifest = {
  schemaVersion: 1,
  manifestClass: "deterministic-wallet-cli-download-candidates",
  sourceCommit,
  sourceTree: "79274e02ed14e316851d512db3e14da68fe5620e",
  artifactManifest: "release/wallet-cli/artifacts/manifest.json",
  installDocumentation: "release/wallet-cli/readiness/INSTALL.md",
  artifacts: artifacts.map(entry => ({
    artifactId: entry.artifactId,
    filename: entry.filename,
    format: entry.format,
    os: entry.target.goos,
    architecture: entry.target.goarch,
    bytes: entry.bytes,
    sha256: entry.sha256,
    binaryBytes: entry.binaryBytes,
    binarySha256: entry.binarySha256,
    minimumOS: entry.minimumOS,
    signingClass: entry.signingClass,
    productionSigned: false,
    proposedContentAddressedPath: `/wallet/cli/sha256-${entry.sha256}/${entry.filename}`,
    officialDownloadURL: null,
    downloadHosted: false,
    deployedPublic: false
  })),
  behavior: {
    nativeChainId: "ynx_6423-1",
    chainId: 6423,
    evmChainId: "0x1917",
    nativeCurrency: "YNXT",
    offlineValidationCommand: "ynx-wallet-cli validate-config",
    legacyRejectionCommand: "ynx-wallet-cli chain-status --chain-id 9102",
    legacyExitCode: 78,
    legacyErrorCode: "WRONG_CHAIN",
    remoteProbeRequiredForInstall: false
  },
  releaseState: {productionSigned: false, notarized: false, downloadHosted: false, deployedPublic: false, storeReleased: false}
};
writeJSON("download-manifest.json", downloadManifest);

const artifactFiles = artifacts.map((entry, index) => ({
  fileName: entry.filename,
  SPDXID: `SPDXRef-File-${index + 1}`,
  checksums: [{algorithm: "SHA256", checksumValue: entry.sha256}],
  fileTypes: ["BINARY"],
  copyrightText: "NOASSERTION",
  comment: `${entry.target.goos}/${entry.target.goarch}; ${entry.minimumOS}; ${entry.signingClass}; ${entry.bytes} bytes`
}));
const sbom = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `YNX-Wallet-CLI-${sourceCommit.slice(0, 12)}`,
  documentNamespace: `https://ynxweb4.com/spdx/wallet-cli/${sourceCommit}`,
  creationInfo: {created: "2026-08-31T09:51:40Z", creators: ["Organization: YNX Chain", "Tool: build-wallet-cli-release-readiness.mjs"]},
  documentDescribes: ["SPDXRef-Package-YNX-Wallet-CLI"],
  packages: [
    {name: "YNX Wallet CLI", SPDXID: "SPDXRef-Package-YNX-Wallet-CLI", versionInfo: sourceCommit, downloadLocation: "NOASSERTION", filesAnalyzed: true, licenseConcluded: "NOASSERTION", licenseDeclared: "NOASSERTION", copyrightText: "NOASSERTION", externalRefs: [{referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: `pkg:golang/github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-wallet-cli@${sourceCommit}`}]},
    {name: "Go standard library", SPDXID: "SPDXRef-Package-Go-Stdlib", versionInfo: goVersion, downloadLocation: "https://go.dev/dl/", filesAnalyzed: false, licenseConcluded: "BSD-3-Clause", licenseDeclared: "BSD-3-Clause", copyrightText: "NOASSERTION", externalRefs: [{referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: `pkg:golang/stdlib@${goVersion.slice(2)}`}]}
  ],
  files: artifactFiles,
  relationships: [
    {spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: "SPDXRef-Package-YNX-Wallet-CLI"},
    {spdxElementId: "SPDXRef-Package-YNX-Wallet-CLI", relationshipType: "DEPENDS_ON", relatedSpdxElement: "SPDXRef-Package-Go-Stdlib"},
    ...artifactFiles.map(file => ({spdxElementId: "SPDXRef-Package-YNX-Wallet-CLI", relationshipType: "CONTAINS", relatedSpdxElement: file.SPDXID}))
  ]
};
writeJSON("sbom.spdx.json", sbom);

const installation = `# YNX Wallet CLI testnet candidates\n\nSource identity: \`${sourceCommit}\`\n\nThese are engineering candidates for YNX Testnet 6423. They are not production-signed, notarized, hosted, or store-released. Verify the matching SHA-256 in \`SHA256SUMS\` before extraction.\n\n## macOS 12+\n\nSelect \`darwin-arm64\` for Apple silicon or \`darwin-amd64\` for Intel. The arm64 binary is ad-hoc linker signed; the amd64 binary is unsigned.\n\n\`\`\`sh\ngzip -dc ynx-wallet-cli-darwin-<arch>.gz > ynx-wallet-cli\nchmod 0755 ynx-wallet-cli\n./ynx-wallet-cli version\n./ynx-wallet-cli validate-config\n\`\`\`\n\nUninstall with \`rm ./ynx-wallet-cli\` and confirm the selected install directory is empty.\n\n## Linux kernel 3.2+\n\nSelect \`linux-arm64\` or \`linux-amd64\`. Both binaries are unsigned.\n\n\`\`\`sh\ngzip -dc ynx-wallet-cli-linux-<arch>.gz > ynx-wallet-cli\nchmod 0755 ynx-wallet-cli\n./ynx-wallet-cli version\n./ynx-wallet-cli validate-config\n\`\`\`\n\nUninstall with \`rm ./ynx-wallet-cli\` and check the selected install directory for residue.\n\n## Windows 10 / Windows Server 2016+\n\nSelect \`windows-arm64\` or \`windows-amd64\`. Both PE files are unsigned and have Authenticode status \`NotSigned\`.\n\n\`\`\`powershell\n$input = [IO.File]::OpenRead('ynx-wallet-cli-windows-<arch>.exe.gz')\n$gzip = [IO.Compression.GZipStream]::new($input,[IO.Compression.CompressionMode]::Decompress)\n$output = [IO.File]::Create('ynx-wallet-cli.exe')\n$gzip.CopyTo($output); $output.Dispose(); $gzip.Dispose(); $input.Dispose()\n.\\ynx-wallet-cli.exe version\n.\\ynx-wallet-cli.exe validate-config\n\`\`\`\n\nUninstall with \`Remove-Item .\\ynx-wallet-cli.exe\` and verify \`Test-Path .\\ynx-wallet-cli.exe\` returns \`False\`.\n\n## Offline chain acceptance\n\n\`validate-config\` must report \`ynx_6423-1\`, decimal \`6423\`, EVM \`0x1917\`, and \`YNXT\`. The command \`chain-status --chain-id 9102\` must fail closed with exit code 78, error \`WRONG_CHAIN\`, and remediation \`USE_YNX_TESTNET_6423\`. These checks do not prove a live RPC connection, account, signature, or transaction.\n`;
fs.writeFileSync(path.join(output, "INSTALL.md"), installation);

const operatorRequest = {
  schemaVersion: 1,
  requestId: "wallet-cli-signing-publication-path-lease-20260831-01",
  status: "awaiting-new-lease",
  sourceCommit,
  candidateManifest: "release/wallet-cli/readiness/download-manifest.json",
  authorityRequested: {
    signing: artifacts.map(entry => ({artifactId: entry.artifactId, currentSha256: entry.sha256, credentialClassRequired: entry.target.goos === "darwin" ? "Apple Developer ID Application plus notarization credentials" : entry.target.goos === "windows" ? "trusted Authenticode code-signing identity" : "approved Linux release signing identity or explicit unsigned-preview approval", authorized: false, outputRequiresNewSha256AndContentAddressedPath: true, outputPublicationAuthorizedByThisRequest: false})),
    publicationPaths: artifacts.map(entry => ({artifactId: entry.artifactId, candidateClass: "current-testnet-preview-with-recorded-signing-boundary", exactPath: `/opt/ynx/public-downloads/wallet/cli/sha256-${entry.sha256}/${entry.filename}`, overwriteAllowed: false, authorized: false})),
    configPath: {path: "/etc/caddy/conf.d/downloads.ynxweb4.com.caddy", mutationAuthorized: false}
  },
  requiredLease: {singleUse: true, pathScoped: true, sourceBound: true, artifactHashBound: true, expiresAtRequired: true, literalInvocationRequired: true, rollbackRequired: true},
  handling: {containsSecrets: false, submitSecretsInChat: false, commitCredentials: false, injectOnlyThroughAuthorizedSecretProvider: true},
  execution: {sign: false, notarize: false, upload: false, configure: false, reload: false, deploy: false, publish: false, signedSuccessorRequiresNewManifestAndLease: true},
  acceptanceRequiredBeforePromotion: {signedArtifactRehash: true, signatureVerificationOnTargetOS: true, fullPublicGet: true, publicBytesAndSha256Match: true, contentTypeAndDispositionMatch: true, installColdSecondUninstallRepeat: true},
  releaseState: {productionSigned: false, notarized: false, downloadHosted: false, deployedPublic: false, storeReleased: false}
};
writeJSON("operator-lease-request.json", operatorRequest);

console.log(`wallet CLI release readiness generated: source=${sourceCommit} artifacts=${artifacts.length} go=${goVersion}`);
