import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export const vaultFileDigest = value => value === null ? null : createHash("sha256").update(value).digest("hex");
export function vaultStorageError(code = "PASSWORD_VAULT_STORAGE_FAILED") {
  const messages = {
    PASSWORD_VAULT_STORAGE_FAILED: "Wallet storage could not complete. Existing recovery files were retained. Reopen Wallet before continuing.",
    PASSWORD_VAULT_FILE_CHANGED: "The stored Wallet changed. Unlock its current version before continuing.",
    PASSWORD_VAULT_FILE_INVALID: "Wallet storage is not a private regular file or exceeds the allowed size.",
    PASSWORD_VAULT_HISTORY_LIMIT: "This Wallet already retains 64 recovery generations. Preserve and manage those encrypted backups before replacing another password.",
  };
  return Object.assign(new Error(messages[code]), { code: 4100, data: { code } });
}

/** V3 writes are durable before publication. This store never touches the transaction journal. */
export class PasswordVaultFile {
  constructor(filePath, { io = fs, platform = process.platform } = {}) { this.filePath = filePath; this.io = io; this.platform = platform; }
  async exists(filePath) {
    try { await this.io.lstat(filePath); return true; }
    catch (error) { if (error?.code === "ENOENT") return false; throw vaultStorageError(); }
  }
  async read(filePath = this.filePath, { legacy = false } = {}) {
    let handle;
    try {
      handle = await this.io.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1_048_576 || !legacy && this.platform !== "win32" && (stat.mode & 0o077) !== 0) throw vaultStorageError("PASSWORD_VAULT_FILE_INVALID");
      const text = await handle.readFile("utf8");
      if (Buffer.byteLength(text) > 1_048_576) throw vaultStorageError("PASSWORD_VAULT_FILE_INVALID");
      return Object.freeze({ text, digest: vaultFileDigest(text) });
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error?.data?.code) throw error;
      throw vaultStorageError();
    } finally { await handle?.close(); }
  }
  async assertCurrent(expected, guard) {
    guard.assert(); const current = await this.read(); guard.assert();
    if ((current?.digest ?? null) !== expected) throw vaultStorageError("PASSWORD_VAULT_FILE_CHANGED");
  }
  async publish(vault, expected, guard, verify, beforeCommit) {
    const text = `${JSON.stringify(vault)}\n`;
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let handle, renamed = false;
    try {
      guard.assert(); await this.io.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 }); guard.assert();
      handle = await this.io.open(temporary, "wx", 0o600);
      await handle.writeFile(text, "utf8"); await handle.sync(); await handle.close(); handle = null;
      guard.assert();
      const readback = await this.read(temporary);
      if (readback?.text !== text) throw vaultStorageError();
      await verify(readback.text); guard.assert();
      await this.assertCurrent(expected, guard);
      if (beforeCommit) { await beforeCommit(); guard.assert(); await this.assertCurrent(expected, guard); }
      // Once rename starts it may have committed despite cancellation. Never delete
      // the target or report an old session as usable in that case.
      await this.io.rename(temporary, this.filePath); renamed = true;
      await this.syncDirectory(path.dirname(this.filePath));
      const stored = await this.read();
      if (stored?.text !== text) throw vaultStorageError();
      guard.assert(); return stored.digest;
    } catch (error) {
      if (error?.data?.code) throw error;
      throw vaultStorageError();
    } finally {
      await handle?.close().catch(() => {});
      if (!renamed) await this.io.unlink(temporary).catch(() => {});
    }
  }
  async preserve(snapshot, guard) {
    if (!snapshot) return null;
    const directory = path.join(path.dirname(this.filePath), "wallet-recovery-history");
    const target = path.join(directory, `${snapshot.digest}.json`);
    let handle;
    try {
      guard.assert(); await this.io.mkdir(directory, { recursive: true, mode: 0o700 }); guard.assert();
      const generations = await this.history(); guard.assert();
      if (generations.length >= 64 && !generations.includes(snapshot.digest)) throw vaultStorageError("PASSWORD_VAULT_HISTORY_LIMIT");
      try {
        handle = await this.io.open(target, "wx", 0o600); await handle.writeFile(snapshot.text, "utf8"); await handle.sync(); await handle.close(); handle = null;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        // A previous write may have succeeded before fsync failed. Reusing matching
        // bytes is safe only after synchronizing that existing file as well.
        handle = await this.io.open(target, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 1_048_576 || this.platform !== "win32" && (stat.mode & 0o077) !== 0) throw vaultStorageError("PASSWORD_VAULT_FILE_INVALID");
        await handle.sync(); await handle.close(); handle = null;
      }
      const readback = await this.read(target);
      if (readback?.digest !== snapshot.digest) throw vaultStorageError();
      await this.syncDirectory(directory); await this.syncDirectory(path.dirname(directory)); guard.assert();
      return snapshot.digest;
    } catch (error) { if (error?.data?.code) throw error; throw vaultStorageError(); }
    finally { await handle?.close().catch(() => {}); }
  }
  async history() {
    const directory = path.join(path.dirname(this.filePath), "wallet-recovery-history");
    try { return (await this.io.readdir(directory)).filter(name => /^[0-9a-f]{64}\.json$/.test(name)).map(name => name.slice(0, -5)); }
    catch (error) { if (error?.code === "ENOENT") return []; throw vaultStorageError(); }
  }
  async readHistory(digest) {
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) throw vaultStorageError("PASSWORD_VAULT_FILE_INVALID");
    const snapshot = await this.read(path.join(path.dirname(this.filePath), "wallet-recovery-history", `${digest}.json`));
    if (!snapshot || snapshot.digest !== digest) throw vaultStorageError("PASSWORD_VAULT_FILE_CHANGED");
    return snapshot;
  }
  async syncDirectory(directory) {
    // Windows does not expose POSIX directory fsync through Node; file FlushFileBuffers
    // and atomic replacement still run. Do not claim POSIX power-loss proof there.
    if (this.platform === "win32") return;
    const handle = await this.io.open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
}
