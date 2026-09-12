import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packagePath = 'packages/wallet-auth';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000,
});

// Only committed sources are packaged. Never copy a dirty owner's checkout.
export function buildWalletGatewayRelease({ rootDir, sourceCommit, outputDir }) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? '')) throw new Error('A full lowercase source commit is required');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or newer is required');
  const root = fs.realpathSync(rootDir);
  const output = path.resolve(outputDir);
  if (fs.existsSync(output)) throw new Error('Output already exists; choose a new release directory');
  if (run('git', ['rev-parse', '--verify', `${sourceCommit}^{commit}`], root).trim() !== sourceCommit) throw new Error('Source commit did not resolve exactly');
  const entries = run('git', ['ls-tree', '-r', sourceCommit, '--', packagePath], root);
  if (!entries || entries.split('\n').some(line => line.startsWith('120000 ') || line.startsWith('160000 '))) throw new Error('Package must be a committed tree without symlinks or submodules');
  const packageTree = run('git', ['rev-parse', `${sourceCommit}:${packagePath}`], root).trim();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-wallet-release-'));
  try {
    const archive = path.join(scratch, 'source.tar');
    run('git', ['archive', '--format=tar', `--output=${archive}`, sourceCommit, packagePath], root);
    const release = path.join(scratch, 'release');
    fs.mkdirSync(release);
    run('tar', ['-xf', archive, '-C', release], root);
    const pkg = path.join(release, packagePath);
    const lockPath = path.join(pkg, 'package-lock.json');
    const lockDigest = digest(fs.readFileSync(lockPath));
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    for (const [name, item] of Object.entries(lock.packages)) {
      if (name && (!item.integrity || !item.resolved?.startsWith('https://registry.npmjs.org/') || item.link || item.hasInstallScript)) throw new Error(`Unsupported runtime dependency: ${name}`);
    }
    run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], pkg);
    if (digest(fs.readFileSync(lockPath)) !== lockDigest) throw new Error('Dependency installation changed the lockfile');
    const nativeFile = walk(path.join(pkg, 'node_modules')).find(file => /\.(node|dylib|so|dll|exe)$/.test(file.path));
    if (nativeFile) throw new Error('Gateway release requires platform-independent JavaScript dependencies');
    const identity = { sourceCommit, release: `wallet-gateway-${sourceCommit.slice(0, 12)}`, buildTime: new Date().toISOString() };
    fs.writeFileSync(path.join(release, 'run.mjs'), launcher(identity));
    fs.writeFileSync(path.join(release, 'README.md'), instructions);
    const files = walk(release);
    const manifest = {
      schemaVersion: 1, service: 'ynx-wallet-gatewayd', identity, packageTree,
      minimumNodeMajor: 22, builderNode: process.version, lockSha256: lockDigest,
      canonicalAuthority: 'https://wallet-auth.ynxweb4.com',
      registrySha256: digest(fs.readFileSync(path.join(pkg, 'product-session-registry.json'))),
      legacyRegistrySha256: digest(fs.readFileSync(path.join(pkg, 'central-registry.json'))),
      dependencies: Object.entries(lock.packages).filter(([name]) => name).map(([name, value]) => ({ name, version: value.version, integrity: value.integrity })),
      files, deployed: false,
    };
    fs.writeFileSync(path.join(release, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const tarPath = path.join(scratch, 'wallet-gateway.tar.gz');
    run('tar', ['-czf', tarPath, '-C', release, '.'], root);
    // Reserve output only after the complete artifact exists; never replace old releases.
    fs.mkdirSync(output);
    fs.copyFileSync(tarPath, path.join(output, 'wallet-gateway.tar.gz'), fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(path.join(release, 'release-manifest.json'), path.join(output, 'release-manifest.json'), fs.constants.COPYFILE_EXCL);
    const archiveBytes = fs.readFileSync(tarPath);
    const receipt = { sourceCommit, archive: 'wallet-gateway.tar.gz', bytes: archiveBytes.length, sha256: digest(archiveBytes), manifestSha256: digest(fs.readFileSync(path.join(release, 'release-manifest.json'))) };
    fs.writeFileSync(path.join(output, 'artifact.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return { ...receipt, outputDir: output };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function walk(directory, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const absolute = path.join(directory, entry.name), relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...walk(absolute, relative + '/'));
    else if (entry.isFile()) {
      const bytes = fs.readFileSync(absolute);
      files.push({ path: relative, bytes: bytes.length, sha256: digest(bytes), mode: fs.statSync(absolute).mode & 0o777 });
    } else throw new Error(`Release contains an unsupported filesystem entry: ${relative}`);
  }
  return files;
}

function launcher(identity) {
  return `import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const identity = ${JSON.stringify(identity)};
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or newer is required');
for (const key of ['YNX_WALLET_GATEWAY_STATE_PATH', 'YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH']) {
  const value = process.env[key];
  if (!value?.startsWith('/') || !fs.existsSync(value) || !fs.lstatSync(value).isFile() || fs.statSync(value).size === 0) throw new Error(key + ' must point to an existing durable state file; this upgrade launcher never creates or resets state');
}
if (!['2', '3'].includes(process.env.YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION ?? '')) throw new Error('Explicit existing Product Session state version 2 or 3 is required');
Object.assign(process.env, {
  YNX_WALLET_GATEWAY_SOURCE_COMMIT: identity.sourceCommit,
  YNX_WALLET_GATEWAY_RELEASE: identity.release,
  YNX_WALLET_GATEWAY_BUILD_TIME: identity.buildTime,
  YNX_WALLET_GATEWAY_REMOTE_DEPLOYED: 'true',
  YNX_WALLET_GATEWAY_REGISTRY_PATH: fileURLToPath(new URL('./packages/wallet-auth/central-registry.json', import.meta.url)),
  YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH: fileURLToPath(new URL('./packages/wallet-auth/product-session-registry.json', import.meta.url)),
});
await import('./packages/wallet-auth/scripts/ynx-wallet-gatewayd.mjs');
`;
}

const instructions = `# Wallet Gateway immutable runtime package

This archive contains the exact committed Wallet package, lockfile-installed JavaScript dependencies, per-file hashes, and an upgrade launcher. It does not publish a service or prove product login works.

Verify artifact.json and release-manifest.json against the received archive before extracting to a new immutable release directory. Use Node >=22. No npm installation is needed on the host. Preserve the existing service user, loopback port, single-writer lock, supervisor and TLS reverse proxy. New clients use https://wallet-auth.ynxweb4.com; keep the separate legacy api/ide authority and its state intact until its clients migrate.

Before upgrading, preserve the current source/registry and take a consistent backup of both durable state files with the writer stopped or through its supported backup procedure. Set YNX_WALLET_GATEWAY_STATE_PATH, YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH and the explicit existing YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION (2 or 3). Keep the existing HTTP_ADDR/HTTP_PORT. Start with node /absolute/release/run.mjs under the existing single-writer launcher. The wrapper requires existing nonempty regular state files and pins the source identity and registries to this archive. It does not initialize, migrate, truncate or combine state. A new installation needs a separate explicit initialization procedure; v3 requires the supported migration first.

Cold-load a private copy of the current state with the candidate on a separate loopback port before replacing the service. Verify the clock endpoint, expected CORS origins, pre-existing sessions/replay state and new product registrations. Rollback is not merely pointing an old binary at new state: retain the matching pre-upgrade source/registry/state snapshot, preserve any newer history, and establish compatibility before restoring a writer.
`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--output') throw new Error('Usage: node scripts/package/wallet-gateway-release.mjs --source <full-commit> --output <new-directory>');
  process.stdout.write(JSON.stringify(buildWalletGatewayRelease({ rootDir: process.cwd(), sourceCommit: args[1], outputDir: args[3] }), null, 2) + '\n');
}
