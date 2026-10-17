/** Private original backend only. Native returns the exact recognized owner.
 * A partial acquisition has descriptor -1 and is cleanup custody, not a guard.
 * The consumer retains it and selects its original close once. */
export interface OriginalIDEAdmissionParentDelivery {
  readonly descriptor: 4 | -1;
  assertCurrent(expectedRequest?: unknown): Promise<void>;
  close(): void | Promise<void>;
}
export declare function acquireOriginalIDEAdmissionParentDelivery(actualEntryURL: string): Promise<OriginalIDEAdmissionParentDelivery | null>;
