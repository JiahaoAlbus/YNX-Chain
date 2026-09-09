import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

type LockPackage = {
  version?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
};

const packageLockPath = resolve(dirname(fileURLToPath(import.meta.url)), "../package-lock.json");
const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8")) as {
  packages: Record<string, LockPackage>;
};

test("Social keeps both xmldom dependency tracks on fixed releases", () => {
  const expoXml = packageLock.packages["node_modules/@xmldom/xmldom"];
  const plistXml = packageLock.packages["node_modules/plist/node_modules/@xmldom/xmldom"];
  const expoPlist = packageLock.packages["node_modules/@expo/plist"];
  const plist = packageLock.packages["node_modules/plist"];

  assert.equal(expoXml?.version, "0.8.15");
  assert.equal(expoXml?.integrity, "sha512-/5NV/vDALVFDXgLmfsy9TRCBlKwO2LNBFzpzvb9iIj+jR+eSc6DLYYvVOdivT/jm7MtU6TebYuRmzEOI7w40UA==");
  assert.equal(plistXml?.version, "0.9.12");
  assert.equal(plistXml?.integrity, "sha512-5AXjrcMClTryPe9LgZrygpB1lj7s0S9E0+W+AHaVKAVyHanafK86iPSvG5xHVSp/jC+VH1UXu0TAEmY279xH7A==");
  assert.equal(expoPlist?.version, "0.8.1");
  assert.equal(expoPlist?.dependencies?.["@xmldom/xmldom"], "^0.8.8");
  assert.equal(plist?.version, "3.1.1");
  assert.equal(plist?.dependencies?.["@xmldom/xmldom"], "^0.9.10");
});
