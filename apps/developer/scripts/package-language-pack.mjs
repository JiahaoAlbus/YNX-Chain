import { lstat, realpath, open, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const LIMITS = Object.freeze({ files: 256, fileBytes: 8 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, manifestBytes: 256 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);
function resourcePath(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('\0') || isAbsolute(value)) throw Error('Invalid language resource path.');
  const result = value.replace(/^\.\//, '');
  if (!result || result.split('/').some(part => !part || part === '.' || part === '..') || !result.endsWith('.json')) throw Error('Invalid language resource path.');
  return result;
}
async function directory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw Error('Use canonical regular language-pack directories without symlinks.');
}
async function input(root, name, limit = LIMITS.fileBytes) {
  const path = join(root, name);
  const local = relative(root, path);
  if (!local || local.startsWith('../') || isAbsolute(local)) throw Error('Language resource escapes its package.');
  for (let parent = dirname(path); parent !== root; parent = dirname(parent)) await directory(parent);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw Error('Language resource must be a bounded regular file without symlinks.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const before = await handle.stat();
    if (!before.isFile() || !same(stat, before)) throw Error('Language resource changed before reading.');
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length !== before.size || !same(before, await handle.stat())) throw Error('Language resource changed during reading.');
    bytes = Buffer.from(buffer.subarray(0, length));
  } finally { await handle.close(); }
  if (!same(stat, await lstat(path))) throw Error('Language resource changed during reading.');
  for (let parent = dirname(path); parent !== root; parent = dirname(parent)) await directory(parent);
  return { path: name, bytes, stat, sha256: hash(bytes) };
}
export function mapTranslations(id, json) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id) || !object(json) || !object(json.contents)) throw Error('Invalid language translation contents.');
  const result = Object.create(null);
  for (const [scope, values] of Object.entries(json.contents)) {
    if (!scope || !object(values)) throw Error('Invalid language translation scope.');
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'string') throw Error('Language translations must contain strings.');
      // Same contract as retained HostedPluginLocalizationService / Localization.transformKey.
      result[`${id}/${scope.slice(scope.lastIndexOf('/') + 1)}/${key}`] = value;
    }
  }
  return result;
}

// Explicit existing input only: no profile discovery, registry request, install,
// lifecycle execution or host code copying. Destination is a new plugin folder.
export async function packageLanguagePack(sourceDirectory, destinationDirectory) {
  if (!sourceDirectory || !destinationDirectory) throw Error('Provide explicit language-pack source and new destination directories.');
  const source = resolve(sourceDirectory), target = resolve(destinationDirectory);
  await directory(source); await directory(dirname(target));
  if (target === source || target.startsWith(source + '/') || source.startsWith(target + '/')) throw Error('Input and output directories must be disjoint.');
  try { await lstat(target); throw Error('Language-pack destination already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const manifestInput = await input(source, 'package.json', LIMITS.manifestBytes), manifest = JSON.parse(manifestInput.bytes);
  if (manifest.publisher?.toLowerCase() !== 'ms-ceintl' || manifest.name !== 'vscode-language-pack-zh-hans' || typeof manifest.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][a-zA-Z0-9.-]+)?$/.test(manifest.version) || !object(manifest.engines) || typeof manifest.engines.vscode !== 'string') throw Error('Expected the retained official simplified Chinese language pack.');
  if (manifest.main || manifest.browser || manifest.activationEvents?.length || Object.keys(manifest.contributes || {}).some(key => key !== 'localizations')) throw Error('Only a data-only language-pack manifest is admitted.');
  if (manifest.license !== 'SEE MIT LICENSE IN LICENSE.md' && manifest.license !== 'MIT') throw Error('The retained language pack must declare its MIT license.');
  const license = await input(source, 'LICENSE.md', LIMITS.manifestBytes);
  if (!license.bytes.toString('utf8').includes('Permission is hereby granted, free of charge') || !license.bytes.toString('utf8').includes('Microsoft Corporation')) throw Error('Original Microsoft MIT license required.');
  const localizations = manifest.contributes?.localizations;
  if (!Array.isArray(localizations) || localizations.length !== 1 || localizations[0].languageId !== 'zh-cn' || !Array.isArray(localizations[0].translations) || !localizations[0].translations.length) throw Error('Invalid simplified Chinese localization contribution.');
  if (localizations[0].translations.length > LIMITS.files - 2) throw Error('Language-pack resource count exceeds its bound.');
  const resources = new Map([['package.json', manifestInput], ['LICENSE.md', license]]), ids = new Set();
  let total = manifestInput.bytes.length + license.bytes.length;
  for (const translation of localizations[0].translations) {
    if (!object(translation) || typeof translation.id !== 'string' || ids.has(translation.id)) throw Error('Invalid or duplicate translation identity.');
    ids.add(translation.id);
    const name = resourcePath(translation.path);
    if (!resources.has(name)) {
      if (resources.size >= LIMITS.files) throw Error('Language-pack resource count exceeds its bound.');
      const resource = await input(source, name);
      total += resource.bytes.length;
      if (total > LIMITS.totalBytes) throw Error('Language-pack source exceeds its byte bound.');
      resources.set(name, resource);
    }
    mapTranslations(translation.id, JSON.parse(resources.get(name).bytes));
  }
  if (!ids.has('vscode')) throw Error('The language pack must provide the VS Code workbench translations.');
  const files = [...resources.values()].map(({ path, bytes, sha256 }) => ({ path, bytes: bytes.length, sha256 })).sort((a, b) => a.path.localeCompare(b.path));
  const receipt = { schemaVersion: 1, extensionId: `${manifest.publisher.toLowerCase()}.${manifest.name}`, version: manifest.version, license: manifest.license,
    sourceDirectory: source, languageId: 'zh-cn', engines: manifest.engines, files, sourceSha256: hash(Buffer.from(JSON.stringify(files))),
    executableCodeCopied: false, lifecycleScriptsExecuted: false, installedOrActivated: false, completeTranslationVerified: false };
  const temporary = join(dirname(target), `.language-pack-${randomUUID()}`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    for (const resource of resources.values()) {
      const destination = join(temporary, resource.path); await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, resource.bytes, { flag: 'wx', mode: 0o600 });
      if ((await input(temporary, resource.path)).sha256 !== resource.sha256) throw Error('Packaged language resource failed its hash verification.');
    }
    // Re-read every admitted resource before publishing: no mixed mutable source snapshot.
    await directory(source);
    for (const resource of resources.values()) {
      const current = await input(source, resource.path, resource.path === 'package.json' || resource.path === 'LICENSE.md' ? LIMITS.manifestBytes : LIMITS.fileBytes);
      if (!same(resource.stat, current.stat) || resource.sha256 !== current.sha256) throw Error('Language-pack source changed during packaging.');
    }
    await writeFile(join(temporary, 'language-pack-inputs.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    // A racing destination must not be overwritten, including an empty directory.
    await mkdir(target, { mode: 0o700 });
    try { for (const name of [...new Set([...resources.keys()].map(name => name.split('/')[0])), 'language-pack-inputs.json']) await rename(join(temporary, name), join(target, name)); }
    catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
    return receipt;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, destination, ...extra] = process.argv.slice(2);
  if (extra.length) throw Error('Use package-language-pack.mjs SOURCE_DIRECTORY NEW_PLUGIN_DIRECTORY.');
  console.log(JSON.stringify(await packageLanguagePack(source, destination), null, 2));
}
