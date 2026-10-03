/** Draft Veil v2 integration policy, not a cryptographic implementation.
 * Inputs must come from the controlled native CryptoEngine and approved policy,
 * never from a server capability string, UI checkbox or Product Session token.
 * An allow decision still requires the native atomic ratchet/outbox operation.
 */
export const VEIL_LIBSIGNAL_PIN = Object.freeze({
  version: "0.104.0",
  commit: "257105c55a7389ca6b1e85185e2769465e6729f1",
});
export const VEIL_DRAFT_MAX_DEVICE_RECIPIENTS = 32;

export type VeilPlatform = "android" | "ios" | "macos" | "windows" | "linux" | "browser";
export type VeilBinding = Readonly<{
  conversationId: string;
  senderDeviceId: string;
  recipientIdentityId: string;
  recipientDeviceId: string;
}>;
export type VeilCoreEvidence = Readonly<{
  implementation: string;
  version: string;
  sourceCommit: string;
  bridge: "jni" | "swift" | "node" | "browser";
  bridgeVerified: boolean;
  licenseApproved: boolean;
}>;
export type VeilWriteContext = Readonly<{
  platform: VeilPlatform;
  core: VeilCoreEvidence | null;
  requestedBinding: VeilBinding;
  sessionBinding: VeilBinding;
  protocol: "veil-v2" | "legacy-xchacha" | "olm" | "megolm";
  identityVerified: boolean;
  deviceStatus: "approved" | "revoked" | "unknown";
  deviceProof: "trusted-device" | "user-recovery" | "sso" | "none";
  revocationFreshUntilMs: number;
  nowMs: number;
  pqxdh: "confirmed" | "pending" | "unknown";
  spqr: "key-mixed" | "bootstrap" | "unknown";
  migration: "confirmed" | "pending" | "unknown";
  activationApproved: boolean;
}>;
export type VeilWriteBlocker =
  | "CORE_UNAVAILABLE" | "DEPENDENCY_PIN_MISMATCH" | "BRIDGE_NOT_VERIFIED"
  | "LICENSE_NOT_APPROVED" | "BINDING_INVALID" | "BINDING_MISMATCH"
  | "LEGACY_WRITE_FORBIDDEN" | "IDENTITY_NOT_VERIFIED" | "DEVICE_NOT_AUTHORIZED"
  | "REVOCATION_NOT_FRESH" | "PQXDH_NOT_CONFIRMED" | "SPQR_NOT_KEY_MIXED"
  | "MIGRATION_NOT_CONFIRMED" | "ACTIVATION_NOT_APPROVED" | "RECIPIENT_SET_INVALID";
export type VeilWriteDecision = Readonly<{
  canWrite: boolean;
  blocker: VeilWriteBlocker | null;
  // PQXDH's classical authentication must not be presented as active PQ auth.
  activePqIdentityAuthentication: "not-reviewed";
}>;

const hold = (blocker: VeilWriteBlocker): VeilWriteDecision => Object.freeze({
  canWrite: false, blocker, activePqIdentityAuthentication: "not-reviewed",
});
const allowed: VeilWriteDecision = Object.freeze({
  canWrite: true, blocker: null, activePqIdentityAuthentication: "not-reviewed",
});
const bindingKeys = ["conversationId", "senderDeviceId", "recipientIdentityId", "recipientDeviceId"] as const;
const validBinding = (binding: VeilBinding): boolean => bindingKeys.every(key =>
  typeof binding[key] === "string" && /^[\x21-\x7e]{1,256}$/.test(binding[key]),
);

export function decideVeilApplicationWrite(context: VeilWriteContext): VeilWriteDecision {
  const core = context.core;
  if (!core) return hold("CORE_UNAVAILABLE");
  if (core.implementation !== "libsignal" || core.version !== VEIL_LIBSIGNAL_PIN.version ||
      core.sourceCommit !== VEIL_LIBSIGNAL_PIN.commit) return hold("DEPENDENCY_PIN_MISMATCH");
  const expectedBridge = context.platform === "android" ? "jni" :
    context.platform === "ios" ? "swift" : context.platform === "browser" ? "browser" : "node";
  if (!core.bridgeVerified || core.bridge !== expectedBridge) return hold("BRIDGE_NOT_VERIFIED");
  if (!core.licenseApproved) return hold("LICENSE_NOT_APPROVED");
  if (!validBinding(context.requestedBinding) || !validBinding(context.sessionBinding)) return hold("BINDING_INVALID");
  if (bindingKeys.some(key => context.requestedBinding[key] !== context.sessionBinding[key])) return hold("BINDING_MISMATCH");
  if (context.protocol !== "veil-v2") return hold("LEGACY_WRITE_FORBIDDEN");
  if (!context.identityVerified) return hold("IDENTITY_NOT_VERIFIED");
  if (context.deviceStatus !== "approved" ||
      (context.deviceProof !== "trusted-device" && context.deviceProof !== "user-recovery")) return hold("DEVICE_NOT_AUTHORIZED");
  if (!Number.isSafeInteger(context.nowMs) || context.nowMs < 0 ||
      !Number.isSafeInteger(context.revocationFreshUntilMs) || context.revocationFreshUntilMs <= context.nowMs) return hold("REVOCATION_NOT_FRESH");
  if (context.pqxdh !== "confirmed") return hold("PQXDH_NOT_CONFIRMED");
  if (context.spqr !== "key-mixed") return hold("SPQR_NOT_KEY_MIXED");
  if (context.migration !== "confirmed") return hold("MIGRATION_NOT_CONFIRMED");
  if (!context.activationApproved) return hold("ACTIVATION_NOT_APPROVED");
  return allowed;
}

/** Bounded pairwise fanout policy, not a shared sender-key encryption scheme. */
export function decideVeilRecipientSet(contexts: readonly VeilWriteContext[]): VeilWriteDecision {
  if (contexts.length === 0 || contexts.length > VEIL_DRAFT_MAX_DEVICE_RECIPIENTS) return hold("RECIPIENT_SET_INVALID");
  const seen = new Set<string>();
  const first = contexts[0]!;
  for (const context of contexts) {
    const decision = decideVeilApplicationWrite(context);
    if (!decision.canWrite) return decision;
    const binding = context.requestedBinding;
    if (binding.conversationId !== first.requestedBinding.conversationId ||
        binding.senderDeviceId !== first.requestedBinding.senderDeviceId) return hold("BINDING_MISMATCH");
    const recipient = JSON.stringify([binding.recipientIdentityId, binding.recipientDeviceId]);
    if (seen.has(recipient)) return hold("RECIPIENT_SET_INVALID");
    seen.add(recipient);
  }
  return allowed;
}
