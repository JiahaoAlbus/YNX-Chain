import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeCanonicalJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, canonicalJSON(value), { mode: 0o644 });
}

export function walkFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`release input must not contain symlinks: ${full}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
      else throw new Error(`unsupported release input type: ${full}`);
    }
  };
  visit(root);
  return files;
}

export function relativePosix(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

export function assertSafeOutputDirectory(outputDirectory, allowedRoot) {
  fs.mkdirSync(allowedRoot, { recursive: true });
  const canonicalRoot = fs.realpathSync(allowedRoot);
  const resolvedOutput = path.resolve(outputDirectory);
  const relative = path.relative(path.resolve(allowedRoot), resolvedOutput);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Shop release output must be a child of ${allowedRoot}`);
  }
  let current = path.resolve(allowedRoot);
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Shop release output path must not contain symlinks: ${current}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const canonicalParent = fs.realpathSync(nearestExistingDirectory(path.dirname(resolvedOutput)));
  if (canonicalParent !== canonicalRoot && !canonicalParent.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`Shop release output resolves outside ${allowedRoot}`);
  }
  return resolvedOutput;
}

function nearestExistingDirectory(input) {
  let current = input;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`no existing parent for release output: ${input}`);
    current = parent;
  }
  if (!fs.statSync(current).isDirectory()) throw new Error(`release output parent is not a directory: ${current}`);
  return current;
}

function splitTarPath(input) {
  const nameBytes = Buffer.byteLength(input);
  if (nameBytes <= 100) return { name: input, prefix: '' };
  for (let index = input.length - 1; index > 0; index -= 1) {
    if (input[index] !== '/') continue;
    const prefix = input.slice(0, index);
    const name = input.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`tar path is too long: ${input}`);
}

function writeString(buffer, offset, length, value) {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length > length) throw new Error(`tar field is too long: ${value}`);
  encoded.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid tar numeric field: ${value}`);
  const body = value.toString(8);
  if (body.length > length - 1) throw new Error(`tar numeric field overflow: ${value}`);
  writeString(buffer, offset, length, `${body.padStart(length - 1, '0')}\0`);
}

function tarHeader(entry, epochSeconds) {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitTarPath(entry.path);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.body.length);
  writeOctal(header, 136, 12, epochSeconds);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'root');
  writeString(header, 297, 32, 'root');
  writeString(header, 345, 155, prefix);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

export function createDeterministicTar(entries, epochSeconds) {
  if (!Number.isSafeInteger(epochSeconds) || epochSeconds < 0) throw new Error('epochSeconds must be a non-negative integer');
  const normalized = entries.map((entry) => ({
    path: entry.path.split(path.sep).join('/'),
    mode: entry.mode ?? 0o644,
    body: Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body),
  })).sort((a, b) => a.path.localeCompare(b.path));
  const seen = new Set();
  const chunks = [];
  for (const entry of normalized) {
    validateArchivePath(entry.path);
    if (seen.has(entry.path)) throw new Error(`duplicate tar path: ${entry.path}`);
    seen.add(entry.path);
    chunks.push(tarHeader(entry, epochSeconds), entry.body);
    const padding = (512 - (entry.body.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

function parseOctal(field) {
  const value = field.toString('ascii').replace(/\0.*$/s, '').trim();
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) throw new Error(`invalid tar octal field: ${JSON.stringify(value)}`);
  return Number.parseInt(value, 8);
}

function readTarString(buffer, offset, length) {
  const field = buffer.subarray(offset, offset + length);
  const zero = field.indexOf(0);
  return field.subarray(0, zero < 0 ? field.length : zero).toString('utf8');
}

function validateArchivePath(value) {
  if (!value || value.startsWith('/') || value.includes('\\')) throw new Error(`unsafe archive path: ${value}`);
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '..' || normalized.startsWith('../')) throw new Error(`unsafe archive path: ${value}`);
}

export function parseTar(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('tar input must be a Buffer');
  const entries = [];
  const seen = new Set();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const storedChecksum = parseOctal(header.subarray(148, 156));
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    let actualChecksum = 0;
    for (const byte of checksumHeader) actualChecksum += byte;
    if (storedChecksum !== actualChecksum) throw new Error(`tar checksum mismatch at offset ${offset}`);
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    validateArchivePath(entryPath);
    if (seen.has(entryPath)) throw new Error(`duplicate tar path: ${entryPath}`);
    seen.add(entryPath);
    const size = parseOctal(header.subarray(124, 136));
    const mode = parseOctal(header.subarray(100, 108));
    const mtime = parseOctal(header.subarray(136, 148));
    const type = String.fromCharCode(header[156] || 48);
    if (type !== '0' && type !== '\0') throw new Error(`unsupported tar entry type ${JSON.stringify(type)} for ${entryPath}`);
    const dataOffset = offset + 512;
    const dataEnd = dataOffset + size;
    if (dataEnd > buffer.length) throw new Error(`truncated tar entry: ${entryPath}`);
    entries.push({ path: entryPath, mode, mtime, body: buffer.subarray(dataOffset, dataEnd), dataOffset });
    offset = dataOffset + Math.ceil(size / 512) * 512;
  }
  if (buffer.length - offset < 1024) throw new Error('tar archive is missing the two-block terminator');
  return entries;
}

const forbiddenArchivePatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:state|wallet|keystore|credentials?)(?:\.|$)/i,
  /\.(?:apk|aab|ipa|jks|p12|pfx|pem|key)$/i,
  /(?:private[-_.]?key|secret|password|token)/i,
];

function assertNoForbiddenArchivePath(entryPath) {
  for (const pattern of forbiddenArchivePatterns) {
    if (pattern.test(entryPath)) throw new Error(`forbidden release path: ${entryPath}`);
  }
}

export function verifyShopPackageOutput(outputDirectory, archiveOverride = null) {
  const indexPath = path.join(outputDirectory, 'artifact-index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  if (index.schema !== 'ynx-shop-artifact-index/v1') throw new Error('unexpected Shop artifact index schema');
  if (!/^[0-9a-f]{40}$/.test(index.sourceCommit)) throw new Error('invalid source commit in artifact index');
  if (index.productionSigned !== false || index.deployedPublic !== false || index.remotePublicProof !== false) {
    throw new Error('local artifact index contains a false production/public claim');
  }
  const archivePath = path.join(outputDirectory, index.archive.file);
  const archive = archiveOverride ?? fs.readFileSync(archivePath);
  if (sha256(archive) !== index.archive.sha256) throw new Error('Shop archive SHA-256 mismatch');
  if (archive.length !== index.archive.bytes) throw new Error('Shop archive byte length mismatch');
  const entries = parseTar(archive);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const metadataRoot = `${index.packageRoot}/metadata`;
  const manifestEntry = byPath.get(`${metadataRoot}/release-manifest.json`);
  const sbomEntry = byPath.get(`${metadataRoot}/sbom.cdx.json`);
  const provenanceEntry = byPath.get(`${metadataRoot}/provenance.intoto.jsonl`);
  if (!manifestEntry || !sbomEntry || !provenanceEntry) throw new Error('Shop archive is missing release metadata');
  const manifest = JSON.parse(manifestEntry.body.toString('utf8'));
  const sbom = JSON.parse(sbomEntry.body.toString('utf8'));
  const provenance = JSON.parse(provenanceEntry.body.toString('utf8').trim());
  if (manifest.schema !== 'ynx-shop-release-manifest/v1' || manifest.sourceCommit !== index.sourceCommit) throw new Error('release manifest source identity mismatch');
  if (manifest.productionSigned !== false || manifest.deployedStaging !== false || manifest.deployedPublic !== false) throw new Error('release manifest contains a false release claim');
  if (sbom.bomFormat !== 'CycloneDX' || sbom.metadata?.properties?.find((property) => property.name === 'sourceCommit')?.value !== index.sourceCommit) {
    throw new Error('SBOM source identity mismatch');
  }
  if (provenance._type !== 'https://in-toto.io/Statement/v1' || provenance.predicate?.buildDefinition?.externalParameters?.sourceCommit !== index.sourceCommit) {
    throw new Error('provenance source identity mismatch');
  }
  const expected = new Set([
    `${metadataRoot}/release-manifest.json`,
    `${metadataRoot}/sbom.cdx.json`,
    `${metadataRoot}/provenance.intoto.jsonl`,
  ]);
  for (const file of manifest.files) {
    const fullPath = `${index.packageRoot}/${file.path}`;
    expected.add(fullPath);
    const entry = byPath.get(fullPath);
    if (!entry) throw new Error(`manifest file missing from Shop archive: ${file.path}`);
    if (entry.body.length !== file.bytes || sha256(entry.body) !== file.sha256) throw new Error(`manifest digest mismatch: ${file.path}`);
    if (entry.mode !== file.mode) throw new Error(`manifest mode mismatch: ${file.path}`);
  }
  for (const entry of entries) {
    assertNoForbiddenArchivePath(entry.path);
    if (!expected.has(entry.path)) throw new Error(`unlisted Shop archive entry: ${entry.path}`);
    if (entry.mtime !== index.sourceDateEpoch) throw new Error(`non-deterministic mtime for ${entry.path}`);
  }
  if (entries.length !== expected.size) throw new Error('Shop archive entry count mismatch');
  for (const subject of provenance.subject ?? []) {
    const file = manifest.files.find((candidate) => candidate.path === subject.name);
    if (!file || subject.digest?.sha256 !== file.sha256) throw new Error(`provenance subject mismatch: ${subject.name}`);
  }
  return { index, manifest, sbom, provenance, entries };
}
