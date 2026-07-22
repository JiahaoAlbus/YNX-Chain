export interface QuantClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}
export interface Approval { approved: boolean }
export declare class QuantClient {
  constructor(options?: QuantClientOptions);
  health(): Promise<Record<string, unknown>>;
  snapshot(): Promise<Record<string, unknown>>;
  killSwitch(input: Approval & {reason: string}): Promise<Record<string, unknown>>;
  revokeMandate(input: Approval & {digest: string; actor: string}): Promise<Record<string, unknown>>;
}
