#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { canonicalJSON } from "../src/canonical.js";
import { migrateLegacy6cfProductSessionGatewayNodeState } from "../src/product-session-gateway-node-state-migration.js";

const args = options(process.argv.slice(2));
const previousRegistryBytes = secureRead(args.previousRegistry, "previous registry", 4 * 1024 * 1024, false);
const currentRegistryBytes = secureRead(args.currentRegistry, "current registry", 4 * 1024 * 1024, false);
const stateBytes = secureRead(args.sourceState, "source state", 64 * 1024 * 1024, true);
const envelope = migrateLegacy6cfProductSessionGatewayNodeState({
  currentRegistryBytes,
  expectedCurrentRegistryFileSha256: args.expectedCurrentRegistryFileSha256,
  expectedPreviousRegistryFileSha256: args.expectedPreviousRegistryFileSha256,
  expectedSourceStateFileSha256: args.expectedSourceStateFileSha256,
  previousRegistryBytes,
  stateBytes,
});
const outputBytes = `${canonicalJSON(envelope)}\n`;
secureCreate(args.outputState, outputBytes);
process.stdout.write(`${canonicalJSON({
  currentRegistryFileSha256: sha256(currentRegistryBytes),
  migratedStateFileSha256: sha256(outputBytes),
  outputState: args.outputState,
  previousRegistryFileSha256: sha256(previousRegistryBytes),
  registryStateBindingSha256: envelope.registrySha256,
  schemaVersion: 1,
  sourceStateFileSha256: sha256(stateBytes),
})}\n`);

function options(values) {
  const names = new Map([
    ["--current-registry", "currentRegistry"],
    ["--expected-current-registry-file-sha256", "expectedCurrentRegistryFileSha256"],
    ["--expected-previous-registry-file-sha256", "expectedPreviousRegistryFileSha256"],
    ["--expected-source-state-file-sha256", "expectedSourceStateFileSha256"],
    ["--output-state", "outputState"],
    ["--previous-registry", "previousRegistry"],
    ["--source-state", "sourceState"],
  ]);
  if (values.length !== names.size * 2) throw new Error("exact migration arguments are required");
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = names.get(values[index]), value = values[index + 1];
    if (!key || Object.hasOwn(result, key) || typeof value !== "string" || value.length === 0) throw new Error("migration arguments are invalid");
    result[key] = value;
  }
  for (const key of ["currentRegistry", "outputState", "previousRegistry", "sourceState"]) if (!isAbsolute(result[key])) throw new Error(`${key} must be an absolute path`);
  for (const key of ["expectedCurrentRegistryFileSha256", "expectedPreviousRegistryFileSha256", "expectedSourceStateFileSha256"]) if (!/^[0-9a-f]{64}$/.test(result[key])) throw new Error(`${key} must be a lowercase SHA-256`);
  return Object.freeze(result);
}

function secureRead(path, label, maximumBytes, privateFile) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 2 || info.size > maximumBytes || (privateFile && (info.mode & 0o777) !== 0o600) || info.uid !== process.getuid()) throw new Error(`${label} is not a safe owned regular file`);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (opened.dev !== info.dev || opened.ino !== info.ino) throw new Error(`${label} changed during open`);
    return readFileSync(descriptor, "utf8");
  } finally { closeSync(descriptor); }
}

function secureCreate(path, bytes) {
  const parent = dirname(path), directory = lstatSync(parent);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || (directory.mode & 0o777) !== 0o700) throw new Error("output directory must be private, owned and mode 0700");
  try { lstatSync(path); throw new Error("output state already exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const temporary = join(parent, `.migration-${process.pid}-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, bytes, "utf8"); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
    linkSync(temporary, path); unlinkSync(temporary);
    const directoryDescriptor = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    const written = lstatSync(path);
    if (!written.isFile() || written.isSymbolicLink() || written.nlink !== 1 || written.uid !== process.getuid() || (written.mode & 0o777) !== 0o600) throw new Error("migrated state file is unsafe");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
