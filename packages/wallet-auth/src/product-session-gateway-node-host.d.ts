export declare const PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION: 1;
export declare class ProductSessionGatewayNodeHost {
  constructor(registry: unknown, options: Readonly<{ now: () => Date; statePath: string; tokenFactory: () => string }>);
  handler(): (request: unknown, response: unknown) => Promise<void>;
  snapshot(): Readonly<Record<string, unknown>>;
}
