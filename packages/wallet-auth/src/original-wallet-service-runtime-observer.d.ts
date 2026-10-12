import type {Server} from 'node:http';
declare const observerBrand: unique symbol;
declare const captureBrand: unique symbol;
export interface OriginalWalletServiceRuntimeObserver {readonly [observerBrand]: never}
export interface OriginalWalletServiceRuntimeObservation {
  readonly [captureBrand]: never;
  readonly binding: Readonly<{
    keyId:string;roleDigest:string;instanceId:string;currentReference:string;
    gatewayManifestDigest:string;registryDigest:string;
  }>;
  readonly sequence:number;
  /** Canonical original eight-field observation; metadata nonce is not signed. */
  readonly observationRaw:string;
}
export interface OriginalWalletServiceRuntimeObserverConfig {
  /** Opaque brand from actual original Host.captureOriginalWalletServiceRuntimeSource(). */
  hostSource: object;
  /** Already-listening original server using the exact captured handler as sole listener. */
  server: Server;
  instanceSource: Readonly<{
    rootPath:string;rootDigest:string;instancePath:string;instanceDigest:string;
    gatewayManifestPath:string;gatewayManifestDigest:string;
    registryPath:string;registryFileDigest:string;
  }>;
  /** Exact matcher only; the original publisher independently verifies the signed ROLE. */
  roleBinding:Readonly<{keyId:string;roleDigest:string;registryDigest:string}>;
  /** Fixed original pure, synchronous, bounded clock. Must return safe integer epoch ms. */
  originalNow:()=>number;
}
export function createOriginalWalletServiceRuntimeObserver(config:OriginalWalletServiceRuntimeObserverConfig):OriginalWalletServiceRuntimeObserver;
export function assertOriginalWalletServiceRuntimeObserver(observer:OriginalWalletServiceRuntimeObserver):void;
export function captureOriginalWalletServiceRuntimeObservation(observer:OriginalWalletServiceRuntimeObserver,sequence:number):OriginalWalletServiceRuntimeObservation;
export function assertOriginalWalletServiceRuntimeObservationCurrent(observer:OriginalWalletServiceRuntimeObserver,captured:OriginalWalletServiceRuntimeObservation):void;
/** Idempotent cleanup also permitted after expiry/invalid/source failure; never restores authority. */
export function closeOriginalWalletServiceRuntimeObserver(observer:OriginalWalletServiceRuntimeObserver):void;
