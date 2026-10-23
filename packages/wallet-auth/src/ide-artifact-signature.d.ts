/** Original Protocol publisher DATA binding. Values must be supplied and kept
 * current by original Auth; this type does not establish that provenance. */
export interface IDEArtifactPublisherBindingData {
 readonly networkId:string;
 readonly subjectOwner:string;
 readonly account:string;
 readonly projectId:string;
 readonly publisherId:string;
 readonly publisherKeyVersion:string;
}
declare const publisherHandleBrand:unique symbol;
/** Independent protected-process custody, incompatible with Wallet asset handles. */
export interface IDEArtifactPublisherKeyData {readonly [publisherHandleBrand]:true}
export interface IDEArtifactPublisherPublicData extends IDEArtifactPublisherBindingData {
 readonly protocolVersion:'YNX-BATCH/v0.1';
 readonly suite:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512';
 readonly purpose:'ARTIFACT-RELEASE';readonly keyRole:'ide-artifact-publisher';
 /** Fresh detached copies on every read. */
 readonly pkA:Uint8Array;readonly pkB:Uint8Array;
 readonly dataOnly:true;readonly trusted:false;readonly authorized:false;
 readonly nativeAdmission:false;readonly registered:false;readonly current:false;
}
/** Original primitive plaintext ABI, protected-process only. Caller must seal
 * together with the exact originalR in its purpose-isolated protected store,
 * wipe both private copies after use, and preserve real Source registration.
 * The raw format cannot establish historical key-purpose provenance. */
export interface IDEArtifactPublisherKeyMaterialData {
 readonly format:'YNX-BATCH/KEY-MATERIAL/v1';
 readonly algorithmVersion:'YNX-BATCH/v0.1';
 readonly suite:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512';
 readonly pkcs8A:Uint8Array;readonly pkcs8B:Uint8Array;
 readonly pkA:Uint8Array;readonly pkB:Uint8Array;
}
export interface IDEArtifactPublisherKeyCleanupData {
 readonly retired:boolean;readonly cleanupComplete:boolean;readonly cleanupUnknown:boolean;
 readonly firstCause:unknown;readonly globalCleanupDebt:boolean;
}
export interface IDEArtifactSignatureData extends IDEArtifactPublisherBindingData {
 readonly purpose:'ARTIFACT-RELEASE';readonly keyRole:'ide-artifact-publisher';
 readonly signatureVerified:true;readonly memberCount:1;readonly memberIndex:0;
 readonly dataOnly:true;readonly trusted:false;readonly authorized:false;
 readonly nativeAdmission:false;readonly registered:false;readonly current:false;
 readonly publicationAuthorized:false;
}
/** Explicit portable Node/Electron provider. Does not register a publisher. */
export declare function createIDEArtifactPublisherKeyData(binding:IDEArtifactPublisherBindingData):IDEArtifactPublisherKeyData;
export declare function readIDEArtifactPublisherPublicOriginalData(handle:IDEArtifactPublisherKeyData):Uint8Array;
export declare function exportIDEArtifactPublisherKeyMaterialData(handle:IDEArtifactPublisherKeyData):Readonly<IDEArtifactPublisherKeyMaterialData>;
/** Checks both recomputed keys against exact expectedR. Caller must obtain that
 * originalR from its protected store and original Auth, never renderer input. */
export declare function importIDEArtifactPublisherKeyMaterialData(material:IDEArtifactPublisherKeyMaterialData,expectedPublicOriginal:Uint8Array):IDEArtifactPublisherKeyData;
/** Fences the key before cleanup; UNKNOWN is retained and never retried. */
export declare function destroyIDEArtifactPublisherKeyData(handle:IDEArtifactPublisherKeyData):boolean;
export declare function readIDEArtifactPublisherKeyCleanupData(handle:IDEArtifactPublisherKeyData):Readonly<IDEArtifactPublisherKeyCleanupData>;
export declare function inspectIDEArtifactPublisherPublicOriginalData(raw:Uint8Array):Readonly<IDEArtifactPublisherPublicData>;
/** Typed canonical manifest only, exact R13/M3/N1. Original Source current ACL,
 * trusted registration, visible approval and protected custody are mandatory
 * before and after calling. No generic signer or approval is exposed. */
export declare function signIDEArtifactManifestData(handle:IDEArtifactPublisherKeyData,manifestOriginal:Uint8Array,expectedPublicOriginal:Uint8Array):Uint8Array;
/** Full dual-AND mathematics, with fixed local height zero. Never a registered
 * publisher/current-policy/permission verdict. Original Auth must check those. */
export declare function inspectIDEArtifactSignatureData(signatureOriginal:Uint8Array,manifestOriginal:Uint8Array,expectedPublicOriginal:Uint8Array):Readonly<IDEArtifactSignatureData>;
