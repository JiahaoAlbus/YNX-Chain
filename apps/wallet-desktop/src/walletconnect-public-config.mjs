import { readFile } from "node:fs/promises";
import path from "node:path";

export const WALLETCONNECT_PUBLIC_CONFIG_FILE = "ynx-wallet-walletconnect-config.json";
const invalid = () => Object.assign(new Error("WalletConnect public configuration is invalid."), { code: "WALLETCONNECT_CONFIG_INVALID" });
export function publicWalletConnectConfig(projectId = null) {
  if (projectId !== null && (typeof projectId !== "string" || !/^[0-9a-f]{32}$/u.test(projectId))) throw invalid();
  return Object.freeze({ schemaVersion: 1, chainId: "eip155:6423", projectId });
}
export function parsePublicWalletConnectConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "chainId,projectId,schemaVersion" || value.schemaVersion !== 1 || value.chainId !== "eip155:6423") throw invalid();
  return publicWalletConnectConfig(value.projectId);
}
// Only the dedicated public project ID is packaged. No generic env dump, Relay
// URI, session, API secret or signing material is accepted by this schema.
export function buildPublicWalletConnectConfig(environment = process.env) {
  const value = environment.YNX_WALLETCONNECT_PROJECT_ID;
  return publicWalletConnectConfig(value === undefined || value === "" ? null : value);
}
export async function loadPublicWalletConnectConfig({ resourcesPath, environment = process.env, read = readFile } = {}) {
  if (environment.YNX_WALLETCONNECT_PROJECT_ID !== undefined && environment.YNX_WALLETCONNECT_PROJECT_ID !== "") return buildPublicWalletConnectConfig(environment);
  if (typeof resourcesPath !== "string" || !path.isAbsolute(resourcesPath)) throw invalid();
  let bytes;
  try { bytes = await read(path.join(resourcesPath, WALLETCONNECT_PUBLIC_CONFIG_FILE)); }
  catch (error) { if (error?.code === "ENOENT") return publicWalletConnectConfig(); throw invalid(); }
  if (bytes.length > 2048) throw invalid();
  try { return parsePublicWalletConnectConfig(JSON.parse(bytes.toString("utf8"))); }
  catch { throw invalid(); }
}
