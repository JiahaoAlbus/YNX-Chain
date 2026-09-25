import { execFileSync } from "node:child_process";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { desktopReleaseIdentity } from "./release-provenance.mjs";

export function hardenMacInfoPlist(appOutDir, productFilename, version) {
  const plist = path.join(appOutDir, `${productFilename}.app`, "Contents", "Info.plist");
  execFileSync("plutil", ["-replace", "CFBundleIdentifier", "-string", "com.ynxweb4.wallet.macos", plist]);
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("macOS package version is invalid");
  execFileSync("plutil", ["-replace", "CFBundleShortVersionString", "-string", version, plist]);
  execFileSync("plutil", ["-replace", "LSMinimumSystemVersion", "-string", "13.0", plist]);
  execFileSync("plutil", [
    "-replace",
    "CFBundleURLTypes",
    "-json",
    JSON.stringify([{
      CFBundleURLName: "com.ynxweb4.wallet.authorization",
      CFBundleURLSchemes: ["ynxwallet"]
    }]),
    plist
  ]);
  execFileSync("plutil", [
    "-replace",
    "NSAppTransportSecurity",
    "-json",
    JSON.stringify({ NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false }),
    plist
  ]);
}

export default async function afterPack(context) {
  const identity = desktopReleaseIdentity(context.packager.projectDir, context.packager.appInfo.version);
  const resources = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  await writeFile(path.join(resources, "ynx-wallet-build-identity.json"), JSON.stringify(identity, null, 2) + "\n");
  if (context.electronPlatformName !== "darwin") return;
  hardenMacInfoPlist(context.appOutDir, context.packager.appInfo.productFilename, context.packager.appInfo.version);
}
