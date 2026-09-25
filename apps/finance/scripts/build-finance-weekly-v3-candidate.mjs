#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorityRuntimeFiles, runtimeFiles, sha256 } from './finance-nonregressive-runtime.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: scriptDir, encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const value = name => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`missing ${name}`);
  return args[index + 1];
};
const sourceCommit = value('--source');
const output = value('--output');
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('source must be lowercase 40-hex');
execFileSync('git', ['cat-file', '-e', `${sourceCommit}^{commit}`], { cwd: repoRoot });
if (execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()) throw new Error('release tooling worktree must be clean');

const toolingCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const sourceTree = execFileSync('git', ['rev-parse', `${sourceCommit}^{tree}`], { cwd: repoRoot, encoding: 'utf8' }).trim();
const buildTime = new Date(execFileSync('git', ['show', '-s', '--format=%cI', sourceCommit], { cwd: repoRoot, encoding: 'utf8' }).trim()).toISOString();
const release = `finance-weekly-v3-${sourceCommit.slice(0, 12)}-linux-amd64`;
const identity = { sourceCommit, release, buildTime, frontendSourceCommit: sourceCommit };

const programs = [
  ['ynx-finance', './apps/finance/cmd/server'],
  ['ynx-finance-admin', './apps/finance/cmd/admin'],
  ['ynx-finance-broker-tools', './apps/finance/cmd/broker-tools'],
  ['ynx-finance-broker-worker', './apps/finance/cmd/broker-worker'],
];

function walk(root, path = root) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const full = join(path, entry.name);
    return entry.isDirectory() ? walk(root, full) : [relative(root, full)];
  }).sort();
}

function commandFor(name, pkg) {
  const ldflags = `-s -w -buildid= -X main.buildCommit=${sourceCommit} -X main.buildRelease=${release} -X main.buildTime=${buildTime}`;
  return `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -buildvcs=false -trimpath -ldflags '${ldflags}' -o ${name} ${pkg}`;
}

function buildOnce(sourceRoot, destination) {
  const work = mkdtempSync(join(tmpdir(), 'ynx-finance-weekly-v3-build-'));
  try {
    const packageRoot = join(work, release);
    const webRoot = join(packageRoot, 'web');
    mkdirSync(webRoot, { recursive: true, mode: 0o755 });
    const ldflags = `-s -w -buildid= -X main.buildCommit=${sourceCommit} -X main.buildRelease=${release} -X main.buildTime=${buildTime}`;
    for (const [name, pkg] of programs) {
      const built = spawnSync('go', ['build', '-buildvcs=false', '-trimpath', '-ldflags', ldflags, '-o', join(packageRoot, name), pkg], {
        cwd: sourceRoot,
        env: { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' },
        encoding: 'utf8',
      });
      if (built.status !== 0) throw new Error(`${built.stdout}${built.stderr}`);
      chmodSync(join(packageRoot, name), 0o755);
    }
    for (const name of runtimeFiles) copyFileSync(join(sourceRoot, 'apps/finance/web', name), join(webRoot, name));
    for (const file of authorityRuntimeFiles) {
      const destination=join(packageRoot,file.destination);
      mkdirSync(dirname(destination),{recursive:true,mode:0o755});
      copyFileSync(join(sourceRoot,file.source),destination);
    }
    copyFileSync(join(sourceRoot, 'apps/finance/.env.example'), join(packageRoot, '.env.example'));
    writeFileSync(join(webRoot, 'build-identity.json'), `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o644 });
    for (const name of runtimeFiles) {
      const sourceBody = readFileSync(join(sourceRoot, 'apps/finance/web', name));
      const packagedBody = readFileSync(join(webRoot, name));
      if (!sourceBody.equals(packagedBody)) throw new Error(`FINANCE_FRONTEND_SOURCE_BINDING_MISMATCH:${name}`);
    }
    for (const file of authorityRuntimeFiles) {
      if (!readFileSync(join(sourceRoot,file.source)).equals(readFileSync(join(packageRoot,file.destination)))) throw new Error(`FINANCE_AUTHORITY_RUNTIME_SOURCE_BINDING_MISMATCH:${file.destination}`);
    }
    for (const forbidden of ['wallet-connect.js', 'wallet-connect-entry.js']) {
      try {
        readFileSync(join(webRoot, forbidden));
        throw new Error(`FINANCE_LEGACY_WALLET_CONNECT_REINTRODUCED:${forbidden}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const html = readFileSync(join(webRoot, 'index.html'), 'utf8');
    if (!html.includes('wallet-auth.js') || html.includes('wallet-connect.js')) throw new Error('FINANCE_WALLET_SCRIPT_BINDING_REGRESSION');

    for (const name of walk(packageRoot)) if (!programs.some(([program]) => program === name)) chmodSync(join(packageRoot, name), 0o644);
    const payloadFiles = walk(packageRoot).map(path => ({
      path,
      bytes: statSync(join(packageRoot, path)).size,
      sha256: sha256(readFileSync(join(packageRoot, path))),
      mode: programs.some(([program]) => program === path) ? '0755' : '0644',
    }));
    const manifest = {
      schemaVersion: 'ynx.finance.weekly-v3-candidate.v1',
      sourceCommit,
      sourceTree,
      toolingCommit,
      toolingScriptSha256: sha256(readFileSync(scriptPath)),
      release,
      buildTime,
      platform: { os: 'linux', arch: 'amd64', cgoEnabled: false, executableFormat: 'ELF64', machine: 'x86-64' },
      frontendSourceCommit: sourceCommit,
      buildCommands: programs.map(([name, pkg]) => commandFor(name, pkg)),
      safetyDefaults: {
        tradingEnvironment: 'sandbox',
        tradingEnabled: false,
        liveEnabled: false,
        sandboxWritesEnabled: false,
        credentialsBundled: false,
        providerReadAttempted: false,
        providerWriteAttempted: false,
      },
      files: payloadFiles,
    };
    writeFileSync(join(packageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
    const names = walk(packageRoot);
    const archiveNames = names.map(name => `${release}/${name}`);
    const tar = `${destination}.tar`;
    mkdirSync(dirname(destination), { recursive: true });
    const gtar = ['/opt/homebrew/bin/gtar', '/usr/local/bin/gtar', 'gtar'].find(candidate => {
      try { execFileSync(candidate, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
    });
    if (!gtar) throw new Error('GNU tar required');
    execFileSync(gtar, ['--sort=name', `--mtime=${buildTime}`, '--owner=0', '--group=0', '--numeric-owner', '--format=gnu', '-cf', tar, '-C', work, ...archiveNames]);
    execFileSync('gzip', ['-n', '-9', tar]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const sourceRoot = mkdtempSync(join(tmpdir(), 'ynx-finance-weekly-v3-source-'));
const first = `${output}.first`;
const second = `${output}.second`;
try {
  rmSync(sourceRoot, { recursive: true, force: true });
  execFileSync('git', ['worktree', 'add', '--detach', sourceRoot, sourceCommit], { cwd: repoRoot, stdio: 'ignore' });
  buildOnce(sourceRoot, first);
  buildOnce(sourceRoot, second);
  const firstBody = readFileSync(`${first}.tar.gz`);
  const secondBody = readFileSync(`${second}.tar.gz`);
  if (!firstBody.equals(secondBody)) throw new Error('FINANCE_WEEKLY_V3_CANDIDATE_NONDETERMINISTIC');
  copyFileSync(`${first}.tar.gz`, output);
  const manifest = {
    schemaVersion: 'ynx.finance.weekly-v3-candidate-sidecar.v1',
    sourceCommit,
    sourceTree,
    toolingCommit,
    release,
    repeatedBuildByteExact: true,
    archive: { path: basename(output), bytes: statSync(output).size, sha256: sha256(readFileSync(output)) },
  };
  writeFileSync(`${output}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
} finally {
  rmSync(`${first}.tar.gz`, { force: true });
  rmSync(`${second}.tar.gz`, { force: true });
  try { execFileSync('git', ['worktree', 'remove', '--force', sourceRoot], { cwd: repoRoot, stdio: 'ignore' }); } catch {}
  rmSync(sourceRoot, { recursive: true, force: true });
}
