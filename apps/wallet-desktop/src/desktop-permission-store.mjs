import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class FilePermissionStore {
  constructor(filePath) { this.filePath = filePath; }
  async grantAccount(origin, account, approvedAt) {
    const state = await this.#read();
    state.origins[origin] = { parentCapability: "eth_accounts", accounts: [account], approvedAt };
    await this.#write(state);
  }
  async revoke(origin) { const state = await this.#read(); delete state.origins[origin]; await this.#write(state); }
  async hasAccount(origin, account) { return (await this.#read()).origins[origin]?.accounts.includes(account) ?? false; }
  async list(origin) { const record = (await this.#read()).origins[origin]; return record ? [Object.freeze({ ...record })] : []; }
  async #read() {
    try {
      const state = JSON.parse(await readFile(this.filePath, "utf8"));
      if (state?.schemaVersion !== 1 || typeof state.origins !== "object" || state.origins === null || Array.isArray(state.origins)) throw new Error("Permission store failed validation");
      return state;
    } catch (error) {
      if (error?.code === "ENOENT") return { schemaVersion: 1, origins: {} };
      throw error;
    }
  }
  async #write(state) {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}
