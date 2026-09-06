import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

const sha = (type, bytes) => createHash(type).update(bytes).digest("hex");
const blobHash = bytes => sha("sha1", Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
const fields = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const keyFor = ({commit, path}) => `${commit}:${path}`;
function descriptor(value) {
  if (!/^[0-9a-f]{40}$/u.test(value.commit) || !/^[0-9a-f]{40}$/u.test(value.blob) || !/^[0-9a-f]{64}$/u.test(value.sha256) ||
      typeof value.path !== "string" || !/^[A-Za-z0-9_.\/-]+$/u.test(value.path) || value.path.startsWith("/") || value.path.split("/").some(x => !x || x === "." || x === "..")) throw new Error("Invalid build authority descriptor");
}
function verify(bytes, expected) {
  if (blobHash(bytes) !== expected.blob || sha("sha256", bytes) !== expected.sha256) throw new Error(`Immutable authority mismatch: ${keyFor(expected)}`);
  return bytes;
}

// An explicit reviewer mode. No automatic fallback when Git is absent or fails.
// The archive's self-declared hashes are checked again against each constant in build.mjs.
export function createAuthorityReader({repository, archiveFile} = {}) {
  let archived;
  const consumed = new Map();
  if (archiveFile !== undefined) {
    const raw = readFileSync(archiveFile);
    if (raw.length > 8 * 1024 * 1024) throw new Error("Build authority archive exceeds limit");
    const value = JSON.parse(raw);
    if (!fields(value, ["schemaVersion", "records"]) || value.schemaVersion !== 1 || !Array.isArray(value.records) || value.records.length < 1 || value.records.length > 64) throw new Error("Invalid build authority archive");
    archived = new Map();
    for (const item of value.records) {
      if (!fields(item, ["commit", "path", "blob", "sha256", "contentBase64"])) throw new Error("Invalid build authority entry");
      descriptor(item);
      if (typeof item.contentBase64 !== "string") throw new Error("Invalid build authority bytes");
      const bytes = Buffer.from(item.contentBase64, "base64");
      if (bytes.toString("base64") !== item.contentBase64 || archived.has(keyFor(item))) throw new Error("Duplicate or noncanonical build authority entry");
      verify(bytes, item);
      archived.set(keyFor(item), {...item, bytes});
    }
  }
  return {
    read(commit, contract) {
      const expected = {commit, ...contract}; descriptor(expected);
      let bytes;
      if (archived) {
        const item = archived.get(keyFor(expected));
        if (!item || item.blob !== expected.blob || item.sha256 !== expected.sha256) throw new Error(`Missing or changed build authority: ${keyFor(expected)}`);
        bytes = item.bytes;
      } else {
        const actual = execFileSync("git", ["rev-parse", keyFor(expected)], {cwd:repository, encoding:"utf8"}).trim();
        if (actual !== expected.blob) throw new Error(`Immutable authority mismatch: ${keyFor(expected)}`);
        bytes = execFileSync("git", ["show", keyFor(expected)], {cwd:repository});
      }
      verify(bytes, expected);
      consumed.set(keyFor(expected), {...expected, contentBase64:bytes.toString("base64")});
      return Buffer.from(bytes);
    },
    finish() {
      if (archived && consumed.size !== archived.size) throw new Error("Unexpected unused build authority entries");
      return {schemaVersion:1, records:[...consumed.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value)};
    },
  };
}
