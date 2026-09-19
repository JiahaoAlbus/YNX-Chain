export declare class ProductSessionControlNodeHost {
  constructor(registry: unknown, options: Readonly<{ now: () => Date; statePath: string; tokenFactory: () => string; capacityPolicy?: Readonly<{ maxOwners: number; intentsPerOwner: number }> }>);
  handler(): (request: unknown, response: unknown) => Promise<void>;
  snapshot(): Readonly<Record<string, unknown>>;
}
