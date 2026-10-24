import {inspectIDEArtifactSignedManifestData, type IDEArtifactSignedManifestData} from '@ynx-chain/wallet-auth/ide-artifact-signature';
declare const signatureOriginal:Uint8Array;
declare const independentlySelectedPublic:Uint8Array;
const projection:Readonly<IDEArtifactSignedManifestData> = inspectIDEArtifactSignedManifestData(signatureOriginal, independentlySelectedPublic);
const exactOriginalBase64url:string = projection.manifestOriginal;
const dataOnly:true = projection.dataOnly;
const unapproved:false = projection.publicationAuthorized;
void [exactOriginalBase64url,dataOnly,unapproved];
// @ts-expect-error A verified signed member does not authorize publication.
const approved:true = projection.publicationAuthorized;
// @ts-expect-error Caller cannot inject a manifest into the selector.
inspectIDEArtifactSignedManifestData(signatureOriginal, independentlySelectedPublic, new Uint8Array());
// @ts-expect-error Original projection is readonly.
projection.manifestOriginal = 'replacement';
