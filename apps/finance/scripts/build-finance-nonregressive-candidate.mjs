#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preservedFrontendSource, runtimeFiles, sha256, validateBuildIdentity, validatePreservedFrontend } from './finance-nonregressive-runtime.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: scriptDir, encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error(`missing ${name}`); return args[i + 1]; };
const sourceCommit = value('--source');
const output = value('--output');
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('source must be lowercase 40-hex');
execFileSync('git', ['cat-file', '-e', `${sourceCommit}^{commit}`], { cwd: repoRoot });
if (execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()) throw new Error('worktree must be clean');
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim() !== sourceCommit) throw new Error('source must equal HEAD');
const buildTime = new Date(execFileSync('git', ['show', '-s', '--format=%cI', sourceCommit], { cwd: repoRoot, encoding: 'utf8' }).trim()).toISOString();
const release = `ynx-finance-${sourceCommit.slice(0, 12)}`;
const identity = { sourceCommit, release, buildTime, frontendSourceCommit: preservedFrontendSource };
validateBuildIdentity(identity, identity);

function walk(root, path = root) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const full = join(path, entry.name);
    return entry.isDirectory() ? walk(root, full) : [relative(root, full)];
  }).sort();
}
function buildOnce(destination) {
  const work = mkdtempSync(join(tmpdir(), 'ynx-finance-build-'));
  const releaseRoot = join(work, release);
  const webRoot = join(releaseRoot, 'web');
  mkdirSync(webRoot, { recursive: true, mode: 0o755 });
  const built = spawnSync('go', ['build', '-buildvcs=false', '-trimpath', '-ldflags', `-s -w -buildid= -X main.buildCommit=${sourceCommit} -X main.buildRelease=${release} -X main.buildTime=${buildTime}`, '-o', join(releaseRoot, 'ynx-finance'), './apps/finance/cmd/server'], { cwd: repoRoot, env: { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' }, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`${built.stdout}${built.stderr}`);
  chmodSync(join(releaseRoot, 'ynx-finance'), 0o755);
  for (const name of runtimeFiles) copyFileSync(join(repoRoot, 'apps/finance/web', name), join(webRoot, name));
  writeFileSync(join(webRoot, 'build-identity.json'), `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o644 });
  validatePreservedFrontend(webRoot);
  validateBuildIdentity(JSON.parse(readFileSync(join(webRoot, 'build-identity.json'), 'utf8')), identity);
  for (const name of walk(releaseRoot)) if (name !== 'ynx-finance') chmodSync(join(releaseRoot, name), 0o644);
  const sums = walk(releaseRoot).filter(name => name !== 'SHA256SUMS').map(name => `${sha256(readFileSync(join(releaseRoot, name)))}  ${name}`).join('\n');
  writeFileSync(join(releaseRoot, 'SHA256SUMS'), `${sums}\n`, { mode: 0o644 });
  const tar = `${destination}.tar`;
  mkdirSync(dirname(destination), { recursive: true });
  const gtar = ['/opt/homebrew/bin/gtar', '/usr/local/bin/gtar', 'gtar'].find(candidate => {
    try { execFileSync(candidate, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
  });
  if (!gtar) throw new Error('GNU tar required');
  execFileSync(gtar, ['--sort=name', `--mtime=${buildTime}`, '--owner=0', '--group=0', '--numeric-owner', '--format=gnu', '-cf', tar, '-C', work, release]);
  execFileSync('gzip', ['-n', '-9', tar]);
  rmSync(work, { recursive: true, force: true });
}
const first = `${output}.first`;
const second = `${output}.second`;
buildOnce(first); buildOnce(second);
const firstBody = readFileSync(`${first}.tar.gz`);
const secondBody = readFileSync(`${second}.tar.gz`);
if (!firstBody.equals(secondBody)) throw new Error('FINANCE_CANDIDATE_ARCHIVE_NONDETERMINISTIC');
copyFileSync(`${first}.tar.gz`, output);
rmSync(`${first}.tar.gz`); rmSync(`${second}.tar.gz`);
const manifest = { schemaVersion: 'financeNonregressiveCandidate@1', sourceCommit, release, buildTime, frontendSourceCommit: preservedFrontendSource, archive: { path: basename(output), bytes: statSync(output).size, sha256: sha256(readFileSync(output)) } };
writeFileSync(`${output}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
