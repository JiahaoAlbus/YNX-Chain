#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  canonicalJSON,
  createDeterministicTar,
  assertSafeOutputDirectory,
  relativePosix,
  sha256,
  verifyShopPackageOutput,
  walkFiles,
  writeCanonicalJSON,
} from './shop-package-lib.mjs';

const VERSION = '0.2.0-testnet-preview';
const args = parseArgs(process.argv.slice(2));
const sourceCommit = args.commit ?? git(['rev-parse', 'HEAD']);
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('source commit must be a full lowercase Git SHA');
const head = git(['rev-parse', 'HEAD']);
if (head !== sourceCommit) throw new Error(`source commit must equal current HEAD: head=${head} requested=${sourceCommit}`);
const dirty = git(['status', '--porcelain', '--untracked-files=no']).trim().length > 0;
if (dirty && !args.allowDirty) throw new Error('Shop release packaging requires a clean tracked worktree');
const allowedOutputRoot = path.resolve('artifacts/shop-release');
const outputDirectory = assertSafeOutputDirectory(
  path.resolve(args.output ?? path.join(allowedOutputRoot, sourceCommit.slice(0, 12))),
  allowedOutputRoot,
);
const sourceDateEpoch = Number(git(['show', '-s', '--format=%ct', sourceCommit]));
const sourceTree = git(['rev-parse', `${sourceCommit}^{tree}`]);
const packageRoot = `ynx-shop-${VERSION}`;
const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-shop-release-'));
const payloadRoot = path.join(buildRoot, packageRoot);

try {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  run('npm', ['--prefix', 'apps/shop', 'run', 'build']);
  run('npm', ['--prefix', 'apps/seller-console', 'run', 'build']);
  buildBinary('linux', 'amd64', path.join(payloadRoot, 'bin/ynx-shopd-linux-amd64'));
  buildBinary('linux', 'arm64', path.join(payloadRoot, 'bin/ynx-shopd-linux-arm64'));
  copyTree('apps/shop/dist', path.join(payloadRoot, 'web/shop'), (file) => !/\.(?:apk|aab)$/i.test(file));
  copyTree('apps/seller-console/dist', path.join(payloadRoot, 'web/seller'));
  copySelectedFiles(payloadRoot);

  const payloadFiles = payloadEntries(payloadRoot);
  const manifest = {
    schema: 'ynx-shop-release-manifest/v1',
    productId: 'ynx-shop',
    name: 'YNX Shop + Seller Console',
    version: VERSION,
    environment: 'YNX Testnet preview',
    sourceCommit,
    sourceTree,
    sourceDateEpoch,
    sourceTreeDirty: dirty,
    buildMode: 'deterministic-local-cross-compile',
    targets: ['linux/amd64', 'linux/arm64', 'web/shop', 'web/seller'],
    testnetOnly: true,
    implementedLocal: true,
    testedLocal: true,
    installedLocal: false,
    integratedCentral: false,
    deployedStaging: false,
    deployedPublic: false,
    downloadHosted: false,
    productionSigned: false,
    storeReleased: false,
    historicalNativeArtifactIncluded: false,
    files: payloadFiles,
  };
  const sbom = generateSBOM(path.join(payloadRoot, 'bin/ynx-shopd-linux-amd64'), sourceCommit, sourceDateEpoch);
  const provenance = generateProvenance(payloadFiles, sourceCommit, sourceTree, sourceDateEpoch);
  const metadataRoot = path.join(payloadRoot, 'metadata');
  writeCanonicalJSON(path.join(metadataRoot, 'release-manifest.json'), manifest);
  writeCanonicalJSON(path.join(metadataRoot, 'sbom.cdx.json'), sbom);
  fs.writeFileSync(path.join(metadataRoot, 'provenance.intoto.jsonl'), `${JSON.stringify(provenance)}\n`, { mode: 0o644 });

  const tarEntries = walkFiles(payloadRoot).map((file) => {
    const relative = relativePosix(buildRoot, file);
    const packageRelative = relativePosix(payloadRoot, file);
    return {
      path: relative,
      mode: packageRelative.startsWith('bin/') ? 0o755 : 0o644,
      body: fs.readFileSync(file),
    };
  });
  const archive = createDeterministicTar(tarEntries, sourceDateEpoch);
  const archiveName = `ynx-shop-${VERSION}-${sourceCommit.slice(0, 12)}.tar`;
  fs.writeFileSync(path.join(outputDirectory, archiveName), archive, { mode: 0o644 });
  copyMetadata(metadataRoot, outputDirectory);
  const index = {
    schema: 'ynx-shop-artifact-index/v1',
    productId: 'ynx-shop',
    version: VERSION,
    sourceCommit,
    sourceTree,
    sourceDateEpoch,
    sourceTreeDirty: dirty,
    packageRoot,
    archive: {
      file: archiveName,
      bytes: archive.length,
      sha256: sha256(archive),
      mediaType: 'application/x-tar',
    },
    metadata: metadataIndex(outputDirectory),
    testnetOnly: true,
    currentSourceArtifact: true,
    remotePublicProof: false,
    downloadHosted: false,
    deployedStaging: false,
    deployedPublic: false,
    productionSigned: false,
    storeReleased: false,
    verification: {
      deterministicTar: true,
      fixedSourceDateEpoch: true,
      sortedEntries: true,
      fixedUidGid: true,
      historicalNativeArtifactExcluded: true,
      embeddedReleaseManifest: true,
      embeddedCycloneDXSBOM: true,
      embeddedInTotoProvenance: true,
    },
  };
  writeCanonicalJSON(path.join(outputDirectory, 'artifact-index.json'), index);
  writeChecksums(outputDirectory, [archiveName, 'release-manifest.json', 'sbom.cdx.json', 'provenance.intoto.jsonl']);
  const verified = verifyShopPackageOutput(outputDirectory);
  console.log(canonicalJSON({
    status: 'verified-local-artifact',
    outputDirectory,
    archive: verified.index.archive,
    payloadFiles: verified.manifest.files.length,
    sbomComponents: verified.sbom.components?.length ?? 0,
    productionSigned: false,
    deployedPublic: false,
  }).trim());
} finally {
  fs.rmSync(buildRoot, { recursive: true, force: true });
}

function parseArgs(values) {
  const parsed = { allowDirty: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--allow-dirty') parsed.allowDirty = true;
    else if (value === '--commit') parsed.commit = values[++index];
    else if (value === '--output') parsed.output = values[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  return parsed;
}

function git(arguments_) {
  return execFileSync('git', arguments_, { encoding: 'utf8' }).trim();
}

function run(command, arguments_, options = {}) {
  execFileSync(command, arguments_, { stdio: 'inherit', ...options });
}

function buildBinary(goos, goarch, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const ldflags = [
    '-buildid=',
    `-X=github.com/JiahaoAlbus/YNX-Chain/internal/commerce.BuildVersion=${VERSION}`,
    `-X=github.com/JiahaoAlbus/YNX-Chain/internal/commerce.BuildCommit=${sourceCommit}`,
  ].join(' ');
  run('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags', ldflags, '-o', target, './internal/commerce/cmd/shopd'], {
    env: { ...process.env, CGO_ENABLED: '0', GOOS: goos, GOARCH: goarch, SOURCE_DATE_EPOCH: String(sourceDateEpoch) },
  });
  fs.chmodSync(target, 0o755);
}

function copyTree(source, target, include = () => true) {
  for (const file of walkFiles(source)) {
    if (!include(file)) continue;
    const relative = relativePosix(source, file);
    const destination = path.join(target, ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination);
    fs.chmodSync(destination, 0o644);
  }
}

function copySelectedFiles(targetRoot) {
  const files = [
    ['README.md', 'docs/REPOSITORY_README.md'],
    ['docs/operations/OPERATIONS_RUNBOOK.md', 'docs/OPERATIONS_RUNBOOK.md'],
    ['docs/deployment/TESTNET_DEPLOYMENT_GUIDE.md', 'docs/TESTNET_DEPLOYMENT_GUIDE.md'],
    ['MIGRATION_COMPATIBILITY.md', 'docs/MIGRATION_COMPATIBILITY.md'],
    ['OBSERVABILITY.md', 'docs/OBSERVABILITY.md'],
    ['SLO_CAPACITY_PLAN.md', 'docs/SLO_CAPACITY_PLAN.md'],
    ['UNIT_ECONOMICS.md', 'docs/UNIT_ECONOMICS.md'],
    ['FEATURE_COMPLETION_EVIDENCE.md', 'docs/FEATURE_COMPLETION_EVIDENCE.md'],
    ['EVIDENCE_INDEX.md', 'docs/EVIDENCE_INDEX.md'],
    ['apps/shop/product-release.json', 'metadata/product-release.json'],
    ['apps/shop/public-product-metadata.json', 'metadata/public-product-metadata.json'],
    ['release/integration/ynx-shop-contract.json', 'integration/ynx-shop-contract.json'],
    ['docs/integration/INTEGRATION_HANDOFF.md', 'integration/INTEGRATION_HANDOFF.md'],
    ['docs/integration/DEPENDENCY_ACCEPTANCE.md', 'integration/DEPENDENCY_ACCEPTANCE.md'],
    ['docs/integration/CROSS_PRODUCT_TEST_VECTORS.json', 'integration/CROSS_PRODUCT_TEST_VECTORS.json'],
    ['internal/commerce/integration/shop-registry-v2.json', 'integration/shop-registry-v2.json'],
    ['deploy/shop/ynx-shopd.service', 'deploy/ynx-shopd.service'],
    ['deploy/shop/web4-shop-staging.routes', 'deploy/web4-shop-staging.routes'],
    ['deploy/shop/install-staging-routes.py', 'deploy/install-staging-routes.py'],
  ];
  for (const [source, destination] of files) {
    if (!fs.existsSync(source)) throw new Error(`missing Shop artifact input: ${source}`);
    const target = path.join(targetRoot, ...destination.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, destination.endsWith('.py') ? 0o755 : 0o644);
  }
}

function payloadEntries(root) {
  return walkFiles(root)
    .filter((file) => !relativePosix(root, file).startsWith('metadata/release-manifest.json') && !relativePosix(root, file).startsWith('metadata/sbom.cdx.json') && !relativePosix(root, file).startsWith('metadata/provenance.intoto.jsonl'))
    .map((file) => {
      const relative = relativePosix(root, file);
      const body = fs.readFileSync(file);
      return {
        path: relative,
        kind: relative.startsWith('bin/') ? 'binary' : relative.startsWith('web/') ? 'web-asset' : relative.startsWith('deploy/') ? 'deployment-template' : relative.startsWith('integration/') ? 'integration-evidence' : 'documentation-or-metadata',
        mode: relative.startsWith('bin/') || relative.endsWith('.py') ? 0o755 : 0o644,
        bytes: body.length,
        sha256: sha256(body),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function generateSBOM(binary, commit, epoch) {
  const linked = execFileSync('go', ['version', '-m', binary], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[0] === 'dep')
    .map(([, name, version]) => ({ name, version }))
    .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const moduleRows = execFileSync('go', ['list', '-m', '-f', '{{.Path}}\t{{.Version}}\t{{.Dir}}', 'all'], { encoding: 'utf8' })
    .trim().split('\n').map((line) => line.split('\t'));
  const directories = new Map(moduleRows.map(([name, version, directory]) => [`${name}@${version}`, directory]));
  const components = linked.map(({ name, version }) => ({
    type: 'library',
    'bom-ref': `pkg:golang/${name}@${version}`,
    name,
    version,
    purl: `pkg:golang/${name}@${version}`,
    licenses: [{ license: { id: detectLicense(directories.get(`${name}@${version}`)) } }],
  }));
  components.push(
    { type: 'application', 'bom-ref': 'pkg:generic/ynx-shop-web@0.2.0', name: '@ynx/shop-web', version: '0.2.0', properties: [{ name: 'ynx:runtimeDependencies', value: '0' }] },
    { type: 'application', 'bom-ref': 'pkg:generic/ynx-seller-console@0.2.0', name: '@ynx/seller-console', version: '0.2.0', properties: [{ name: 'ynx:runtimeDependencies', value: '0' }] },
    { type: 'application', 'bom-ref': `pkg:generic/ynx-shopd@${VERSION}`, name: 'ynx-shopd', version: VERSION },
  );
  components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));
  const uuidHex = sha256(`ynx-shop-sbom:${commit}`).slice(0, 32).split('');
  uuidHex[12] = '5';
  uuidHex[16] = ['8', '9', 'a', 'b'][Number.parseInt(uuidHex[16], 16) % 4];
  const uuid = `${uuidHex.slice(0, 8).join('')}-${uuidHex.slice(8, 12).join('')}-${uuidHex.slice(12, 16).join('')}-${uuidHex.slice(16, 20).join('')}-${uuidHex.slice(20).join('')}`;
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${uuid}`,
    version: 1,
    metadata: {
      timestamp: new Date(epoch * 1000).toISOString(),
      component: { type: 'application', name: 'YNX Shop + Seller Console', version: VERSION },
      properties: [
        { name: 'sourceCommit', value: commit },
        { name: 'sourceDateEpoch', value: String(epoch) },
        { name: 'releaseBoundary', value: 'local artifact; not hosted, deployed, production signed, or store released' },
      ],
    },
    components,
  };
}

function detectLicense(directory) {
  if (!directory || !fs.existsSync(directory)) return 'NOASSERTION';
  const name = fs.readdirSync(directory).find((candidate) => /^(?:licen[cs]e|copying)/i.test(candidate));
  if (!name) return 'NOASSERTION';
  const text = fs.readFileSync(path.join(directory, name), 'utf8').slice(0, 20000).toLowerCase();
  if (text.includes('apache license') && text.includes('version 2.0')) return 'Apache-2.0';
  if (text.includes('mozilla public license') && text.includes('2.0')) return 'MPL-2.0';
  if (text.includes('permission is hereby granted, free of charge')) return 'MIT';
  if (text.includes('redistribution and use in source and binary forms')) return text.includes('neither the name') ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (text.includes('isc license')) return 'ISC';
  return 'NOASSERTION';
}

function generateProvenance(files, commit, tree, epoch) {
  const subjects = files.map((file) => ({ name: file.path, digest: { sha256: file.sha256 } }));
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: subjects,
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://ynxweb4.com/buildtypes/shop-release/v1',
        externalParameters: {
          productId: 'ynx-shop',
          version: VERSION,
          sourceCommit: commit,
          sourceTree: tree,
          sourceDateEpoch: epoch,
          targets: ['linux/amd64', 'linux/arm64', 'web/shop', 'web/seller'],
        },
        internalParameters: {
          cgoEnabled: false,
          goTrimpath: true,
          goBuildVCS: false,
          goBuildIDCleared: true,
          deterministicTar: true,
        },
        resolvedDependencies: [{ uri: 'git+https://github.com/JiahaoAlbus/YNX-Chain', digest: { gitCommit: commit, gitTree: tree } }],
      },
      runDetails: {
        builder: { id: 'https://ynxweb4.com/builders/shop-local-v1' },
        metadata: { invocationId: `urn:ynx:shop-release:${commit}`, startedOn: new Date(epoch * 1000).toISOString(), finishedOn: new Date(epoch * 1000).toISOString() },
        byproducts: [{ name: 'release-boundary', content: { testnetOnly: true, remotePublicProof: false, productionSigned: false } }],
      },
    },
  };
}

function copyMetadata(metadataRoot, output) {
  for (const name of ['release-manifest.json', 'sbom.cdx.json', 'provenance.intoto.jsonl']) {
    fs.copyFileSync(path.join(metadataRoot, name), path.join(output, name));
    fs.chmodSync(path.join(output, name), 0o644);
  }
}

function metadataIndex(output) {
  const result = {};
  for (const name of ['release-manifest.json', 'sbom.cdx.json', 'provenance.intoto.jsonl']) {
    const body = fs.readFileSync(path.join(output, name));
    result[name] = { bytes: body.length, sha256: sha256(body) };
  }
  return result;
}

function writeChecksums(output, names) {
  const lines = names.slice().sort().map((name) => `${sha256(fs.readFileSync(path.join(output, name)))}  ${name}`);
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${lines.join('\n')}\n`, { mode: 0o644 });
}
