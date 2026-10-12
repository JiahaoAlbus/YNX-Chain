import { lstat, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// A installs this backend-only operator adapter after the real central SSO
// callback/PKCE grant storage, isolated proxy, filesystem quota and egress are
// reviewed. No workspace/package/extension can select or alter executable config.
export async function loadCoreAdmissionAdapter(path, context) {
  if (!path) return {};
  if (!/^\/etc\/ynx-developer\/adapters\/[a-z0-9-]+\.mjs$/.test(path)) throw new Error("Core admission adapter must be an operator-owned /etc/ynx-developer/adapters module.");
  for (const parent of ["/etc/ynx-developer", "/etc/ynx-developer/adapters", path]) {
    const stat = await lstat(parent);
    if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0 || await realpath(parent) !== parent)
      throw new Error("Core admission adapter/configuration is not root-owned and protected.");
  }
  const module = await import(pathToFileURL(path).href);
  if (typeof module.createDeveloperCoreAdmission !== "function") throw new Error("Core admission adapter factory is missing.");
  const value = await module.createDeveloperCoreAdmission(context);
  if (!value || typeof value.launchURL !== "function" ||
    typeof value.sessionForHost !== "function" || typeof value.originForSession !== "function" ||
    typeof value.driver?.start !== "function" || typeof value.driver?.stop !== "function" || typeof value.driver?.connect !== "function")
    throw new Error("Core admission adapter did not provide verified identity, isolated proxy and execution driver.");
  return value;
}
