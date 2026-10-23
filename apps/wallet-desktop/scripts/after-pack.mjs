import { execFileSync } from "node:child_process";
import path from "node:path";
import { writeFile,readFile } from "node:fs/promises";
import { desktopReleaseIdentity, relocateDesktopPackage as assembleCanonicalDesktopPackage, desktopAsarHeaderIntegrity } from "./release-provenance.mjs";
import { buildPublicWalletConnectConfig, WALLETCONNECT_PUBLIC_CONFIG_FILE } from "../src/walletconnect-public-config.mjs";
import {installPackagedPQVerifierAssets} from './packaged-proof-verifier.mjs';
import {originalPQVerifierReceipt} from '../src/wallet-pq-runtime-component.mjs';
import {stageOriginalR155HelperBundle} from './r155-native-component.mjs';
import {stageSDK13HelperBundle} from './sdk13-native-component.mjs';

export function updatedMacAsarIntegrity(existing, relocated) {
  if(!existing||typeof existing!=="object"||Array.isArray(existing)||existing["Resources/app.asar"]?.algorithm!=="SHA256"||relocated?.algorithm!=="SHA256"||!/^[a-f0-9]{64}$/.test(relocated.hash)) throw new Error("Expected normal Mac ASAR integrity metadata");
  return {...existing,"Resources/app.asar":{algorithm:"SHA256",hash:relocated.hash}};
}

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
  // Source-owned canonical path assembly runs before entrypoint evaluation.
  // Keep every JS byte unchanged, one SDK copy plus its package alias, and the
  // same sole native file moved to code/apps/wallet-desktop/native.
  assembleCanonicalDesktopPackage(resources, context.packager.projectDir);
  await writeFile(path.join(resources, WALLETCONNECT_PUBLIC_CONFIG_FILE), JSON.stringify(buildPublicWalletConnectConfig(), null, 2) + "\n");
  if (context.electronPlatformName !== "darwin") return;
  const sdk=JSON.parse(await readFile(path.resolve(context.packager.projectDir,'../../packages/wallet-auth/package.json'),'utf8'));
  if(['1.3.0-pq.3.32-auth.5','1.3.0-pq.3.32-auth.6'].includes(sdk.version)){
    if(context.arch!==3)throw Error('Original R155 paired component is arm64 only');
    stageOriginalR155HelperBundle({contents:path.join(context.appOutDir,`${context.packager.appInfo.productFilename}.app`,'Contents'),projectDir:context.packager.projectDir});
  }
  if(['1.3.0-pq.3.32-auth.13','1.3.0-pq.3.32-auth.14','1.3.0-pq.3.32-auth.18','1.3.0-pq.3.32-auth.19'].includes(sdk.version))stageSDK13HelperBundle({contents:path.join(context.appOutDir,`${context.packager.appInfo.productFilename}.app`,'Contents'),projectDir:context.packager.projectDir});
  // builder-util Arch.arm64 is 3; other platform/architecture builds do not
  // inherit this arm64-only proof executable or falsely report it available.
  if(context.arch===3)await installPackagedPQVerifierAssets(resources,process.env.YNX_WALLET_PROOF_VERIFIER_RESOURCES_STAGE,originalPQVerifierReceipt);
  // electron-builder writes this header hash BEFORE afterPack. Refresh only
  // this archive's entry before signing; never disable the integrity fuse or
  // discard integrity entries for other archives.
  const plist=path.join(context.appOutDir,`${context.packager.appInfo.productFilename}.app`,"Contents","Info.plist");
  const existing=JSON.parse(execFileSync("plutil",["-extract","ElectronAsarIntegrity","json","-o","-",plist],{encoding:"utf8"}));
  const updated=updatedMacAsarIntegrity(existing,desktopAsarHeaderIntegrity(resources,context.packager.projectDir));
  execFileSync("plutil",["-replace","ElectronAsarIntegrity","-json",JSON.stringify(updated),plist]);
  hardenMacInfoPlist(context.appOutDir, context.packager.appInfo.productFilename, context.packager.appInfo.version);
}
