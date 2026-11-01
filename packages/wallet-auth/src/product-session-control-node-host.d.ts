import type {ProductSessionV2} from './index.js';
export declare class ProductSessionControlNodeHost {
  static readonly businessRevalidationSupported:true;
  constructor(registry: unknown, options: Readonly<{ now: () => Date; statePath: string; tokenFactory: () => string; capacityPolicy?: Readonly<{ maxOwners: number; intentsPerOwner: number }> }>);
  revalidate(session:ProductSessionV2,scopes:readonly string[],productId:string,at:Date,businessRevalidation?:boolean):Readonly<{active:true;session:ProductSessionV2}>;
  handler(): (request: unknown, response: unknown) => Promise<void>;
  snapshot(): Readonly<Record<string, unknown>>;
}
