#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const direct = process.argv[1]?.endsWith("ynx-wallet-stage-offline-artifact-linux.mjs") === true;
const [stagingDirectory, artifactName, expectedSha256, expectedBytesText, initializeDirectory] = process.argv.slice(direct ? 2 : 1);
if ([stagingDirectory, artifactName, expectedSha256, expectedBytesText, initializeDirectory].some((value) => typeof value !== "string") || process.argv.length !== (direct ? 7 : 6)) fail("EXACT_ARGUMENTS_REQUIRED");
const testMode = process.env.YNX_STAGE_TEST_ALLOW_NON_ROOT === "1";
if (!testMode && process.platform !== "linux") fail("LINUX_REQUIRED");
const expectedUid = process.geteuid?.();
let expectedGid = process.getegid?.();
if (!Number.isSafeInteger(expectedUid) || !Number.isSafeInteger(expectedGid) || (!testMode && expectedUid !== 0)) fail("ROOT_REQUIRED");
if (testMode) {
  if (!/^\/tmp\/ynx-wallet-auth-stage-test-[A-Za-z0-9._-]{1,80}$/u.test(stagingDirectory)) fail("INVALID_TEST_STAGING_DIRECTORY");
} else if (!/^\/var\/tmp\/ynx-wallet-auth-p0[0-9]{3}-[a-z0-9]{8,64}$/u.test(stagingDirectory)) fail("INVALID_STAGING_DIRECTORY");
if (!/^wallet-auth-(source|runtime-dependencies)-[0-9a-f]{8}\.tar\.gz$/u.test(artifactName) || basename(artifactName) !== artifactName) fail("INVALID_ARTIFACT_NAME");
if (!/^[0-9a-f]{64}$/u.test(expectedSha256)) fail("INVALID_EXPECTED_SHA256");
if (!/^[1-9][0-9]{0,9}$/u.test(expectedBytesText)) fail("INVALID_EXPECTED_BYTES");
if (initializeDirectory !== "0" && initializeDirectory !== "1") fail("INVALID_INITIALIZE_FLAG");
const expectedBytes = Number(expectedBytesText);

if (initializeDirectory === "1") {
  try { mkdirSync(stagingDirectory, { mode: 0o700 }); } catch { fail("STAGING_DIRECTORY_EXISTS_OR_UNCREATABLE"); }
}
const directory = safeLstat(stagingDirectory, "STAGING_DIRECTORY_MISSING_OR_UNSAFE");
if (!directory.isDirectory() || directory.isSymbolicLink()) fail("STAGING_DIRECTORY_MISSING_OR_UNSAFE");
if (testMode) expectedGid = directory.gid;
if ((directory.mode & 0o777) !== 0o700) fail("STAGING_DIRECTORY_MODE");
if (directory.uid !== expectedUid || directory.gid !== expectedGid) fail("STAGING_DIRECTORY_OWNER");

const finalPath = join(stagingDirectory, artifactName);
if (exists(finalPath)) fail("ARTIFACT_ALREADY_EXISTS");
const temporaryPath = join(stagingDirectory, `.${artifactName}.${process.pid}.${createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 16)}.tmp`);
let temporaryFd = -1;
let temporaryIdentity;
let published = false;
try {
  temporaryFd = openSync(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  fchmodSync(temporaryFd, 0o600);
  temporaryIdentity = fstatSync(temporaryFd);
  const bytes = readFileSync(0);
  if (bytes.length !== expectedBytes) fail("ARTIFACT_BYTES_MISMATCH");
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) fail("ARTIFACT_SHA256_MISMATCH");
  writeFileSync(temporaryFd, bytes);
  fsyncSync(temporaryFd);
  const verified = fstatSync(temporaryFd);
  if (!verified.isFile() || verified.nlink !== 1 || (verified.mode & 0o777) !== 0o600 || verified.uid !== expectedUid || verified.gid !== expectedGid || verified.size !== expectedBytes || verified.dev !== temporaryIdentity.dev || verified.ino !== temporaryIdentity.ino) fail("TEMPORARY_INODE_INVALID");
  closeSync(temporaryFd); temporaryFd = -1;
  const pathIdentity = lstatSync(temporaryPath);
  if (pathIdentity.dev !== temporaryIdentity.dev || pathIdentity.ino !== temporaryIdentity.ino) fail("TEMPORARY_PATH_CHANGED");
  const receipt = Object.freeze({ artifactName, bytes: expectedBytes, directoryMode: "0700", fileMode: "0600", nlink: 1, ownerUid: expectedUid, schemaVersion: 1, sha256: expectedSha256, stagingDirectory });
  const receiptText = `${JSON.stringify(receipt)}\n`;
  linkSync(temporaryPath, finalPath); published = true;
  const final = statSync(finalPath);
  if (!final.isFile() || final.dev !== temporaryIdentity.dev || final.ino !== temporaryIdentity.ino || final.nlink !== 2 || (final.mode & 0o777) !== 0o600 || final.uid !== expectedUid || final.gid !== expectedGid || final.size !== expectedBytes) fail("PUBLISHED_INODE_INVALID");
  unlinkSync(temporaryPath);
  const oneLink = statSync(finalPath);
  if (oneLink.nlink !== 1 || createHash("sha256").update(readFileSync(finalPath)).digest("hex") !== expectedSha256) fail("PUBLISHED_READBACK_MISMATCH");
  const directoryFd = openSync(stagingDirectory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
  process.stdout.write(receiptText);
} catch (error) {
  if (temporaryFd >= 0) { try { closeSync(temporaryFd); } catch {} }
  if (published) removeExact(finalPath, temporaryIdentity);
  removeExact(temporaryPath, temporaryIdentity);
  throw error;
}

function exists(path) { try { lstatSync(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
function safeLstat(path, code) { try { return lstatSync(path); } catch { fail(code); } }
function removeExact(path, identity) { if (!identity) return; try { const current = lstatSync(path); if (current.dev === identity.dev && current.ino === identity.ino) unlinkSync(path); } catch {} }
function fail(code) { const error = new Error(code); error.code = code; throw error; }
