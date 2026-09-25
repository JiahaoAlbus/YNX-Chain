import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { PrivateFilePolicy } from "./platform-private-file.mjs";

export const vaultFileDigest = value => value === null ? null : createHash("sha256").update(value).digest("hex");
const safeStage = value => typeof value === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(value) ? value : "unknown";
export function vaultStorageError(code = "PASSWORD_VAULT_STORAGE_FAILED", stage = "unknown") {
  const messages = {
    PASSWORD_VAULT_STORAGE_FAILED: "Wallet storage could not complete. Existing recovery files were retained. Reopen Wallet before continuing.",
    PASSWORD_VAULT_FILE_CHANGED: "The stored Wallet changed. Unlock its current version before continuing.",
    PASSWORD_VAULT_FILE_INVALID: "Wallet storage is not a private regular file or exceeds the allowed size.",
    PASSWORD_VAULT_HISTORY_LIMIT: "This Wallet already retains 64 recovery generations. Preserve and manage those encrypted backups before replacing another password.",
  };
  const diagnosticStage = safeStage(stage);
  return Object.assign(new Error(`${messages[code]}${code === "PASSWORD_VAULT_STORAGE_FAILED" ? ` Reference: ${diagnosticStage}.` : ""}`), { code: 4100, data: { code, storageStage: diagnosticStage } });
}

/** V3 writes are durable before publication. This store never touches the transaction journal. */
export class PasswordVaultFile {
  constructor(filePath, { io = fs, platform = process.platform, filePolicy = new PrivateFilePolicy({ io, platform }) } = {}) { this.filePath = filePath; this.io = io; this.platform = platform; this.filePolicy = filePolicy; }
  async exists(filePath) {
    try { await this.io.lstat(filePath); return true; }
    catch (error) { if (error?.code === "ENOENT") return false; throw vaultStorageError(); }
  }
  async read(filePath = this.filePath, { legacy = false } = {}) {
    let handle;
    let stage = "read-probe";
    try {
      await this.filePolicy.available(filePath);
      stage = "read-open";
      handle = await this.io.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      stage = "read-inspect";
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1_048_576) throw vaultStorageError("PASSWORD_VAULT_FILE_INVALID");
      if (!legacy) await this.filePolicy.assertPrivate(filePath, stat);
      stage = "read-content";
      const text = await handle.readFile("utf8");
      if (Buffer.byteLength(text) > 1_048_576) throw vaultStorageError("PASSWORD_VAULT_FILE_INVALID");
      return Object.freeze({ text, digest: vaultFileDigest(text) });
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error?.data?.code) throw error;
      throw vaultStorageError("PASSWORD_VAULT_STORAGE_FAILED", error?.storageStage ?? stage);
    } finally { await handle?.close(); }
  }
  async assertCurrent(expected, guard) {
    guard.assert(); const current = await this.read(); guard.assert();
    if ((current?.digest ?? null) !== expected) throw vaultStorageError("PASSWORD_VAULT_FILE_CHANGED");
  }
  async publish(vault, expected, guard, verify, beforeCommit) {
    const text = `${JSON.stringify(vault)}\n`;
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let handle, renamed = false, stage = "publish-directory";
    try {
      guard.assert(); await this.filePolicy.directory(path.dirname(this.filePath)); guard.assert();
      stage = "publish-create";
      handle = await this.io.open(temporary, "wx", 0o600);
      stage = "publish-protect";
      await this.filePolicy.protect(temporary); guard.assert();
      stage = "publish-write";
      await handle.writeFile(text, "utf8"); await handle.sync(); await handle.close(); handle = null;
      stage = "publish-staged-readback";
      guard.assert();
      const readback = await this.read(temporary);
      if (readback?.text !== text) throw vaultStorageError("PASSWORD_VAULT_STORAGE_FAILED", stage);
      stage = "publish-crypto-verify";
      await verify(readback.text); guard.assert();
      stage = "publish-generation-check";
      await this.assertCurrent(expected, guard);
      if (beforeCommit) { stage = "publish-permission-revoke"; await beforeCommit(); guard.assert(); stage = "publish-generation-check"; await this.assertCurrent(expected, guard); }
      // Once rename starts it may have committed despite cancellation. Never delete
      // the target or report an old session as usable in that case.
      stage = "publish-replace";
      await this.filePolicy.replace(temporary, this.filePath); renamed = true;
      stage = "publish-final-readback";
      const stored = await this.read();
      if (stored?.text !== text) throw vaultStorageError("PASSWORD_VAULT_STORAGE_FAILED", stage);
      guard.assert(); return stored.digest;
    } catch (error) {
      if (error?.data?.code) throw error;
      throw vaultStorageError("PASSWORD_VAULT_STORAGE_FAILED", error?.storageStage ?? stage);
    } finally {
      await handle?.close().catch(() => {});
      if (!renamed) await this.io.unlink(temporary).catch(() => {});
    }
  }
  async preserve(snapshot, guard) {
    if (!snapshot) return null;
    const directory = path.join(path.dirname(this.filePath), "wallet-recovery-history");
    const target = path.join(directory, `${snapshot.digest}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle;
    try {
      guard.assert(); await this.filePolicy.directory(directory); guard.assert();
      const generations = await this.history(); guard.assert();
      if (generations.length >= 64 && !generations.includes(snapshot.digest)) throw vaultStorageError("PASSWORD_VAULT_HISTORY_LIMIT");
      const previous = await this.read(target); guard.assert();
      if (previous && previous.digest !== snapshot.digest) throw vaultStorageError();
      // Even an existing matching archive is republished through the native
      // commit barrier. An earlier failed fsync must never be assumed durable.
      handle = await this.io.open(temporary, "wx", 0o600);
      await this.filePolicy.protect(temporary); guard.assert();
      await handle.writeFile(snapshot.text, "utf8"); await handle.sync(); await handle.close(); handle = null;
      guard.assert();
      const candidate = await this.read(temporary); guard.assert();
      if (candidate?.digest !== snapshot.digest) throw vaultStorageError();
      await this.filePolicy.replace(temporary, target);
      const readback = await this.read(target);
      if (readback?.digest !== snapshot.digest) throw vaultStorageError();
      if (this.platform !== "win32") await this.syncDirectory(path.dirname(directory));
      guard.assert();
      return snapshot.digest;
    } catch (error) { if (error?.data?.code) throw error; throw vaultStorageError(); }
    finally { await handle?.close().catch(() => {}); await this.io.unlink(temporary).catch(() => {}); }
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
    // Windows callers must use PrivateFilePolicy.replace's verified native
    // write-through operation; a missing POSIX API is never a successful barrier.
    if (this.platform === "win32") throw vaultStorageError();
    const handle = await this.io.open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
}
