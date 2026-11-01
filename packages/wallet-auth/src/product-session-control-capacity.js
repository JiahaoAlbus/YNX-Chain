import { exactFields, WalletAuthError } from "./canonical.js";

// A configurable, bounded single-snapshot service tier, not an unlimited-user
// storage architecture. Reservations are derived from durable owner history;
// neither changing policy nor reaching a limit deletes that history.
export const PRODUCT_SESSION_CONTROL_MAX_INTENTS = 10_000;
export const DEFAULT_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY = Object.freeze({ maxOwners: 256, intentsPerOwner: 32 });

export function parseProductSessionControlCapacityPolicy(input = DEFAULT_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY) {
  exactFields(input, ["maxOwners", "intentsPerOwner"], "Control capacity policy");
  for (const field of ["maxOwners", "intentsPerOwner"]) if (!Number.isSafeInteger(input[field]) || input[field] < 1 || input[field] > PRODUCT_SESSION_CONTROL_MAX_INTENTS) fail("INVALID_CONTROL_CAPACITY_POLICY", "Control owner and intent limits must be positive integers within the snapshot limit");
  if (input.maxOwners * input.intentsPerOwner > PRODUCT_SESSION_CONTROL_MAX_INTENTS) fail("INVALID_CONTROL_CAPACITY_POLICY", "Every admitted owner must have a reserved intent allocation within the snapshot limit");
  return Object.freeze({ maxOwners: input.maxOwners, intentsPerOwner: input.intentsPerOwner });
}

/** Input must already have passed the complete V3 snapshot parser. */
export function inspectProductSessionControlCapacity(snapshot, policyInput) {
  const policy = parseProductSessionControlCapacityPolicy(policyInput);
  const counts = new Map();
  for (const item of [...snapshot.authority.sessions, ...snapshot.authority.issuedChallenges, ...snapshot.authority.revokedAccounts, ...snapshot.authority.revokedDeviceScopes]) counts.set(item.account, 0);
  for (const { intent } of snapshot.controlIntents) counts.set(intent.account, (counts.get(intent.account) ?? 0) + 1);
  const reservedIntents = [...counts.values()].reduce((total, count) => total + Math.max(policy.intentsPerOwner, count), 0);
  return { policy, counts, admittedOwners: counts.size, reservedIntents, overReserved: counts.size > policy.maxOwners || reservedIntents > PRODUCT_SESSION_CONTROL_MAX_INTENTS };
}

export function assertProductSessionControlOwnerAdmission(snapshot, account, policyInput) {
  const capacity = inspectProductSessionControlCapacity(snapshot, policyInput);
  // Existing history is grandfathered; lowering a tier cannot invalidate old
  // approvals or prevent exact receipt recovery. No new owner can take its slots.
  if (capacity.counts.has(account)) return capacity;
  if (capacity.admittedOwners >= capacity.policy.maxOwners || capacity.reservedIntents + capacity.policy.intentsPerOwner > PRODUCT_SESSION_CONTROL_MAX_INTENTS) fail("CONTROL_OWNER_ADMISSION", "New owner admission is full; existing owner reservations and receipts are retained");
  return capacity;
}

export function assertProductSessionControlOwnerIntentCapacity(snapshot, account, policyInput) {
  const capacity = assertProductSessionControlOwnerAdmission(snapshot, account, policyInput);
  if ((capacity.counts.get(account) ?? 0) >= capacity.policy.intentsPerOwner) fail("CONTROL_OWNER_CAPACITY", "This owner has reached its permanent intent allocation; retry existing intents or use individual session revocation");
  if (capacity.reservedIntents > PRODUCT_SESSION_CONTROL_MAX_INTENTS) fail("CONTROL_OWNER_ADMISSION", "Legacy owner reservations exceed this snapshot tier; existing receipts remain recoverable");
}

export function productSessionControlPublicCapacityPolicy(policyInput) {
  const policy = parseProductSessionControlCapacityPolicy(policyInput);
  return Object.freeze({ ...policy, globalIntentLimit: PRODUCT_SESSION_CONTROL_MAX_INTENTS, snapshotByteLimit: 32 * 1024 * 1024, reservationUnit: "permanent-intent-records", receiptRetention: "preserve-until-explicit-future-ack-protocol", serviceTier: "bounded-single-snapshot", productionConcurrencyValidated: false });
}

function fail(code, message) { throw new WalletAuthError(code, message); }
