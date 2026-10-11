import https from 'node:https';
import { lookup } from 'node:dns';
import { constants } from 'node:fs';
import { lstat, realpath, mkdtemp, open, unlink, rmdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchCatalog, isPublicCatalogAddress } from './marketplace-catalog-transport.mjs';
import { artifactLimits, captureArtifactSelection, resolveSelectedArtifact } from './marketplace-artifact-policy.mjs';

const same = (left, right) => left.dev === right.dev && left.ino === right.ino;
const privateDirectory = value => value.isDirectory() && !value.isSymbolicLink() && value.uid === process.getuid() && !(value.mode & 0o077);
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
        const metadata = await catalog('query', { namespaceName: selection.namespace, extensionName: selection.name,
          extensionVersion: selection.version, targetPlatform: selection.targetPlatform, includeAllVersions: true }, controller.signal);
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
          response = await new Promise((resolve, reject) => {
            req = request(artifact.url, { method: 'GET', headers: { Accept: 'application/octet-stream' }, agent: false, rejectUnauthorized: true,
              lookup(hostname, options, callback) {
                if (hostname !== 'open-vsx.org') return callback(Error('Artifact host rejected.'));
                dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
                  if (error) return callback(error);
                  if (controller.signal.aborted || !addresses?.length || addresses.some(row => !isPublicCatalogAddress(row.address))) return callback(Error('Artifact address rejected.'));
                  if (options.all) callback(null, addresses); else callback(null, addresses[0].address, addresses[0].family);
                });
              },
            }, incoming => {
              if (incoming.statusCode !== 200 || !/^(application\/(octet-stream|zip|vsix))(?:\s*;|$)/i.test(incoming.headers['content-type'] || '')
                || Number(incoming.headers['content-length']) > artifactLimits.maxBytes || (incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity')) {
                incoming.destroy(); reject(Error('Selected artifact response rejected; redirects are not approved.')); return;
              }
              resolve(incoming);
            });
            req.once('error', reject); req.end(); if (controller.signal.aborted) abort();
          });
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
