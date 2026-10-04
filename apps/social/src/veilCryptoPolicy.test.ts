import assert from "node:assert/strict";
import test from "node:test";
import {
  decideVeilApplicationWrite, decideVeilRecipientSet, VEIL_LIBSIGNAL_PIN,
  type VeilWriteContext, type VeilWriteBlocker,
} from "./veilCryptoPolicy";

// Synthetic metadata only. No real libsignal, keys, activation or review proof.
const fixture = (): VeilWriteContext => ({
  platform: "ios",
  core: { implementation: "libsignal", version: VEIL_LIBSIGNAL_PIN.version,
    sourceCommit: VEIL_LIBSIGNAL_PIN.commit, bridge: "swift", bridgeVerified: true, licenseApproved: true },
  requestedBinding: { conversationId: "conversation-1", senderDeviceId: "sender-1", recipientIdentityId: "peer-1", recipientDeviceId: "device-1" },
  sessionBinding: { conversationId: "conversation-1", senderDeviceId: "sender-1", recipientIdentityId: "peer-1", recipientDeviceId: "device-1" },
  protocol: "veil-v2", identityVerified: true, deviceStatus: "approved", deviceProof: "trusted-device",
  revocationFreshUntilMs: 2000, nowMs: 1000, pqxdh: "confirmed", spqr: "key-mixed",
  migration: "confirmed", activationApproved: true,
});
test("fully confirmed metadata permits only the subsequent native write operation", () => {
  const result = decideVeilApplicationWrite(fixture());
  assert.equal(result.canWrite, true);
  assert.equal(result.activePqIdentityAuthentication, "not-reviewed");
  assert.equal(Object.isFrozen(result), true);
});

for (const [field, blocker] of [
  ["bridgeVerified", "BRIDGE_NOT_VERIFIED"],
  ["licenseApproved", "LICENSE_NOT_APPROVED"],
  ["identityVerified", "IDENTITY_NOT_VERIFIED"],
  ["activationApproved", "ACTIVATION_NOT_APPROVED"],
] as const) {
  test(`${field} requires an explicit primitive boolean approval`, () => {
    for (const malformed of ["true", "false", 1, -1, {}, [], new Boolean(true), null, undefined]) {
      const value = fixture();
      const target = field === "bridgeVerified" || field === "licenseApproved" ? value.core! : value;
      assert.equal(Reflect.set(target, field, malformed), true);
      assert.equal(decideVeilApplicationWrite(value).blocker, blocker);
      assert.equal(decideVeilRecipientSet([value]).canWrite, false);
    }
  });
}
const rejected: readonly [string, (value: VeilWriteContext) => VeilWriteContext, VeilWriteBlocker][] = [
  ["missing core", value => ({ ...value, core: null }), "CORE_UNAVAILABLE"],
  ["wrong version", value => ({ ...value, core: { ...value.core!, version: "old" } }), "DEPENDENCY_PIN_MISMATCH"],
  ["wrong source", value => ({ ...value, core: { ...value.core!, sourceCommit: "other" } }), "DEPENDENCY_PIN_MISMATCH"],
  ["Node is not browser", value => ({ ...value, platform: "browser", core: { ...value.core!, bridge: "node" } }), "BRIDGE_NOT_VERIFIED"],
  ["unverified browser bridge", value => ({ ...value, platform: "browser", core: { ...value.core!, bridge: "browser", bridgeVerified: false } }), "BRIDGE_NOT_VERIFIED"],
  ["license not approved", value => ({ ...value, core: { ...value.core!, licenseApproved: false } }), "LICENSE_NOT_APPROVED"],
  ["invalid identity binding", value => ({ ...value, requestedBinding: { ...value.requestedBinding, recipientIdentityId: "bad\nidentity" } }), "BINDING_INVALID"],
  ["cross-device session", value => ({ ...value, sessionBinding: { ...value.sessionBinding, recipientDeviceId: "other-device" } }), "BINDING_MISMATCH"],
  ["old XChaCha no fallback", value => ({ ...value, protocol: "legacy-xchacha" }), "LEGACY_WRITE_FORBIDDEN"],
  ["Olm no fallback", value => ({ ...value, protocol: "olm" }), "LEGACY_WRITE_FORBIDDEN"],
  ["Megolm no dual send", value => ({ ...value, protocol: "megolm" }), "LEGACY_WRITE_FORBIDDEN"],
  ["unverified identity", value => ({ ...value, identityVerified: false }), "IDENTITY_NOT_VERIFIED"],
  ["revoked device", value => ({ ...value, deviceStatus: "revoked" }), "DEVICE_NOT_AUTHORIZED"],
  ["SSO cannot grant crypto", value => ({ ...value, deviceProof: "sso" }), "DEVICE_NOT_AUTHORIZED"],
  ["stale revocation", value => ({ ...value, revocationFreshUntilMs: 1000 }), "REVOCATION_NOT_FRESH"],
  ["invalid time", value => ({ ...value, nowMs: NaN }), "REVOCATION_NOT_FRESH"],
  ["PQXDH pending", value => ({ ...value, pqxdh: "pending" }), "PQXDH_NOT_CONFIRMED"],
  ["SPQR library is not key mixture", value => ({ ...value, spqr: "bootstrap" }), "SPQR_NOT_KEY_MIXED"],
  ["migration pending", value => ({ ...value, migration: "pending" }), "MIGRATION_NOT_CONFIRMED"],
  ["activation not approved", value => ({ ...value, activationApproved: false }), "ACTIVATION_NOT_APPROVED"],
];
for (const [name, mutate, blocker] of rejected) test(name, () => {
  assert.deepEqual(decideVeilApplicationWrite(mutate(fixture())), {
    canWrite: false, blocker, activePqIdentityAuthentication: "not-reviewed",
  });
});
test("empty fanout is rejected", () => assert.equal(decideVeilRecipientSet([]).blocker, "RECIPIENT_SET_INVALID"));
test("duplicate device is rejected", () => assert.equal(decideVeilRecipientSet([fixture(), fixture()]).blocker, "RECIPIENT_SET_INVALID"));
test("fanout remains bounded", () => assert.equal(decideVeilRecipientSet(Array.from({ length: 33 }, fixture)).blocker, "RECIPIENT_SET_INVALID"));
test("one revoked recipient stops fanout", () => assert.equal(decideVeilRecipientSet([fixture(), { ...fixture(), deviceStatus: "revoked" }]).blocker, "DEVICE_NOT_AUTHORIZED"));
test("independent recipient devices can pass policy without sharing a sender key", () => {
  const second = fixture();
  assert.equal(decideVeilRecipientSet([fixture(), { ...second,
    requestedBinding: { ...second.requestedBinding, recipientDeviceId: "device-2" },
    sessionBinding: { ...second.sessionBinding, recipientDeviceId: "device-2" },
  }]).canWrite, true);
});
