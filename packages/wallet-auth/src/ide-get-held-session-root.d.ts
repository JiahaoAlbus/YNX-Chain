/** PRIVATE DEVICE holder only. Not a Cloud GET target grant or P03 factory. */
export type OriginalIDEGETRequestContext = Readonly<{signal: AbortSignal}>;
export interface OriginalIDEGETHeldRead {
  assertCurrent(sameContext: OriginalIDEGETRequestContext): Promise<void>;
  createBusinessProof(input: {method:'GET';path:string;body:'';requiredScopes:readonly string[]}, sameContext:OriginalIDEGETRequestContext):Promise<unknown>;
  readRetainedProofObservationDATA(sameContext:OriginalIDEGETRequestContext):Readonly<{proofOriginal:Readonly<{version:'4';headerName:string;headerValue:string}>|null;failed:boolean;retired:boolean;usable:false;SourceAdmission:false}>;
  retire():void;
  close():Promise<void>;
  status():Readonly<{retired:boolean;closed:boolean;opening:boolean;firstCausePresent:boolean;cleanupPending:boolean;RootAdmission:false;SourceAdmission:false}>;
}
export type OriginalIDEGETHeldAcquisition =
 | Readonly<{owner:OriginalIDEGETHeldRead;failed:false;errorPresent:false;error:null;cleanupOnly:false}>
 | Readonly<{owner:OriginalIDEGETHeldRead|Readonly<{retire():void;close():Promise<void>;status():unknown}>|null;failed:true;errorPresent:true;error:unknown;cleanupOnly:true}>;
export function acquireOriginalIDEHeldSessionReadForOriginalGET(sameContext:OriginalIDEGETRequestContext):Promise<OriginalIDEGETHeldAcquisition>;
