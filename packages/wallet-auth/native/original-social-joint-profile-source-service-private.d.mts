// Types describe actual private custody, not Source/Root or readiness brands.
export interface OriginalSocialSource3ResponseLoan { current():Promise<void>; copyOriginal():Promise<Readonly<{original:Uint8Array|null;errorPresent:boolean;error?:unknown}>>; copyRequestOriginal():Promise<Readonly<{original:Uint8Array|null;errorPresent:boolean;error?:unknown}>>; retire():void;join():Promise<void>;close():Promise<Readonly<{physicalDone:boolean;errorPresent:boolean;error?:unknown}>>;isClosed():boolean;statusDATA():Readonly<Record<string,unknown>>; }
export interface OriginalSocialSource3Service { assertSocialDeviceDirectoryPrincipalPurposeV4():void;existingSocialDeviceDirectoryPrincipalV4(credential:unknown):Promise<unknown>;assertOriginalSocialDeviceDirectoryPrincipalCompletionV4(credential:unknown,sameResult:unknown):void;retainOriginalSocialDeviceDirectoryPrincipalResponseV4(credential:unknown,sameResult:unknown|null):Promise<Readonly<{owner:OriginalSocialSource3ResponseLoan|null;errorPresent:boolean;error?:unknown}>>;retire():void;join():Promise<void>;close():Promise<void>;isClosed():boolean; }
export type OriginalSocialSource3Acquisition=Readonly<{owner:OriginalSocialSource3Service;errorPresent:false}>|Readonly<{owner:OriginalSocialSource3Service;errorPresent:true;error:unknown}>;
export function originalSocialJointSourceServiceConfiguredDATA():boolean;
export function acquireOriginalSocialJointSourceService():Promise<OriginalSocialSource3Acquisition>;

// Custody origin only; never proves Root/current/approval.
export function isOriginalSocialJointSourceService(owner:unknown):boolean;
