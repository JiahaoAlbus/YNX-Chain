import assert from "node:assert/strict";
import { test } from "node:test";
import type { LocalAuthenticationError, LocalAuthenticationOptions, LocalAuthenticationResult, SecurityLevel } from "expo-local-authentication";
import { authorizeLocalKeyUse, BIOMETRIC_STRONG, BIOMETRIC_WEAK, LocalAuthorizationError, type LocalAuthenticationAdapter } from "./localAuthorization";

test("fails closed when biometric hardware is unavailable", async () => {
  const adapter = fakeAdapter({ hasHardware: false });
  await rejectsWithCode(authorizeLocalKeyUse("ownership-proof", adapter), "unavailable");
  assert.equal(adapter.calls.authenticate, 0);
});

test("distinguishes absent biometric enrollment", async () => {
  const adapter = fakeAdapter({ enrolled: false });
  await rejectsWithCode(authorizeLocalKeyUse("identity-import", adapter), "not-enrolled");
  assert.equal(adapter.calls.authenticate, 0);
});

test("rejects weak biometrics before prompting", async () => {
  const adapter = fakeAdapter({ level: BIOMETRIC_WEAK });
  await rejectsWithCode(authorizeLocalKeyUse("recovery-key", adapter), "unavailable");
  assert.equal(adapter.calls.authenticate, 0);
});

for (const [error, code] of [
  ["user_cancel", "cancelled"],
  ["authentication_failed", "failed"],
  ["lockout", "locked-out"],
] as const) {
  test(`maps native ${error} without fallback`, async () => {
    const adapter = fakeAdapter({ error });
    await rejectsWithCode(authorizeLocalKeyUse("signed-post", adapter), code);
  });
}

test("accepts strong biometrics with an exact no-fallback prompt", async () => {
  const adapter = fakeAdapter();
  await authorizeLocalKeyUse("device-revocation", adapter);
  assert.equal(adapter.calls.authenticate, 1);
  assert.deepEqual(adapter.calls.options, {
    promptMessage: "Authorize YNX device revocation",
    cancelLabel: "Cancel",
    disableDeviceFallback: true,
    fallbackLabel: "",
    requireConfirmation: true,
    biometricsSecurityLevel: "strong",
  });
});

type FakeOptions = {
  hasHardware?: boolean;
  enrolled?: boolean;
  level?: SecurityLevel;
  error?: LocalAuthenticationError;
};

function fakeAdapter(options: FakeOptions = {}): LocalAuthenticationAdapter & { calls: { authenticate: number; options?: LocalAuthenticationOptions } } {
  const calls: { authenticate: number; options?: LocalAuthenticationOptions } = { authenticate: 0 };
  return {
    calls,
    hasHardwareAsync: async () => options.hasHardware ?? true,
    isEnrolledAsync: async () => options.enrolled ?? true,
    getEnrolledLevelAsync: async () => options.level ?? BIOMETRIC_STRONG,
    authenticateAsync: async (authOptions?: LocalAuthenticationOptions): Promise<LocalAuthenticationResult> => {
      calls.authenticate += 1;
      calls.options = authOptions;
      return options.error ? { success: false, error: options.error } : { success: true };
    },
  };
}

async function rejectsWithCode(promise: Promise<void>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof LocalAuthorizationError && error.code === code);
}
