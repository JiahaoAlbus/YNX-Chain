/** Internal offline build DATA only. No recognized runtime permission/owner. */
export interface BuildFilePinDATA{readonly path?:string;readonly bytes:number;readonly sha256:string}
export interface ReviewedSourceCASDATA{readonly path:string;readonly before:BuildFilePinDATA;readonly after:BuildFilePinDATA}
export interface ReviewedSDKSourceIdentityDATA{readonly baseCommit:string;readonly baseTree:string;readonly emitterSourceCandidateSHA256:string;readonly family:'pair-service'|'runtime-image'}
export interface ReviewedSDKMaterializationInputDATA{readonly sourceRoot:string;readonly sourceIdentity:ReviewedSDKSourceIdentityDATA;readonly changedSourcePins:readonly ReviewedSourceCASDATA[];readonly outputRoot:string;readonly recipeFile:string;readonly metadataPath:string;readonly metadataSHA256:string}
export interface ReviewedSDKMaterializationResultDATA{readonly status:'SDK_REVIEWED_SOURCE_POSTPROCESS_REVIEW_ONLY';readonly output:string;readonly sourcePackageRoot:string;readonly sourceFiles:number;readonly normalPackageMembers:number;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly runtimeImageProfile:'POSTBUILD_INDEPENDENT_ROOT_PENDING'}
export function materializeReviewedSDKSourceDATA(input:ReviewedSDKMaterializationInputDATA):Readonly<ReviewedSDKMaterializationResultDATA>;
export function canonical(input:unknown):string;
export function exact(input:unknown,keys:readonly string[]):void;
export function safe(input:string,dir?:boolean):string;
export function read(input:string,max?:number):Buffer;
export function parsed(input:string,max?:number):unknown;
export function walk(root:string):readonly (BuildFilePinDATA&{readonly path:string})[];
export function compare(expected:BuildFilePinDATA,actual:BuildFilePinDATA):void;
export function pin(path:string,max?:number):BuildFilePinDATA&{readonly path:string};
export function sha(bytes:string|Uint8Array):string;
export function fail(code:string):never;
export function relative(path:string):string;
