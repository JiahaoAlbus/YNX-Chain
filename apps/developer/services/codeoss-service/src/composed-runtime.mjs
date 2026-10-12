import { createHash } from 'node:crypto';
import { readFile, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fault } from './central-identity.mjs';

const keys = 'architecture,kind,lockSha256,manifestSha256,treeSha256,version';
export function validateRuntimeArtifact(value) {
  if (!value || Object.keys(value).sort().join(',') !== keys || value.kind !== 'ynx-theia' || value.version !== '1.76.0' ||
      !/^(linux|darwin|win32)-(x64|arm64)$/.test(value.architecture || '') ||
      !['lockSha256', 'manifestSha256', 'treeSha256'].every(key => /^[a-f0-9]{64}$/.test(value[key] || '')))
    throw new TypeError('An exact reviewed YNX composed runtime artifact is required.');
  return Object.freeze({ ...value });
}
export function sameRuntimeArtifact(left, right) {
  return Boolean(left && right && Object.keys(left).sort().join(',') === keys &&
    Object.keys(right).sort().join(',') === keys && Object.keys(right).every(key => left[key] === right[key]));
}
export async function composedTreeDigest(root) {
  const hash = createHash('sha256'); let files = 0;
  async function walk(relative = '') {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      if (path === 'YNX-COMPOSED-RUNTIME.json') continue;
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || ++files > 100000)
        throw fault('Composed runtime contains an unsupported entry.', 'core_artifact_invalid', 503);
      if (stat.isDirectory()) { hash.update(`directory:${path}\n`); await walk(path); }
      else {
        if (stat.size > 128 * 1024 * 1024) throw fault('Composed runtime file exceeds its limit.', 'core_artifact_invalid', 503);
        hash.update(`file:${path}:${stat.mode & 0o777}:${createHash('sha256').update(await readFile(join(root, path))).digest('hex')}\n`);
      }
    }
  }
  await walk(); return hash.digest('hex');
}
export async function verifyComposedRuntime(root, expected) {
  expected = validateRuntimeArtifact(expected);
  const path = join(root, 'YNX-COMPOSED-RUNTIME.json'), stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw fault('Composed runtime manifest is invalid.', 'core_artifact_invalid', 503);
  const bytes = await readFile(path), manifest = JSON.parse(bytes);
  if (createHash('sha256').update(bytes).digest('hex') !== expected.manifestSha256 ||
      manifest.kind !== expected.kind || manifest.version !== expected.version || manifest.architecture !== expected.architecture ||
      manifest.lockSha256 !== expected.lockSha256 || manifest.treeSha256 !== expected.treeSha256 ||
      manifest.entry !== 'lib/backend/main.js' || manifest.frontend !== 'lib/frontend/index.html' ||
      createHash('sha256').update(await readFile(join(root, 'package-lock.json'))).digest('hex') !== expected.lockSha256 ||
      await composedTreeDigest(root) !== expected.treeSha256)
    throw fault('Composed runtime no longer matches the reviewed artifact.', 'core_artifact_invalid', 503);
  return manifest;
}
