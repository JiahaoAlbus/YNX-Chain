#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, 'release', 'monitor', 'security');
const LOCK_PATH = resolve(APP_ROOT, 'package-lock.json');
const PACKAGE_PATH = resolve(APP_ROOT, 'package.json');
const DIST_DIR = resolve(APP_ROOT, 'dist');

const ALLOWED_LICENSES = new Set(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT', 'MPL-2.0']);
const SOURCE_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.json', '.mjs', '.ts', '.tsx']);
const BUILD_TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.webmanifest']);
const TEST_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function packageNameFromLockPath(lockPath) {
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  return index >= 0 ? lockPath.slice(index + marker.length) : lockPath;
}

function purlFor(name, version) {
  const encodedName = name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function integrityHash(integrity) {
  for (const token of String(integrity ?? '').split(/\s+/).filter(Boolean)) {
    const separator = token.indexOf('-');
    if (separator <= 0) continue;
    const algorithm = token.slice(0, separator).toLowerCase();
    if (!['sha256', 'sha384', 'sha512'].includes(algorithm)) continue;
    return { algorithm, content: Buffer.from(token.slice(separator + 1), 'base64').toString('hex') };
  }
  return null;
}

export function collectProductionPackages(lock) {
  if (lock?.lockfileVersion !== 3) fail('package-lock.json must use lockfileVersion 3');
  if (!lock.packages || typeof lock.packages !== 'object') fail('package-lock.json packages map is required');

  const packages = [];
  for (const [lockPath, metadata] of Object.entries(lock.packages)) {
    if (!lockPath.startsWith('node_modules/') || metadata.dev === true) continue;
    const name = packageNameFromLockPath(lockPath);
    const version = metadata.version;
    if (!name || typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) fail(`production dependency ${lockPath} must have an exact version`);
    if (!metadata.resolved) fail(`production dependency ${name}@${version} is missing resolved URL`);
    const resolved = new URL(metadata.resolved);
    if (resolved.protocol !== 'https:') fail(`production dependency ${name}@${version} must resolve over HTTPS`);
    const integrity = integrityHash(metadata.integrity);
    if (!integrity) fail(`production dependency ${name}@${version} is missing a supported integrity hash`);
    const license = String(metadata.license ?? '').trim();
    if (!license) fail(`production dependency ${name}@${version} is missing license metadata`);
    if (!ALLOWED_LICENSES.has(license)) fail(`production dependency ${name}@${version} uses unapproved license ${license}`);
    packages.push({ name, version, lockPath, registryHost: resolved.host, integrity, license, optional: metadata.optional === true });
  }
  packages.sort((a, b) => `${a.name}@${a.version}:${a.lockPath}`.localeCompare(`${b.name}@${b.version}:${b.lockPath}`));
  return packages;
}

function walkFiles(root, extensions = SOURCE_EXTENSIONS) {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(path, extensions));
    else if (entry.isFile() && extensions.has(extname(entry.name))) output.push(path);
  }
  return output.sort();
}

function productionSourceFiles() {
  const roots = ['server', 'src'].map((name) => resolve(APP_ROOT, name));
  return roots.flatMap((root) => walkFiles(root))
    .filter((path) => !TEST_SUFFIXES.some((suffix) => path.endsWith(suffix)))
    .sort();
}

const SAST_PATTERNS = [
  { id: 'dynamic-eval', expression: /\beval\s*\(/g },
  { id: 'dynamic-function', expression: /\bnew\s+Function\s*\(/g },
  { id: 'unsafe-html', expression: /dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\s*\(/g },
  { id: 'tls-verification-disabled', expression: /rejectUnauthorized\s*:\s*false/g },
  { id: 'shell-execution-enabled', expression: /shell\s*:\s*true/g },
];

const credentialPrefix = (...parts) => parts.join('');
const CREDENTIAL_PATTERNS = [
  { id: 'private-key-block', expression: new RegExp(['-----BEGIN ', '(?:RSA |OPENSSH |EC )?', credentialPrefix('PRIVATE', ' ', 'KEY'), '-----'].join(''), 'g') },
  { id: 'cloud-access-key', expression: new RegExp(`\\b${credentialPrefix('A', 'K', 'I', 'A')}[0-9A-Z]{16}\\b`, 'g') },
  { id: 'provider-token', expression: new RegExp(`\\b${credentialPrefix('s', 'k', '-')}[A-Za-z0-9]{20,}\\b`, 'g') },
  { id: 'chat-service-token', expression: new RegExp(`\\b${credentialPrefix('x', 'o', 'x')}[baprs]-[A-Za-z0-9-]{12,}\\b`, 'g') },
];

export function scanText(text, patterns) {
  const findings = [];
  for (const pattern of patterns) {
    pattern.expression.lastIndex = 0;
    let match;
    while ((match = pattern.expression.exec(text)) !== null) {
      findings.push({ id: pattern.id, line: text.slice(0, match.index).split('\n').length, excerpt: match[0].slice(0, 120) });
      if (match[0].length === 0) pattern.expression.lastIndex += 1;
    }
  }
  return findings;
}

function runSast() {
  const findings = [];
  const files = productionSourceFiles();
  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    findings.push(...scanText(text, SAST_PATTERNS).map((finding) => ({ path: toPosix(relative(REPO_ROOT, path)), ...finding })));
  }
  if (findings.length) fail(`SAST scan found ${findings.length} prohibited construct(s): ${stableJson(findings)}`);
  return { findings, filesScanned: files.length };
}

function runCredentialScan() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT });
  const files = tracked.toString('utf8').split('\0').filter(Boolean);
  const findings = [];
  let filesScanned = 0;
  for (const trackedPath of files) {
    if (trackedPath.startsWith('release/monitor/security/')) continue;
    const path = resolve(REPO_ROOT, trackedPath);
    if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size > 2_000_000) continue;
    const buffer = readFileSync(path);
    if (buffer.includes(0)) continue;
    filesScanned += 1;
    const text = buffer.toString('utf8');
    findings.push(...scanText(text, CREDENTIAL_PATTERNS).map((finding) => ({ path: trackedPath, ...finding })));
  }
  if (findings.length) fail(`credential scan found ${findings.length} high-confidence finding(s): ${stableJson(findings)}`);
  return { findings, filesScanned };
}

function run(command, args, cwd = APP_ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function buildManifest(root) {
  const extensions = new Set([...BUILD_TEXT_EXTENSIONS, '.ico', '.png', '.woff', '.woff2']);
  const files = walkFiles(root, extensions);
  if (!files.length) fail('production build produced no files');
  return files.map((path) => ({ path: toPosix(relative(root, path)), bytes: statSync(path).size, sha256: sha256File(path) })).sort((a, b) => a.path.localeCompare(b.path));
}

const FORBIDDEN_BUILD_PATTERNS = [
  { id: 'unfinished-marker', expression: /\b(?:TODO|FIXME|Coming soon)\b/gi },
  { id: 'example-domain', expression: /example\.com/gi },
  { id: 'local-worktree', expression: /YNX Final Worktrees|\/Users\/huangjiahao|codex\/final-monitor/gi },
  { id: 'internal-mcp-host', expression: /mcp13\.huangjeo\.com/gi },
];

function scanBuild(root) {
  const findings = [];
  for (const path of walkFiles(root, BUILD_TEXT_EXTENSIONS)) {
    const text = readFileSync(path, 'utf8');
    findings.push(...scanText(text, FORBIDDEN_BUILD_PATTERNS).map((finding) => ({ path: toPosix(relative(root, path)), ...finding })));
  }
  if (findings.length) fail(`artifact scan found ${findings.length} prohibited public string(s): ${stableJson(findings)}`);
  return findings;
}

function verifyReproducibleBuild(skipBuild) {
  if (skipBuild) {
    if (!existsSync(DIST_DIR)) fail('--skip-build requires an existing dist directory');
    return { manifest: buildManifest(DIST_DIR), reproducible: null, artifactFindings: scanBuild(DIST_DIR), builds: 0 };
  }
  rmSync(DIST_DIR, { recursive: true, force: true });
  run('npm', ['run', 'build']);
  const first = buildManifest(DIST_DIR);
  scanBuild(DIST_DIR);
  rmSync(DIST_DIR, { recursive: true, force: true });
  run('npm', ['run', 'build']);
  const second = buildManifest(DIST_DIR);
  const artifactFindings = scanBuild(DIST_DIR);
  if (stableJson(first) !== stableJson(second)) fail('two clean production builds produced different file manifests');
  return { manifest: second, reproducible: true, artifactFindings, builds: 2 };
}

function sourceCommitFromArgs(args) {
  const index = args.indexOf('--source-commit');
  const supplied = index >= 0 ? args[index + 1] : process.env.YNX_MONITOR_SOURCE_COMMIT;
  const commit = supplied || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) fail('source commit must be a full 40-character lowercase Git SHA');
  return commit;
}

function outputDirFromArgs(args) {
  const index = args.indexOf('--output-dir');
  return index >= 0 ? resolve(REPO_ROOT, args[index + 1]) : DEFAULT_OUTPUT_DIR;
}

function sourceDate(commit) {
  try {
    return execFileSync('git', ['show', '-s', '--format=%cI', commit], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function writeOutput(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : stableJson(value), 'utf8');
}

function buildSbom(packages, packageJson, commit) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: packageJson.name,
        version: packageJson.version,
        'bom-ref': `pkg:npm/%40ynx/monitor@${packageJson.version}`,
        properties: [{ name: 'ynx:productNumber', value: '13' }, { name: 'ynx:sourceCommit', value: commit }],
      },
      tools: [{ vendor: 'YNX', name: 'monitor-supply-chain-gate', version: '1' }],
    },
    components: packages.map((item) => ({
      type: 'library',
      name: item.name,
      version: item.version,
      'bom-ref': `${purlFor(item.name, item.version)}?lock_path=${encodeURIComponent(item.lockPath)}`,
      purl: purlFor(item.name, item.version),
      hashes: [{ alg: item.integrity.algorithm.toUpperCase().replace('SHA', 'SHA-'), content: item.integrity.content }],
      licenses: [{ license: { id: item.license } }],
      properties: [{ name: 'ynx:lockPath', value: item.lockPath }, { name: 'ynx:registryHost', value: item.registryHost }, { name: 'ynx:optional', value: String(item.optional) }],
    })),
  };
}

function buildNotices(packages, commit) {
  const rows = packages.map((item) => `| ${item.name.replaceAll('|', '\\|')} | ${item.version} | ${item.license} | ${item.registryHost} |`).join('\n');
  return `# YNX Monitor Third-Party Notices\n\nSource commit: \`${commit}\`\n\nThis inventory is generated from the locked production dependency graph. It records package metadata and does not replace the license text distributed by each dependency.\n\n| Package | Version | License | Registry host |\n|---|---:|---|---|\n${rows}\n`;
}

function buildDastPlan(commit) {
  return {
    schemaVersion: 'ynx.monitor.dast-plan.v1',
    sourceCommit: commit,
    authority: 'local test input only; this file is not evidence of a hosted scan',
    baseUrlVariable: 'YNX_MONITOR_DAST_BASE_URL',
    publicRoutes: [
      { method: 'GET', path: '/health', expected: [200], boundary: 'process availability only' },
      { method: 'GET', path: '/version', expected: [200], boundary: 'source and release identity may be null when not injected' },
      { method: 'GET', path: '/status', expected: [200, 503], boundary: 'must fail closed without an approved signed publisher feed' },
    ],
    negativeCases: [
      { id: 'ops-no-token', method: 'GET', path: '/ops/me', expected: 401 },
      { id: 'mutation-no-origin', method: 'POST', path: '/ops/incidents', expected: 403 },
      { id: 'mutation-wrong-origin', method: 'POST', path: '/ops/incidents', expected: 403 },
      { id: 'mutation-no-csrf', method: 'POST', path: '/ops/incidents', expected: 403 },
      { id: 'public-status-tamper', method: 'GET', path: '/status', expected: 503 },
      { id: 'public-status-stale', method: 'GET', path: '/status', expected: 503 },
      { id: 'public-status-replay', method: 'GET', path: '/status', expected: 503 },
      { id: 'unknown-route', method: 'GET', path: '/not-a-route', expected: 404 },
    ],
    executableEvidence: ['apps/monitor/server/auth.test.ts', 'apps/monitor/server/rbac.test.ts', 'apps/monitor/server/public-status.test.ts', 'apps/monitor/server/incident-lifecycle.test.ts', 'apps/monitor/server/recovery-lifecycle.test.ts'],
  };
}

export function runGate(args = process.argv.slice(2)) {
  const sourceCommit = sourceCommitFromArgs(args);
  const outputDir = outputDirFromArgs(args);
  const skipBuild = args.includes('--skip-build');
  const packageJson = readJson(PACKAGE_PATH);
  const lock = readJson(LOCK_PATH);
  const packages = collectProductionPackages(lock);
  const credentialScan = runCredentialScan();
  const sast = runSast();
  const build = verifyReproducibleBuild(skipBuild);
  const registries = [...new Set(packages.map((item) => item.registryHost))].sort();

  mkdirSync(outputDir, { recursive: true });
  const outputs = {
    sbom: resolve(outputDir, 'sbom.cdx.json'),
    notices: resolve(outputDir, 'THIRD_PARTY_NOTICES.md'),
    dependencyReview: resolve(outputDir, 'dependency-review.json'),
    dast: resolve(outputDir, 'dast-plan.json'),
    buildManifest: resolve(outputDir, 'build-manifest.json'),
    provenance: resolve(outputDir, 'provenance.json'),
    summary: resolve(outputDir, 'security-gate-summary.json'),
  };

  writeOutput(outputs.sbom, buildSbom(packages, packageJson, sourceCommit));
  writeOutput(outputs.notices, buildNotices(packages, sourceCommit));
  writeOutput(outputs.dependencyReview, {
    schemaVersion: 'ynx.monitor.dependency-review.v1',
    sourceCommit,
    generatedFrom: 'apps/monitor/package-lock.json',
    lockfileVersion: lock.lockfileVersion,
    packageCount: packages.length,
    directProductionDependencies: Object.keys(packageJson.dependencies ?? {}).sort(),
    licenses: [...new Set(packages.map((item) => item.license))].sort(),
    allowedLicenses: [...ALLOWED_LICENSES].sort(),
    registryHosts: registries,
    nonCanonicalRegistryHosts: registries.filter((host) => host !== 'registry.npmjs.org'),
    policy: { exactVersionsRequired: true, integrityRequired: true, httpsRequired: true, missingLicenseFails: true, unapprovedLicenseFails: true, mirrorUsageIsReportedNotConcealed: true },
    findings: [],
  });
  writeOutput(outputs.dast, buildDastPlan(sourceCommit));
  writeOutput(outputs.buildManifest, { schemaVersion: 'ynx.monitor.build-manifest.v1', sourceCommit, buildCommand: 'npm run build', cleanBuildsCompared: build.builds, reproducible: build.reproducible, files: build.manifest });

  const materialPaths = [PACKAGE_PATH, LOCK_PATH, outputs.sbom, outputs.notices, outputs.dependencyReview, outputs.dast, outputs.buildManifest];
  writeOutput(outputs.provenance, {
    schemaVersion: 'ynx.monitor.provenance.v1',
    sourceCommit,
    sourceDate: sourceDate(sourceCommit),
    product: '@ynx/monitor',
    builder: { id: 'local://ynx-monitor-supply-chain-gate-v1', hermetic: false, networkIsolationVerified: false },
    build: { command: 'npm run build', cleanBuildsCompared: build.builds, reproducible: build.reproducible, artifactScanPassed: build.artifactFindings.length === 0 },
    materials: materialPaths.map((path) => ({ path: toPosix(relative(REPO_ROOT, path)), sha256: sha256File(path) })),
    signing: { signed: false, signingClass: 'unsigned-local-evidence' },
    claimsNotMade: ['GitHub-hosted provenance', 'signed release artifact', 'production installation', 'public deployment'],
  });
  writeOutput(outputs.summary, {
    schemaVersion: 'ynx.monitor.security-gate-summary.v1',
    sourceCommit,
    result: 'passed',
    sourceFilesScanned: sast.filesScanned,
    credentialFilesScanned: credentialScan.filesScanned,
    credentialFindings: credentialScan.findings.length,
    sastFindings: sast.findings.length,
    productionPackages: packages.length,
    registryHosts: registries,
    cleanBuildsCompared: build.builds,
    reproducibleBuild: build.reproducible,
    artifactFindings: build.artifactFindings.length,
    outputs: Object.values(outputs).filter((path) => path !== outputs.summary).map((path) => ({ path: toPosix(relative(REPO_ROOT, path)), sha256: sha256File(path) })),
    limitations: ['Local evidence is unsigned.', 'No hosted DAST target was available.', 'Registry mirror use is reported and requires central supply-chain acceptance.'],
  });

  console.log(`YNX Monitor supply-chain gate passed for ${sourceCommit}`);
  console.log(`Evidence: ${toPosix(relative(REPO_ROOT, outputDir))}`);
  return { sourceCommit, outputDir, packages: packages.length, build };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    runGate();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
