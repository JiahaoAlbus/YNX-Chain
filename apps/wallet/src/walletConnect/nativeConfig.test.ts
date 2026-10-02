import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const walletRoot = join(import.meta.dirname, "../..");
const cameraDescription =
  "YNX Wallet uses the camera only when you choose to scan a WalletConnect QR code.";

test("checked-in native projects match the Expo camera configuration", () => {
  const appConfig = JSON.parse(
    readFileSync(join(walletRoot, "app.json"), "utf8"),
  ).expo;
  const cameraPlugin = appConfig.plugins.find(
    (plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-camera",
  );

  assert.ok(cameraPlugin, "expo-camera plugin must be configured");
  assert.equal(cameraPlugin[1]?.cameraPermission, cameraDescription);
  assert.ok(appConfig.android.permissions.includes("CAMERA"));

  const androidManifest = readFileSync(
    join(walletRoot, "android/app/src/main/AndroidManifest.xml"),
    "utf8",
  );
  assert.equal(
    androidManifest.match(/android\.permission\.CAMERA/g)?.length,
    1,
    "Android camera permission must appear exactly once",
  );

  const iosInfoPlist = readFileSync(
    join(walletRoot, "ios/YNXWallet/Info.plist"),
    "utf8",
  );
  assert.match(
    iosInfoPlist,
    new RegExp(
      `<key>NSCameraUsageDescription<\\/key>\\s*<string>${cameraDescription.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )}<\\/string>`,
    ),
  );
});
