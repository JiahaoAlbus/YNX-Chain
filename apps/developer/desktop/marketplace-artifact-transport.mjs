import https from 'node:https';
import { lookup } from 'node:dns';
import { constants } from 'node:fs';
import { lstat, realpath, mkdtemp, open, unlink, rmdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchCatalog, isPublicCatalogAddress } from './marketplace-catalog-transport.mjs';
import { artifactLimits, captureArtifactSelection, resolveSelectedArtifact, captureOfficialArtifactLocation } from './marketplace-artifact-policy.mjs';

const same = (left, right) => left.dev === right.dev && left.ino === right.ino;
const privateDirectory = value => value.isDirectory() && !value.isSymbolicLink() && value.uid === process.getuid() && !(value.mode & 0o077);
// Preserve the catalog-selected publisher/name/version and filename at the hop.
export function officialArtifactRedirect(source, location) {
  let captured;
  try { captured = captureOfficialArtifactLocation(source); }
  catch { throw Error('Official artifact redirect identity rejected.'); }
  const { url: original, targeted, revision, file } = captured;
  const parts = original.pathname.split('/'), target = new URL(location, original);
  const exact = `/${parts.slice(2, revision + 1).join('/')}/${parts[file]}`;
  const flat = `/${parts[2]}/${parts[3]}/${parts[revision]}/${parts[file]}`;
  if (target.origin !== 'https://openvsx.eclipsecontent.org' || target.username || target.password || target.search || target.hash
    || (target.pathname !== exact && (!targeted || target.pathname !== flat))) throw Error('Official artifact redirect identity rejected.');
  return target.href;
}
// Open VSX query filters are exact: an ARM query excludes universal VSIXes.
// Keep the user's selected version; fall back only when that platform has no
// matching row, never after a transport error or ambiguous/invalid metadata.
export async function selectedArtifactMetadata(selection, catalog, signal, assertCurrent) {
  const options = { namespaceName: selection.namespace, extensionName: selection.name,
    extensionVersion: selection.version, targetPlatform: selection.targetPlatform, includeAllVersions: true };
  const metadata = await catalog('query', options, signal);
  if (!metadata || !Array.isArray(metadata.extensions)) throw Error('Selected extension metadata unavailable.');
  if (metadata.extensions.length || selection.targetPlatform === 'universal') return metadata;
  await assertCurrent();
  if (signal?.aborted) throw Error('Extension download cancelled.');
  return catalog('query', { ...options, targetPlatform: 'universal' }, signal);
}
export function createArtifactDownloader({ directory, assertCurrent }, { catalog = fetchCatalog, request = https.request, dnsLookup = lookup } = {}) {
  if (typeof directory !== 'string' || typeof assertCurrent !== 'function') throw Error('Artifact session is not supplied.');
  if (typeof process.getuid !== 'function') throw Error('Extension staging permissions are unsupported on this platform.');
  let active = 0;
  const owned = new Map();
  async function cleanup(job, identity) {
    const current = await lstat(job).catch(() => undefined);
    if (!current || !same(current, identity) || !privateDirectory(current)) return;
    const file = join(job, 'archive.vsix');
    const expected = owned.get(job)?.fileIdentity;
    const actual = await lstat(file).catch(() => undefined);
    if (actual && expected && same(actual, expected) && actual.isFile() && !actual.isSymbolicLink()) await unlink(file);
    await rmdir(job).catch(() => {}); owned.delete(job);
  }
  return {
    async download(value, signal) {
      const selection = captureArtifactSelection(value);
      if (signal?.aborted) throw Error('Extension download cancelled.');
      const retained = [...owned.values()].reduce((sum, entry) => sum + (entry.bytes || 0), 0);
      if (active >= artifactLimits.concurrency || owned.size >= 64 || retained + (active + 1) * artifactLimits.maxBytes > artifactLimits.maxStagingBytes) throw Error('Extension download capacity reached.');
      active++;
      const controller = new AbortController();
      const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, artifactLimits.timeoutMs);
      let job, jobIdentity, handle;
      try {
        await assertCurrent();
        const rootIdentity = await lstat(directory);
        if (!privateDirectory(rootIdentity) || await realpath(directory) !== directory) throw Error('Extension staging identity changed.');
        const capacity = await statfs(directory);
        if (Number(capacity.bavail) * Number(capacity.bsize) < artifactLimits.maxBytes + 32 * 1024 * 1024) throw Error('Insufficient extension staging space.');
        const metadata = await selectedArtifactMetadata(selection, catalog, controller.signal, assertCurrent);
        const artifact = resolveSelectedArtifact(selection, metadata);
        await assertCurrent();
        if (controller.signal.aborted) throw Error('Extension download cancelled.');
        if (!same(await lstat(directory), rootIdentity)) throw Error('Extension staging identity changed.');
        job = await mkdtemp(join(directory, 'extension-')); jobIdentity = await lstat(job);
        if (!privateDirectory(jobIdentity) || await realpath(job) !== job) throw Error('Extension staging identity changed.');
        const path = join(job, 'archive.vsix');
        handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        const fileIdentity = await handle.stat(); owned.set(job, { jobIdentity, fileIdentity });
        let req, response;
        const abort = () => { req?.destroy(Error('Extension download cancelled.')); response?.destroy(Error('Extension download cancelled.')); };
        controller.signal.addEventListener('abort', abort, { once: true });
        let bytes = 0, prefix = Buffer.alloc(0); const digest = createHash('sha256');
        try {
          const requestResponse = url => new Promise((resolve, reject) => {
            const expectedHost = new URL(url).hostname;
            req = request(url, { method: 'GET', headers: { Accept: 'application/octet-stream' }, agent: false, rejectUnauthorized: true,
              lookup(hostname, options, callback) {
                if (hostname !== expectedHost || !['open-vsx.org', 'openvsx.eclipsecontent.org'].includes(hostname)) return callback(Error('Artifact host rejected.'));
                dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
                  if (error) return callback(error);
                  if (controller.signal.aborted || !addresses?.length || addresses.some(row => !isPublicCatalogAddress(row.address))) return callback(Error('Artifact address rejected.'));
                  if (options.all) callback(null, addresses); else callback(null, addresses[0].address, addresses[0].family);
                });
              },
            }, resolve);
            req.once('error', reject); req.end(); if (controller.signal.aborted) abort();
          });
          response = await requestResponse(artifact.url);
          if (response.statusCode === 302) {
            const target = officialArtifactRedirect(artifact.url, response.headers.location);
            response.destroy();
            await assertCurrent();
            if (controller.signal.aborted) throw Error('Extension download cancelled.');
            response = await requestResponse(target);
          }
          // No loop: a second redirect is an error, including back to origin.
          if (response.statusCode !== 200 || !/^(application\/(octet-stream|zip|vsix))(?:\s*;|$)/i.test(response.headers['content-type'] || '')
            || Number(response.headers['content-length']) > artifactLimits.maxBytes || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
            throw Error('Selected artifact response rejected; redirects are not approved.');
          }
          for await (const chunk of response) {
            if (controller.signal.aborted) throw Error('Extension download cancelled.');
            bytes += chunk.length;
            if (bytes > artifactLimits.maxBytes) throw Error('Selected artifact exceeds the download limit.');
            if (prefix.length < 4) prefix = Buffer.concat([prefix, chunk]).subarray(0, 4);
            digest.update(chunk);
            let offset = 0;
            while (offset < chunk.length) {
              const written = await handle.write(chunk, offset, chunk.length - offset);
              if (!written.bytesWritten) throw Error('Extension staging write failed.');
              offset += written.bytesWritten;
            }
          }
          const declared = response.headers['content-length'];
          if (bytes < 4 || !prefix.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || (declared !== undefined && Number(declared) !== bytes)) throw Error('Selected artifact is incomplete or is not an archive.');
          await handle.sync(); await handle.close(); handle = undefined;
          await assertCurrent();
          if (controller.signal.aborted || !same(await lstat(directory), rootIdentity) || !same(await lstat(job), jobIdentity)
            || !same(await lstat(path), fileIdentity) || await realpath(path) !== path) throw Error('Extension staging identity changed.');
          owned.get(job).bytes = bytes;
          return { selection, path, sha256: digest.digest('hex'), bytes, dev: fileIdentity.dev, ino: fileIdentity.ino };
        } finally { controller.signal.removeEventListener('abort', abort); req?.destroy(); response?.destroy(); }
      } catch (error) {
        await handle?.close().catch(() => {}); handle = undefined;
        if (job && jobIdentity) await cleanup(job, jobIdentity);
        throw error;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); active--; }
    },
    async cleanup() { for (const [job, identity] of [...owned]) await cleanup(job, identity.jobIdentity); },
  };
}
