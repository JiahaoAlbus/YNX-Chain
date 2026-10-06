import type { ApplicationActionRequest, ApplicationActionResult } from "./index.js";

export type ApplicationActionLaunchTarget = Readonly<{
  status: "ready";
  installation: "unknown";
  automatic: false;
  requestDigest: string;
  walletURL: string;
  callback: string;
  downloadURL: string;
  expiresAt: string;
}>;

export type ApplicationActionLauncher = Readonly<{
  prepare(): Promise<ApplicationActionLaunchTarget | Readonly<{ status: "no-pending-request"; installation: "unknown"; automatic: false }>>;
  open(event: MouseEvent, expectedRequestDigest: string): Readonly<{ status: "launch-attempted"; installation: "unknown"; automatic: false; requestDigest: string }>;
  /** First live parse only, not durable consumption. DEX uses its existing
   * journal.acceptReturn directly to retain historical duplicate recovery. */
  handleReturn(url: string): Promise<ApplicationActionResult>;
  invalidate(): void;
  dispose(): void;
}>;

export declare function createApplicationActionLauncher(registry: unknown, options: {
  productId: "dex";
  /** Return the product's already committed original request, never a new one. */
  loadPendingRequest(): Promise<ApplicationActionRequest | null>;
  /** Synchronous selected native account read, checked again at user click. */
  getActiveAccount(): string | null;
  now?(): Date;
  environment?: Window;
}): ApplicationActionLauncher;
