/** Original Auth R159 publication manifest DATA; never authorization or approval. */
export interface IDEArtifactManifestData {
 readonly byteSize:number;
 readonly contentDigest:string;
 readonly projectId:string;
 readonly publishPurpose:string;
 readonly targetEnvironment:string;
 readonly version:string;
}
/** Exact own six fields only. Returns fresh canonical original UTF-8 bytes. */
export declare function encodeIDEArtifactManifestData(input:IDEArtifactManifestData):Uint8Array;
/** Validates canonical original bytes. Signatures must retain the original bytes,
 * not substitute a reserialized result. Returns a frozen six-field DATA DTO. */
export declare function inspectIDEArtifactManifestData(original:Uint8Array):Readonly<IDEArtifactManifestData>;
