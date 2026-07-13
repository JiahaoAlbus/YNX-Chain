import crypto from "node:crypto";
import zlib from "node:zlib";

export const SDK_RELEASE_SCHEMA = "ynx-sdk-release/v1";
export const SDK_RELEASE_STATUS = "local-package-ready; not registry-published";
const MAX_ARCHIVE_OUTPUT_BYTES = 16 * 1024 * 1024;
export const SDK_CHAIN = Object.freeze({
  addressFormats: ["0x", "ynx1"],
  cosmosChainId: "ynx_6423-1",
  evmChainIdDecimal: 6423,
  evmChainIdHex: "0x1917",
  nativeCurrency: "YNXT",
  restChainId: 6423,
});

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function canonicalJSON(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function createDeterministicTarGz(entries) {
  const ordered = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  const seen = new Set();
  const blocks = [];
  for (const entry of ordered) {
    validateArchivePath(entry.path);
    if (seen.has(entry.path)) throw new Error(`duplicate archive path: ${entry.path}`);
    seen.add(entry.path);
    const body = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    blocks.push(createTarHeader(entry.path, body.length), body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  const compressed = zlib.gzipSync(Buffer.concat(blocks), {
    level: 9,
    mtime: 0,
    strategy: zlib.constants.Z_FIXED,
  });
  compressed[9] = 255;
  return compressed;
}

export function readDeterministicTarGz(compressed) {
  const tar = zlib.gunzipSync(compressed, {maxOutputLength: MAX_ARCHIVE_OUTPUT_BYTES});
  if (tar.length % 512 !== 0) throw new Error("tar payload is not block aligned");
  const entries = [];
  const seen = new Set();
  let offset = 0;
  let foundEnd = false;
  while (offset < tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (offset + 1024 > tar.length || !tar.subarray(offset, offset + 1024).every((byte) => byte === 0)) {
        throw new Error("tar payload is missing its second zero end block");
      }
      if (!tar.subarray(offset).every((byte) => byte === 0)) throw new Error("tar payload has data after its end marker");
      foundEnd = true;
      break;
    }
    validateTarChecksum(header);
    if (readString(header, 257, 6) !== "ustar") throw new Error("archive entry is not ustar");
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    validateArchivePath(entryPath);
    if (seen.has(entryPath)) throw new Error(`duplicate archive path: ${entryPath}`);
    seen.add(entryPath);
    const type = String.fromCharCode(header[156]);
    if (type !== "\0" && type !== "0") throw new Error(`archive entry is not a regular file: ${entryPath}`);
    const size = readOctal(header, 124, 12, "size");
    const mode = readOctal(header, 100, 8, "mode");
    const mtime = readOctal(header, 136, 12, "mtime");
    if (mode !== 0o644) throw new Error(`archive entry mode is not 0644: ${entryPath}`);
    if (mtime !== 0) throw new Error(`archive entry mtime is not zero: ${entryPath}`);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) throw new Error(`archive entry exceeds payload: ${entryPath}`);
    entries.push({path: entryPath, data: Buffer.from(tar.subarray(bodyStart, bodyEnd))});
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  if (!foundEnd) throw new Error("tar payload is missing its end marker");
  return entries;
}

export function createDeterministicZip(entries) {
  const ordered = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  const localParts = [];
  const centralParts = [];
  const seen = new Set();
  let localOffset = 0;
  for (const entry of ordered) {
    validateArchivePath(entry.path);
    if (seen.has(entry.path)) throw new Error(`duplicate archive path: ${entry.path}`);
    seen.add(entry.path);
    const name = Buffer.from(entry.path);
    const body = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const checksum = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 * 65536) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + body.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(ordered.length, 8);
  end.writeUInt16LE(ordered.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function readDeterministicZip(body) {
  if (body.length > MAX_ARCHIVE_OUTPUT_BYTES) throw new Error("ZIP artifact exceeds the verification size limit");
  if (body.length < 22 || body.readUInt32LE(body.length - 22) !== 0x06054b50) throw new Error("ZIP end record is missing");
  const endOffset = body.length - 22;
  if (body.readUInt16LE(endOffset + 4) !== 0 || body.readUInt16LE(endOffset + 6) !== 0 || body.readUInt16LE(endOffset + 20) !== 0) {
    throw new Error("ZIP must be single-disk and comment-free");
  }
  const count = body.readUInt16LE(endOffset + 10);
  if (body.readUInt16LE(endOffset + 8) !== count) throw new Error("ZIP entry counts differ");
  const centralSize = body.readUInt32LE(endOffset + 12);
  const centralOffset = body.readUInt32LE(endOffset + 16);
  if (centralOffset + centralSize !== endOffset) throw new Error("ZIP central directory boundary mismatch");
  const entries = [];
  const seen = new Set();
  let offset = centralOffset;
  let expectedLocalOffset = 0;
  let priorPath = "";
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > endOffset || body.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP central entry is invalid");
    const madeBy = body.readUInt16LE(offset + 4);
    const flags = body.readUInt16LE(offset + 8);
    const method = body.readUInt16LE(offset + 10);
    const time = body.readUInt16LE(offset + 12);
    const date = body.readUInt16LE(offset + 14);
    const checksum = body.readUInt32LE(offset + 16);
    const compressedSize = body.readUInt32LE(offset + 20);
    const size = body.readUInt32LE(offset + 24);
    const nameLength = body.readUInt16LE(offset + 28);
    const extraLength = body.readUInt16LE(offset + 30);
    const commentLength = body.readUInt16LE(offset + 32);
    const disk = body.readUInt16LE(offset + 34);
    const externalAttributes = body.readUInt32LE(offset + 38);
    const localEntryOffset = body.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const entryPath = body.subarray(nameStart, nameStart + nameLength).toString("utf8");
    validateArchivePath(entryPath);
    if (seen.has(entryPath)) throw new Error(`duplicate archive path: ${entryPath}`);
    if (priorPath && priorPath.localeCompare(entryPath) >= 0) throw new Error("ZIP entries are not in canonical path order");
    priorPath = entryPath;
    seen.add(entryPath);
    if ((madeBy >> 8) !== 3 || flags !== 0 || method !== 0 || time !== 0 || date !== 0x21 || compressedSize !== size || extraLength !== 0 || commentLength !== 0 || disk !== 0) {
      throw new Error(`ZIP entry is not canonical: ${entryPath}`);
    }
    const mode = externalAttributes >>> 16;
    if ((mode & 0o170000) !== 0o100000 || (mode & 0o777) !== 0o644) throw new Error(`ZIP entry is not a regular mode-0644 file: ${entryPath}`);
    if (localEntryOffset !== expectedLocalOffset || body.readUInt32LE(localEntryOffset) !== 0x04034b50) throw new Error(`ZIP local entry offset mismatch: ${entryPath}`);
    const localNameLength = body.readUInt16LE(localEntryOffset + 26);
    const localExtraLength = body.readUInt16LE(localEntryOffset + 28);
    if (
      body.readUInt16LE(localEntryOffset + 4) !== 20 ||
      body.readUInt16LE(localEntryOffset + 6) !== flags ||
      body.readUInt16LE(localEntryOffset + 8) !== method ||
      body.readUInt16LE(localEntryOffset + 10) !== time ||
      body.readUInt16LE(localEntryOffset + 12) !== date ||
      body.readUInt32LE(localEntryOffset + 14) !== checksum ||
      body.readUInt32LE(localEntryOffset + 18) !== compressedSize ||
      body.readUInt32LE(localEntryOffset + 22) !== size ||
      localExtraLength !== 0
    ) {
      throw new Error(`ZIP local entry is not canonical: ${entryPath}`);
    }
    const localNameStart = localEntryOffset + 30;
    const localName = body.subarray(localNameStart, localNameStart + localNameLength).toString("utf8");
    if (localName !== entryPath) throw new Error(`ZIP local/central path mismatch: ${entryPath}`);
    const dataStart = localNameStart + localNameLength;
    const dataEnd = dataStart + size;
    if (dataEnd > centralOffset) throw new Error(`ZIP entry exceeds payload: ${entryPath}`);
    const data = Buffer.from(body.subarray(dataStart, dataEnd));
    if (crc32(data) !== checksum) throw new Error(`ZIP entry CRC mismatch: ${entryPath}`);
    entries.push({path: entryPath, data});
    expectedLocalOffset = dataEnd;
    offset = nameStart + nameLength;
  }
  if (offset !== endOffset || expectedLocalOffset !== centralOffset) throw new Error("ZIP directory or local payload has trailing data");
  return entries;
}

export function validateArchivePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) throw new Error("archive path is empty or too long");
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) throw new Error(`unsafe archive path: ${value}`);
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`unsafe archive path: ${value}`);
  }
}

export function readPythonProjectMetadata(text) {
  let section = "";
  const project = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== "project") continue;
    const valueMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"\\]*)"$/);
    if (!valueMatch) continue;
    if (project.has(valueMatch[1])) throw new Error(`duplicate Python project field: ${valueMatch[1]}`);
    project.set(valueMatch[1], valueMatch[2]);
  }
  const name = project.get("name");
  const version = project.get("version");
  if (!name || !version) throw new Error("Python project name/version metadata is missing");
  return {name, version};
}

function createTarHeader(name, size) {
  const header = Buffer.alloc(512);
  const nameBytes = Buffer.from(name);
  if (nameBytes.length > 100) throw new Error(`archive path exceeds ustar name field: ${name}`);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const encoded = checksum.toString(8).padStart(6, "0");
  if (encoded.length > 6) throw new Error("tar checksum exceeds field width");
  header.write(encoded, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeString(buffer, offset, length, value) {
  const encoded = Buffer.from(value);
  if (encoded.length > length) throw new Error(`tar string exceeds field width: ${value}`);
  encoded.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length > length - 1) throw new Error("tar number exceeds field width");
  buffer.write(encoded, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function readString(buffer, offset, length) {
  const field = buffer.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8").trimEnd();
}

function readOctal(buffer, offset, length, name) {
  const value = readString(buffer, offset, length).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error(`tar ${name} field is not octal`);
  return Number.parseInt(value, 8);
}

function validateTarChecksum(header) {
  const expected = readOctal(header, 148, 8, "checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) throw new Error("tar header checksum mismatch");
}

const CRC32_TABLE = Array.from({length: 256}, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) current = (current >>> 1) ^ ((current & 1) ? 0xedb88320 : 0);
  return current >>> 0;
});

function crc32(body) {
  let value = 0xffffffff;
  for (const byte of body) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
