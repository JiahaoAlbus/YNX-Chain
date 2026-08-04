import fs from "node:fs";

const CRC_TABLE = buildCrcTable();
const DOS_DATE_1980_01_01 = 0x21;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;

export function createDeterministicZip(entries) {
  const normalized = entries
    .map(({ name, data }) => ({
      name: normalizeName(name),
      data: Buffer.isBuffer(data) ? data : Buffer.from(data),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const seen = new Set();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of normalized) {
    if (seen.has(entry.name)) throw new Error(`duplicate ZIP entry: ${entry.name}`);
    seen.add(entry.name);

    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(STORE_METHOD, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(STORE_METHOD, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + entry.data.length;
  }

  if (normalized.length > 0xffff) throw new Error("ZIP entry count exceeds ZIP32 limit");
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function readStoredZip(file) {
  const body = fs.readFileSync(file);
  const entries = [];
  let offset = 0;
  while (offset + 4 <= body.length && body.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > body.length) throw new Error("truncated ZIP local header");
    const flags = body.readUInt16LE(offset + 6);
    const method = body.readUInt16LE(offset + 8);
    const checksum = body.readUInt32LE(offset + 14);
    const compressedSize = body.readUInt32LE(offset + 18);
    const uncompressedSize = body.readUInt32LE(offset + 22);
    const nameLength = body.readUInt16LE(offset + 26);
    const extraLength = body.readUInt16LE(offset + 28);
    if (flags !== UTF8_FLAG || method !== STORE_METHOD) {
      throw new Error("ZIP entry must use UTF-8 and deterministic store mode");
    }
    if (compressedSize !== uncompressedSize) throw new Error("stored ZIP size mismatch");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > body.length) throw new Error("truncated ZIP entry");
    const name = body.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const data = body.subarray(dataStart, dataEnd);
    if (crc32(data) !== checksum) throw new Error(`ZIP CRC mismatch: ${name}`);
    entries.push({ name, data });
    offset = dataEnd;
  }
  if (entries.length === 0) throw new Error("ZIP contains no entries");
  return entries;
}

function normalizeName(name) {
  const normalized = String(name).replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`unsafe ZIP entry name: ${name}`);
  }
  if (Buffer.byteLength(normalized) > 0xffff) throw new Error(`ZIP entry name too long: ${name}`);
  return normalized;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function buildCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}
