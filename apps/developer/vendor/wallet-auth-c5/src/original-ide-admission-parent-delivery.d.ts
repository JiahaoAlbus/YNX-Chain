/** Private original backend only. No current successful supply branch until
 * independently qualified native parent/executor source is actually linked. */
export interface OriginalIDEAdmissionParentDelivery {
  readonly descriptor: 4;
  assertCurrent(expectedRequest?: unknown): Promise<void>;
  close(): void | Promise<void>;
}
export declare function acquireOriginalIDEAdmissionParentDelivery(actualEntryURL: string): Promise<OriginalIDEAdmissionParentDelivery | null>;
