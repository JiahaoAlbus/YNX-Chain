import { lstat, realpath, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const developer = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = path => typeof path === 'string' && isAbsolute(path) && resolve(path) === path && !path.includes('\0') && !path.includes('\\');
async function readClaim(output) {
  const path = output + '.build-output.json', stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.nlink !== 1
    || (stat.mode & 0o777) !== 0o600 || await realpath(path) !== path) throw Error('Unsafe build output receipt.');
  const receipt = JSON.parse(await readFile(path));
  if (receipt.schema !== 'ynx-build-output/v1' || receipt.output !== output) throw Error('Build output receipt location differs.');
  return receipt;
}
async function directory(path, privateRoot = false) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path
    || stat.uid !== process.getuid() || (stat.mode & 0o022)
    || (privateRoot && (stat.mode & 0o777) !== 0o700)) throw Error('Build output directory must be canonical, owned and private.');
  return stat;
}
export async function buildOutputRoot(environment = process.env) {
  const external = environment.YNX_DEVELOPER_BUILD_OUTPUT_ROOT;
  const root = external || join(developer, '.ynx-developer-candidates');
  if (!canonical(root)) throw Error('Invalid build output root.');
  if (external) {
    // Require an existing owned parent; never recursively create directories.
    await directory(dirname(root));
    try { await lstat(root); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(root, { mode: 0o700 });
    }
  }
  const stat = await directory(root, !!external);
  return { root, external: !!external, uid: stat.uid, device: stat.dev, inode: stat.ino, mode: stat.mode & 0o777 };
}
export async function verifyBuildOutputIdentity(identity, environment = process.env) {
  const current = await buildOutputRoot(environment);
  if (['root', 'external', 'uid', 'device', 'inode', 'mode'].some(key => current[key] !== identity[key])) throw Error('Build output root identity changed.');
}
export async function assertBuildOutputDirectory(path, environment = process.env, claimedIdentity) {
  const identity = await buildOutputRoot(environment);
  const local = canonical(path) && relative(identity.root, path);
  if (!local || local.startsWith('../') || isAbsolute(local)) throw Error('Build output escaped its admitted root.');
  let current = identity.root;
  for (const part of local.split('/')) { current = join(current, part); await directory(current); }
  if (claimedIdentity) await verifyBuildOutputIdentity(claimedIdentity, environment);
  else if (identity.external) {
    const claim = await readClaim(join(identity.root, local.split('/')[0]));
    await verifyBuildOutputIdentity(claim.identity, environment);
  }
  return identity;
}
export async function claimBuildOutput(path, environment = process.env) {
  const identity = await buildOutputRoot(environment);
  if (!canonical(path) || dirname(path) !== identity.root) throw Error('Use a fresh direct child of the admitted build output root.');
  const git = argument => execFileSync('/usr/bin/git', ['-C', developer, ...argument], { encoding: 'utf8' }).trim();
  const source = { repository: git(['rev-parse', '--show-toplevel']), commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), trackedDirty: !!git(['status', '--porcelain', '--untracked-files=no', '--', ':(top)apps/developer', ':(top)packages/developer-client']) };
  for (const target of [path, path + '.build-output.json']) {
    try { await lstat(target); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw Error('Build output or its receipt already exists.');
  }
  await mkdir(path, { mode: 0o700 }); // EEXIST, including symlinks, is always a refusal.
  await assertBuildOutputDirectory(path, environment, identity);
  await verifyBuildOutputIdentity(identity, environment);
  await writeFile(path + '.build-output.json', JSON.stringify({ schema: 'ynx-build-output/v1', output: path, identity, source, productPermissionsChanged: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return identity;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'root') console.log((await buildOutputRoot()).root);
  else if (process.argv[2] === 'claim') await claimBuildOutput(process.argv[3]);
  else if (process.argv[2] === 'verify') {
    const receipt = await readClaim(process.argv[3]);
    await assertBuildOutputDirectory(process.argv[3], process.env, receipt.identity);
  }
  else throw Error('Expected root or claim.');
}
