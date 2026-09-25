export type HostedWalletAdapter = Readonly<{
  connect: () => Promise<readonly string[]>;
  request: (input: {method: string; params?: readonly unknown[]}) => Promise<unknown>;
  restore: () => Promise<readonly string[]>;
  disconnect: () => Promise<void>;
  revoke: () => Promise<void>;
  detach: () => Promise<void>;
  on: (event: string, listener: (...args: readonly unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: readonly unknown[]) => void) => void;
  readonly connected: boolean;
  readonly account: string | null;
}>;
export function createHostedWalletAdapter(input?: {window?: Window; walletOrigin?: string}): HostedWalletAdapter;
