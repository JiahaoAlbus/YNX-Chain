import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_LOCALES } from "./i18n";
import { faucetRecoveryCopy } from "./faucetRecoveryCopy";

test("all advertised locales explain explicit local Faucet recovery without an English fallback", () => {
  const labels = new Set<string>(), messages = new Set<string>();
  for (const locale of SUPPORTED_LOCALES) {
    const copy = faucetRecoveryCopy(locale);
    assert.ok(copy.reload.trim().length > 4); assert.ok(copy.paused.trim().length > 20);
    assert.doesNotMatch(copy.reload + copy.paused, /[\u202a-\u202e\u2066-\u2069]/u);
    labels.add(copy.reload); messages.add(copy.paused);
  }
  assert.equal(labels.size, SUPPORTED_LOCALES.length);
  assert.equal(messages.size, SUPPORTED_LOCALES.length);
  assert.match(faucetRecoveryCopy("en").paused, /Nothing will be sent/);
  assert.match(faucetRecoveryCopy("zh-Hans").paused, /不会发送请求/);
  assert.match(faucetRecoveryCopy("ar").paused, /لن يتم إرسال/);
});
