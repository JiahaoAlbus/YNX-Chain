export declare class ProductSessionControlNodeHost {
  constructor(registry: unknown, options: Readonly<{ now: () => Date; statePath: string; tokenFactory: () => string }>);
  handler(): (request: unknown, response: unknown) => Promise<void>;
  snapshot(): Readonly<Record<string, unknown>>;
}
