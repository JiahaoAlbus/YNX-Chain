#!/usr/bin/env node
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function hash(data) {
  return createHash("sha256").update(data).digest("hex");
}

function readKey(path) {
  const raw = readFileSync(path);
  if (raw.length === 32) return raw;
  const text = raw.toString("utf8").trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, "hex");
  throw new Error("backup key file must contain exactly 32 raw bytes or 64 hexadecimal characters");
}

function collect(base, current = base) {
  const files = [];
  for (const name of readdirSync(current).sort()) {
    const path = resolve(current, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`symbolic links are not accepted: ${relative(base, path)}`);
    if (stat.isDirectory()) files.push(...collect(base, path));
    else if (stat.isFile()) {
      const data = readFileSync(path);
      files.push({ path: relative(base, path).split(sep).join("/"), bytes: data.length, sha256: hash(data), data: data.toString("base64") });
    }
  }
  return files;
}

function safeDestination(root, entry) {
  if (!entry || entry.startsWith("/") || entry.split("/").includes("..")) throw new Error(`unsafe backup path: ${entry}`);
  const destination = resolve(root, entry);
  if (destination !== root && !destination.startsWith(`${root}${sep}`)) throw new Error(`unsafe backup path: ${entry}`);
  return destination;
}

export function createBackup({ source, output, manifestPath, keyFile, sourceCommit, createdAt = new Date().toISOString() }) {
  const files = collect(resolve(source));
  const plaintext = Buffer.from(JSON.stringify({ schemaVersion: 1, files }), "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", readKey(keyFile), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = Buffer.from(JSON.stringify({
    schemaVersion: 1, algorithm: "AES-256-GCM", iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"),
  }), "utf8");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, envelope);
  const manifest = {
    schemaVersion: 1, sourceCommit, createdAt, algorithm: "AES-256-GCM",
    backup: { sha256: hash(envelope), bytes: envelope.length },
    plaintextSha256: hash(plaintext),
    files: files.map(({ data, ...metadata }) => metadata),
    signerRecoveryIncluded: false,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function restoreBackup({ backup, manifestPath, destination, keyFile }) {
  const envelopeBytes = readFileSync(backup);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (hash(envelopeBytes) !== manifest.backup.sha256 || envelopeBytes.length !== manifest.backup.bytes) throw new Error("encrypted backup integrity check failed");
  const envelope = JSON.parse(envelopeBytes.toString("utf8"));
  if (envelope.algorithm !== "AES-256-GCM") throw new Error("unsupported backup algorithm");
  const decipher = createDecipheriv("aes-256-gcm", readKey(keyFile), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  if (hash(plaintext) !== manifest.plaintextSha256) throw new Error("decrypted backup integrity check failed");
  const payload = JSON.parse(plaintext.toString("utf8"));
  const root = resolve(destination);
  mkdirSync(root, { recursive: true });
  for (const entry of payload.files) {
    const data = Buffer.from(entry.data, "base64");
    if (data.length !== entry.bytes || hash(data) !== entry.sha256) throw new Error(`file integrity check failed: ${entry.path}`);
    const path = safeDestination(root, entry.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data, { flag: "wx" });
  }
  return { restoredFiles: payload.files.length, plaintextSha256: hash(plaintext), signerRecoveryIncluded: false };
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith("--") || values[index + 1] === undefined) throw new Error("arguments must be --name value pairs");
    args[key.slice(2)] = values[index + 1];
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    if (command === "create") {
      const result = createBackup({ source: args.source, output: args.output, manifestPath: args.manifest, keyFile: args["key-file"], sourceCommit: args["source-commit"] });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (command === "restore") {
      const result = restoreBackup({ backup: args.backup, manifestPath: args.manifest, destination: args.destination, keyFile: args["key-file"] });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      throw new Error("usage: security-backup.mjs create|restore with explicit paths; see OPERATIONS.md");
    }
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
