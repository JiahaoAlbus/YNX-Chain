import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Android protects the native launch window before React starts", async () => {
  const source = await readFile(
    new URL("../../android/app/src/main/java/com/ynxweb4/wallet/MainActivity.kt", import.meta.url),
    "utf8",
  );
  const secure = source.indexOf("window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)");
  const reactStart = source.indexOf("super.onCreate(null)");
  assert.ok(secure >= 0, "MainActivity must set Android FLAG_SECURE");
  assert.ok(reactStart >= 0, "MainActivity must retain the React lifecycle call");
  assert.ok(secure < reactStart, "FLAG_SECURE must be set before React and the splash lifecycle start");
});
