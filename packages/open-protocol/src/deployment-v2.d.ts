/** Canonical decimal U64 and lower-case raw SHA3-512 / SHA-512 hex. DATA only. */
export interface DeploymentV2Bind {readonly bytes:string;readonly sha3_512:string;readonly sha512:string}
export declare function bindDeploymentV2Bytes(actual:Uint8Array):DeploymentV2Bind;
export declare function encodeDeploymentV2Bind(value:DeploymentV2Bind):Uint8Array;
export declare function decodeDeploymentV2Bind(wire:Uint8Array):DeploymentV2Bind;
export declare function assertDeploymentV2BytesBinding(actual:Uint8Array,expected:DeploymentV2Bind):DeploymentV2Bind;
export declare const DEPLOYMENT_MANIFEST_V2_DOMAIN:'YNX-CLOUD-DEPLOYMENT-MANIFEST/v2';
export declare const DEPLOYMENT_MANIFEST_V2_MAX_BYTES:16384;
export declare const DEPLOYMENT_ARTIFACT_V2_MAX_BYTES:67108864;
/** UTF8 opaque fullRef profile; rev does not imply any epoch or currentness. */
export interface DeploymentV2Ref {readonly realm:string;readonly tenant:string;readonly kind:string;readonly id:string;readonly rev:string}
export interface DeploymentV2FileObj {readonly ref:DeploymentV2Ref;readonly content:DeploymentV2Bind;readonly size:string;readonly mime:string;readonly objectKey:string}
export interface DeploymentManifestV2 {readonly realm:string;readonly tenant:string;readonly project:DeploymentV2Ref;readonly version:string;readonly artifact:DeploymentV2FileObj;readonly env:string;readonly publisher:DeploymentV2Ref;readonly publisherEpoch:string;readonly issuer:DeploymentV2Ref;readonly issuerEpoch:string}
export interface DeploymentManifestV2DATA {readonly payloadOriginal:Uint8Array;readonly binding:DeploymentV2Bind}
export declare function createDeploymentManifestV2DATA(input:DeploymentManifestV2,actualArtifact:Uint8Array):DeploymentManifestV2DATA;
export declare function decodeDeploymentManifestV2DATA(payloadOriginal:Uint8Array,expectedFullBinding?:DeploymentV2Bind):DeploymentManifestV2;
export declare function assertDeploymentArtifactV2DATA(payloadOriginal:Uint8Array,actualArtifact:Uint8Array):DeploymentV2Bind;
