import assert from "node:assert/strict";
import test from "node:test";
import { authorizeLocalKeyUseWith, type AuthorizationPurpose, type LocalAuthenticationAdapter } from "./localAuthorizationPolicy";

type Options = Parameters<LocalAuthenticationAdapter["authenticate"]>[0];

function adapter(overrides: Partial<{
  hardware: boolean;
  enrolled: boolean;
  level: number;
  result: Readonly<{success:boolean;error?:string}>;
}> = {}) {
  const calls: string[] = [], options: Options[] = [];
  const value: LocalAuthenticationAdapter = {
    strongSecurityLevel: 3,
    async hasHardware() { calls.push("hardware"); return overrides.hardware ?? true; },
    async isEnrolled() { calls.push("enrolled"); return overrides.enrolled ?? true; },
    async enrolledLevel() { calls.push("level"); return overrides.level ?? 3; },
    async authenticate(input) { calls.push("authenticate"); options.push(input); return overrides.result ?? { success: true }; },
  };
  return { value, calls, options };
}

test("every private-key purpose requires strong biometrics with device fallback disabled", async () => {
  const purposes: AuthorizationPurpose[] = ["unlock", "wallet-authorization", "exchange-order", "quant-strategy-action", "dex-transaction", "developer-contract-deployment", "transaction-sign", "recovery-view", "account-import", "account-delete"];
  for (const purpose of purposes) {
    const fixture = adapter();
    await authorizeLocalKeyUseWith(fixture.value, purpose);
    assert.deepEqual(fixture.calls, ["hardware", "enrolled", "level", "authenticate"]);
    assert.equal(fixture.options.length, 1);
    assert.deepEqual({ ...fixture.options[0], promptMessage: "<bounded-purpose>" }, {
      promptMessage: "<bounded-purpose>",
      cancelLabel: "Cancel",
      disableDeviceFallback: true,
      fallbackLabel: "",
      requireConfirmation: true,
      biometricsSecurityLevel: "strong",
    });
    assert.ok(fixture.options[0]?.promptMessage.length);
  }
});

test("missing hardware, enrollment and strong level fail before authentication", async () => {
  const cases = [
    { fixture: adapter({ hardware: false }), error: /hardware is unavailable/, calls: ["hardware"] },
    { fixture: adapter({ enrolled: false }), error: /Enroll Face ID or a strong fingerprint/, calls: ["hardware", "enrolled"] },
    { fixture: adapter({ level: 2 }), error: /Strong system biometrics are required/, calls: ["hardware", "enrolled", "level"] },
  ];
  for (const item of cases) {
    await assert.rejects(authorizeLocalKeyUseWith(item.fixture.value, "unlock"), item.error);
    assert.deepEqual(item.fixture.calls, item.calls);
    assert.equal(item.fixture.options.length, 0);
  }
});

test("cancel, authentication failure and unknown purposes never authorize", async () => {
  await assert.rejects(authorizeLocalKeyUseWith(adapter({ result: { success: false, error: "user_cancel" } }).value, "wallet-authorization"), /was cancelled/);
  await assert.rejects(authorizeLocalKeyUseWith(adapter({ result: { success: false, error: "authentication_failed" } }).value, "transaction-sign"), /authorization failed/);
  const unknown = adapter();
  await assert.rejects(authorizeLocalKeyUseWith(unknown.value, "unknown" as AuthorizationPurpose), /Unknown Wallet biometric authorization purpose/);
  assert.deepEqual(unknown.calls, []);
});
