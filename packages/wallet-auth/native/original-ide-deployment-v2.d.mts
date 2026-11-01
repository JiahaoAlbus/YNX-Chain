import type {DeploymentV2Bind} from '@ynx-chain/open-protocol/deployment-v2';
export interface OriginalIDEDeploymentV2PublicPartial {
 readonly phase:string;
 readonly payloadOriginal:string;
 readonly payloadBinding:DeploymentV2Bind;
 readonly artifactBinding:DeploymentV2Bind;
 readonly sourceCurrentOriginal:string;
 readonly reservationOriginal:string;
 readonly memberOriginal:string;
 readonly coreStatus:number|null;readonly cleanupStatus:number|null;readonly reportedStatus:number|null;
 readonly signed:boolean;
 readonly sourceGranted:false;
 readonly nativeAdmission:false;
 readonly deployed:false;
}
export interface OriginalIDEDeploymentV2Signer {
 /** Exact independently approved E11 bytes + actual immutable content only.
  * No caller Root/key/epoch/purpose/provider or legacy six-field overload. */
 signOriginalE11(payloadOriginal:Uint8Array,actualArtifact:Uint8Array):Promise<OriginalIDEDeploymentV2PublicPartial>;
 retire():void;join():void;close():void;
 status():Readonly<{used:boolean;unknown:boolean;firstCause:string|null;closeSelected:boolean;closeFirst:string|null;closed:boolean;partial:OriginalIDEDeploymentV2PublicPartial|null}>;
}
/** No config/Root/callback/JSON authority input. Normal table is currently empty.
 * If acquisition ever returns a nonnil partial, caller owns it BEFORE error. */
export function acquireOriginalIDEDeploymentV2Signer():Readonly<{owner:OriginalIDEDeploymentV2Signer;error:Error|null}>;
