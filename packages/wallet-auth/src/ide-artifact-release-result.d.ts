/** Formal eleven-string publication release result. This is separate from an
 * identity return/proof. Nested originals require their existing owning checks. */
export interface IDEArtifactReleaseResultData {
 readonly version:'YNX-IDE-ARTIFACT-RELEASE-RESULT/v1';
 readonly purpose:'ARTIFACT-RELEASE';
 readonly requestOriginal:string;
 readonly manifestOriginal:string;
 readonly publisherOriginal:string;
 readonly actualApprovalRef:string;
 readonly publisherRegistrationRef:string;
 readonly publisherRevision:string;
 readonly publisherKeyVersion:string;
 readonly invocationOriginal:string;
 /** Canonical base64url of the whole original N1 member, never proofOriginal. */
 readonly signatureOriginal:string;
 /** Each read returns an independent ordinary Uint8Array copy. Original wire
  * bytes are retained verbatim; no reserialized DTO is substituted for them. */
 readonly resultOriginal:Uint8Array<ArrayBuffer>;
 readonly requestOriginalBytes:Uint8Array<ArrayBuffer>;
 readonly manifestOriginalBytes:Uint8Array<ArrayBuffer>;
 readonly invocationOriginalBytes:Uint8Array<ArrayBuffer>;
 readonly publisherOriginalBytes:Uint8Array<ArrayBuffer>;
 readonly signatureOriginalBytes:Uint8Array<ArrayBuffer>;
 readonly dataOnly:true;
 readonly signatureVerified:false;
 readonly trusted:false;
 readonly authorized:false;
 readonly nativeAdmission:false;
 readonly registered:false;
 readonly current:false;
 readonly approvalCurrent:false;
 readonly publicationAuthorized:false;
}
/** Pure strict DATA decoding of the original <=262144 UTF-8 bytes. Ordinary
 * fixed ArrayBuffer-backed Uint8Array only; Buffer, SharedArrayBuffer, resizable
 * or detached buffers, subclasses, Proxies and object/getter/provider input reject.
 * Does not parse/verify nested request/R13/M3/N1, authorize or complete effects. */
export function decodeIDEArtifactReleaseResultData(resultOriginal:Uint8Array):Readonly<IDEArtifactReleaseResultData>;
