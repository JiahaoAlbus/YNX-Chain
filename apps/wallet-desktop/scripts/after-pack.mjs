import { execFileSync } from "node:child_process";
import path from "node:path";

export function hardenMacInfoPlist(appOutDir, productFilename) {
  const plist = path.join(appOutDir, `${productFilename}.app`, "Contents", "Info.plist");
  execFileSync("plutil", [
    "-replace",
    "NSAppTransportSecurity",
    "-json",
    JSON.stringify({ NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false }),
    plist
  ]);
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  hardenMacInfoPlist(context.appOutDir, context.packager.appInfo.productFilename);
}
