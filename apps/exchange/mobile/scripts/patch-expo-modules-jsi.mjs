import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceUrl = new URL(
  "../node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift",
  import.meta.url,
);
const sourcePath = fileURLToPath(sourceUrl);
const upstreamLine =
  "guard milliseconds.isFinite, abs(milliseconds) <= maxJavaScriptDateMilliseconds else {";
const patchedLine =
  "guard milliseconds.isFinite, milliseconds.magnitude <= maxJavaScriptDateMilliseconds else {";

const source = await readFile(sourcePath, "utf8");

if (source.includes(patchedLine)) {
  console.log("[exchange-mobile] expo-modules-jsi Swift 6.2 patch already applied");
  process.exit(0);
}

const matches = source.split(upstreamLine).length - 1;
if (matches !== 1) {
  throw new Error(
    `Refusing to patch expo-modules-jsi: expected one upstream Date guard, found ${matches}. Review the pinned dependency before changing this script.`,
  );
}

await writeFile(sourcePath, source.replace(upstreamLine, patchedLine), "utf8");
console.log("[exchange-mobile] patched expo-modules-jsi Date guard for Swift 6.2");
