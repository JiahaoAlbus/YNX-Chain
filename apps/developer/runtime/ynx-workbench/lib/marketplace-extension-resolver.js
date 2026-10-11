'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
function inspectArchive(handle, size, selection) {
  return new Promise((resolve, reject) => {
    let zip, finished = false, manifest, entries = 0, expanded = 0;
    const names = new Set();
    const finish = error => {
      if (finished) return; finished = true; clearTimeout(timer); zip?.close();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(Error('Extension archive inspection timed out.')), 15000);
    const yauzl = require('yauzl');
    // fromFd owns/closes the supplied descriptor even with autoClose:false.
    // Retain our identity-checked handle through inspection via its mature
    // random-access API; the parser still owns all ZIP decoding and validation.
    class ArtifactReader extends yauzl.RandomAccessReader {
      _readStreamForRange(start, end) {
        let cursor = start, reading = false;
        return new (require('node:stream').Readable)({ read() {
          if (reading) return;
          if (cursor >= end) { this.push(null); return; }
          reading = true; const bytes = Buffer.alloc(Math.min(64 * 1024, end - cursor));
          handle.read(bytes, 0, bytes.length, cursor).then(result => {
            reading = false;
            if (this.destroyed) return;
            if (!result.bytesRead) { this.destroy(Error('Extension archive ended unexpectedly.')); return; }
            cursor += result.bytesRead; this.push(bytes.subarray(0, result.bytesRead));
          }, error => { reading = false; this.destroy(error); });
        } });
      }
      close(callback) { callback(); }
    }
    yauzl.fromRandomAccessReader(new ArtifactReader(), size, { autoClose: false, lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, archive) => {
      if (error) return finish(error);
      zip = archive; if (finished) { zip.close(); return; }
      zip.on('error', finish);
      zip.on('end', () => {
        if (!manifest || manifest.publisher !== selection.namespace || manifest.name !== selection.name || manifest.version !== selection.version)
          return finish(Error('Extension package identity does not match the selected publisher, name and version.'));
        finish();
      });
      zip.on('entry', entry => {
        try {
          const name = entry.fileName, mode = entry.externalFileAttributes >>> 16;
          expanded += entry.uncompressedSize;
          if (++entries > 40000 || expanded > 512 * 1024 * 1024 || entry.uncompressedSize > 128 * 1024 * 1024
            || entry.generalPurposeBitFlag & 1 || (mode & 0o170000) === 0o120000 || mode & 0o7000
            || name.includes('\0') || names.has(name) || name.startsWith('/') || name.split('/').includes('..')) throw Error('Extension archive entry or expanded size refused.');
          names.add(name);
          if (name !== 'extension/package.json') { zip.readEntry(); return; }
          if (entry.uncompressedSize > 1024 * 1024) throw Error('Extension manifest is oversized.');
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError) return finish(streamError);
            let bytes = 0; const chunks = [];
            stream.on('error', finish);
            stream.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) { stream.destroy(); finish(Error('Extension manifest is oversized.')); } else chunks.push(chunk); });
            stream.on('end', () => {
              if (finished) return;
              try { manifest = JSON.parse(new (require('node:util').TextDecoder)('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); zip.readEntry(); }
              catch (parseError) { finish(parseError); }
            });
          });
        } catch (entryError) { finish(entryError); }
      });
      zip.readEntry();
    });
  });
}
async function verifyReceipt(receipt, selection, root = process.env.TMPDIR) {
  if (!receipt || JSON.stringify(receipt.selection) !== JSON.stringify(selection)
    || typeof root !== 'string' || typeof receipt.path !== 'string' || !path.isAbsolute(root)
    || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.bytes)
    || receipt.bytes < 4 || receipt.bytes > 128 * 1024 * 1024) throw Error('Invalid extension download receipt.');
  const relative = path.relative(root, receipt.path);
  if (!relative || path.isAbsolute(relative) || relative.startsWith('..') || !/^extension-[A-Za-z0-9]+\/archive\.vsix$/.test(relative)) throw Error('Extension staging path is outside this session.');
  const rootIdentity = await fs.lstat(root);
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink() || rootIdentity.uid !== process.getuid()
    || rootIdentity.mode & 0o077 || await fs.realpath(root) !== root) throw Error('Extension staging root changed.');
  const parent = await fs.lstat(path.dirname(receipt.path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() || parent.mode & 0o077
    || await fs.realpath(receipt.path) !== receipt.path) throw Error('Extension staging identity changed.');
  const handle = await fs.open(receipt.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const identity = await handle.stat();
    if (!identity.isFile() || identity.uid !== process.getuid() || identity.mode & 0o077
      || identity.dev !== receipt.dev || identity.ino !== receipt.ino || identity.size !== receipt.bytes) throw Error('Extension artifact identity changed.');
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024); let offset = 0;
    while (offset < identity.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, identity.size - offset), offset);
      if (!bytesRead) throw Error('Extension artifact ended before its declared size.');
      digest.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    if (digest.digest('hex') !== receipt.sha256) throw Error('Extension artifact changed before installation.');
    await inspectArchive(handle, identity.size, selection);
    const after = await handle.stat(), current = await fs.lstat(receipt.path);
    if (after.size !== identity.size || after.mtimeMs !== identity.mtimeMs
      || after.ctimeMs !== identity.ctimeMs || current.dev !== identity.dev || current.ino !== identity.ino || current.isSymbolicLink()) throw Error('Extension artifact changed before installation.');
  } finally { await handle.close(); }
  return receipt.path;
}
// Reuse the kernel's API compatibility filter, installed-version checks and
// archive deployer. Only the denied HTTP downloader is replaced by the host pipe.
function connectArtifactResolver(resolver, artifacts) {
  resolver.resolve = async function(context, options) {
    const { VSCodeExtensionUri } = require('@theia/plugin-ext-vscode/lib/common/plugin-vscode-uri');
    const URI = require('@theia/core/lib/common/uri').default;
    const { PluginIdentifiers } = require('@theia/plugin-ext/lib/common/plugin-protocol');
    const id = VSCodeExtensionUri.toId(new URI(context.getOriginId()));
    if (!id) return;
    const version = options?.version || id.version;
    if (!version) throw Error('Select an explicit extension version before installation.');
    const filter = await this.vsxApiFilter();
    const targetPlatform = `${process.platform}-${process.arch}`;
    const extension = await filter.findLatestCompatibleExtension({ extensionId: id.id, extensionVersion: version, includeAllVersions: true, targetPlatform });
    if (!extension || extension.error) throw Error('Selected extension is unavailable or incompatible.');
    if (`${extension.namespace}.${extension.name}`.toLowerCase() !== id.id.toLowerCase() || extension.version !== version) throw Error('Extension selection changed.');
    if (!options?.ignoreOtherVersions && this.hasSameOrNewerVersion(id.id, extension)) return;
    const selection = { namespace: extension.namespace, name: extension.name, version, targetPlatform };
    const receipt = await artifacts.request(selection);
    const artifact = await verifyReceipt(receipt, selection);
    context.addPlugin(PluginIdentifiers.componentsToVersionedId({ publisher: selection.namespace, name: selection.name, version }), artifact);
  };
  return resolver;
}
function artifactResolverClass(Base, artifacts) {
  class SelectedArtifactResolver extends Base {
    constructor() { super(); connectArtifactResolver(this, artifacts); }
  }
  require('@theia/core/shared/inversify').decorate(require('@theia/core/shared/inversify').injectable(), SelectedArtifactResolver);
  return SelectedArtifactResolver;
}
module.exports = { connectArtifactResolver, verifyReceipt, artifactResolverClass };
