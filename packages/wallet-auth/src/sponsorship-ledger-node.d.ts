import type { SponsorshipBinding, SponsorshipPolicy, UserOperationEnvelope } from "./index.js";

export declare class DurableSponsorshipAuthorizationLedger {
  constructor(options: { statePath: string; maximumConsumed?: number; onCommitted?: (event: Readonly<{ size: number }>) => void });
  readonly size: number;
  authorize(
    operation: UserOperationEnvelope | unknown,
    request: unknown,
    policy: SponsorshipPolicy | unknown,
    binding: SponsorshipBinding | unknown,
    at?: Date,
  ): Readonly<{ eligible: boolean; reasons: readonly string[]; policyId: string; userOperationDigest: string; paymaster: string; approvedCost: number; remainingSubjectBudget: number; remainingSponsorBudget: number }>;
}
export declare function recoverStaleSponsorshipStateLock(
  statePath: string,
  options: { minimumAgeMs: number },
): Readonly<{ ageMs: number; ownerPid: number; recovered: true }>;
