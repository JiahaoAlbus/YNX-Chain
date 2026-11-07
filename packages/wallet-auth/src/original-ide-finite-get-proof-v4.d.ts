import type {ProductSessionHTTPProofV4Unsigned,ProductSessionHTTPProofV4Expected,ProductSessionHTTPProofV4Data} from './product-session-proof-v4.js';
import type {OriginalIDECloudGETRequestDATA} from './original-ide-cloud-get-request.js';
export const IDE_FINITE_GET_PROOF_VERSION:'4';
export const IDE_FINITE_GET_PROOF_HEADER:'x-ynx-product-session-proof-v4';
export const IDE_FINITE_GET_EMPTY_BODY_SHA256:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const IDE_FINITE_GET_OPERATIONS:readonly ['deployment','logs','runtime','usage','usage.records','billing','billing.native-intent'];
export type IDEFiniteGETOperation=typeof IDE_FINITE_GET_OPERATIONS[number];
export type IDEFiniteGETDeviceContextV4=Readonly<Omit<ProductSessionHTTPProofV4Unsigned,'method'|'path'|'bodyDigest'|'productId'> & {productId:'developer'}>;
export interface IDEFiniteGETExpectedV4 {readonly serviceOrigin:string;readonly operationRequestId:string;readonly networkId:string;}
export interface IDEFiniteGETFlags {readonly dataOnly:true;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly receiverAccepted:false;readonly permission:false;readonly sent:false;readonly dispatch:false;}
declare const originalIDEFiniteGETStage:unique symbol;
export interface IDEFiniteGETStageV4 extends IDEFiniteGETFlags {readonly [originalIDEFiniteGETStage]:never;readonly version:'4';readonly operation:IDEFiniteGETOperation;readonly request:Readonly<OriginalIDECloudGETRequestDATA>;readonly unsigned:Readonly<ProductSessionHTTPProofV4Unsigned>;readonly unsignedOriginal:string;readonly headerName:'x-ynx-product-session-proof-v4';readonly messageOriginal:Uint8Array;}
export interface IDEFiniteGETHeaderV4 extends IDEFiniteGETFlags {readonly version:'4';readonly operation:IDEFiniteGETOperation;readonly request:Readonly<OriginalIDECloudGETRequestDATA>;readonly headerName:'x-ynx-product-session-proof-v4';readonly headerValue:string;readonly math:Readonly<ProductSessionHTTPProofV4Data>;}
export function prepareIDEFiniteGETUnsignedV4DATA(request:OriginalIDECloudGETRequestDATA,expected:IDEFiniteGETExpectedV4,deviceContext:IDEFiniteGETDeviceContextV4):IDEFiniteGETStageV4;
export function assertIDEFiniteGETOriginalRequestV4DATA(stage:IDEFiniteGETStageV4,sameOriginalRequest:OriginalIDECloudGETRequestDATA):IDEFiniteGETStageV4;
export function createIDEFiniteGETProofHeaderV4DATA(stage:IDEFiniteGETStageV4,sameOriginalRequest:OriginalIDECloudGETRequestDATA,memberOriginal:Uint8Array,independentDeviceExpected:ProductSessionHTTPProofV4Expected,atMS:number):IDEFiniteGETHeaderV4;
export function inspectIDEFiniteGETProofHeaderV4DATA(stage:IDEFiniteGETStageV4,sameOriginalRequest:OriginalIDECloudGETRequestDATA,headerPacket:Readonly<{headerName:'x-ynx-product-session-proof-v4';headerValue:string}>,independentDeviceExpected:ProductSessionHTTPProofV4Expected,atMS:number):Readonly<Omit<IDEFiniteGETHeaderV4,'headerName'|'headerValue'>>;
