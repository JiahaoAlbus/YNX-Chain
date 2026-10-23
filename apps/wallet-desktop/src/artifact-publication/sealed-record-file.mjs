// Private Main filesystem primitive, NOT a key store authorization or signer.
// Accepts only an already sealed native record. It never generates, decrypts,
// exports, migrates or signs with keys. Native Source/current/approval and the
// purpose-specific record codec must be checked by the owning native caller.
import fs from 'node:fs';
import path from 'node:path';

const NAME = 'artifact-publisher-sealed-v1.bin';
const MAX = 1024 * 1024;
const fail = code => { throw Object.assign(new Error(code), {code}); };
function checkedDirectory(directory) {
  if (typeof process.getuid !== 'function' || !fs.constants.O_NOFOLLOW || !fs.constants.O_NONBLOCK) fail('PUBLISHER_STORE_PLATFORM');
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory || directory.includes('\0')) fail('PUBLISHER_STORE_PATH');
  // Check every ancestor: O_NOFOLLOW on the leaf alone does not reject an
  // ancestor symlink. This backend is for an existing private Main directory.
  // As with other same-user local storage, this is not a sandbox against a
  // hostile process with the same UID concurrently renaming its ancestors.
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PUBLISHER_STORE_PATH');
  }
  const stat = fs.lstatSync(directory);
  if (stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) fail('PUBLISHER_STORE_PERMISSIONS');
}
function checkedFile(fd) {
  const stat = fs.fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== 0o600 || stat.size < 64 || stat.size > MAX) fail('PUBLISHER_STORE_RECORD');
  return stat;
}
function close(fd, cause) {
  if (fd === undefined) return cause;
  try { fs.closeSync(fd); } catch (cleanupCause) {
    if (!cause) return cleanupCause;
    if (!Object.hasOwn(cause, 'cleanupCause')) cause.cleanupCause = cleanupCause;
  }
  return cause;
}

/** Create-only durability for a sealed record. Existing or uncertain records
 * are never overwritten. On any error callers must reconcile, not regenerate
 * keys or retry provisioning. This function confers no publisher identity. */
export function createSealedPublisherRecord(directory, sealedRecord) {
  if (!Buffer.isBuffer(sealedRecord) || sealedRecord.length < 64 || sealedRecord.length > MAX) fail('PUBLISHER_STORE_RECORD');
  const captured = Buffer.from(sealedRecord);
  let fd, parent, cause;
  try {
    checkedDirectory(directory);
    fd = fs.openSync(path.join(directory, NAME), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, captured);
    fs.fsyncSync(fd);
    checkedFile(fd);
    const completed = fd; fd = undefined;
    fs.closeSync(completed);
    parent = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    fs.fsyncSync(parent);
  } catch (error) {
    cause = error;
  } finally {
    // A failed close is not retried: descriptor ownership may be uncertain.
    cause = close(parent, close(fd, cause));
    captured.fill(0);
    // Deliberately leave partial/uncertain files intact for original recovery.
  }
  if (cause) throw cause;
}

/** Returns a copy of sealed DATA, never a plaintext secret or key handle. */
export function readSealedPublisherRecord(directory) {
  checkedDirectory(directory);
  const fd = fs.openSync(path.join(directory, NAME), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let result, cause;
  try {
    const before = checkedFile(fd);
    result = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < result.length) {
      const count = fs.readSync(fd, result, offset, result.length - offset, offset);
      if (!count) fail('PUBLISHER_STORE_CHANGED');
      offset += count;
    }
    const after = checkedFile(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('PUBLISHER_STORE_CHANGED');
  } catch (error) {
    cause = error;
  } finally { cause = close(fd, cause); }
  if (cause) { result?.fill(0); throw cause; }
  return result;
}
