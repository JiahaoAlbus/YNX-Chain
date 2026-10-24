/** Private same-image custody only. No public export key, Source constructor
 * from DATA, Root input, FD serialization or signing permission is provided. */
declare const originalPQHostCatalogSourceBrand:unique symbol;
export interface OriginalPQHostCatalogSource {readonly [originalPQHostCatalogSourceBrand]:true}
export interface OriginalPQHostCatalogJournalDATA {
 readonly operationId:string;readonly account:string;readonly networkId:string;
 readonly originalHash:string;readonly nativeWireHash:string;readonly transactionHash:string;
}
/** Original receipt DATA retained before a subsequent current fence. A receipt
 * alone never proves registration, finality or present Source authority. */
export interface OriginalPQHostCatalogHandoffDATA {readonly catalogPath:string;readonly catalogSha256:string}
export interface OriginalPQHostCatalogObservationDATA {
 readonly version:'YNX-PQ-HOST-CATALOG-SOURCE-OBSERVATION/v1';
 readonly sourceId:string;readonly instanceId:string;readonly retired:boolean;
 readonly revoked:false;readonly current:boolean;readonly unknown:boolean;
 readonly dataOnly:true;readonly authorized:false;
}
export interface OriginalPQHostCatalogStatusDATA {
 readonly selected:boolean;readonly active:boolean;readonly heldResult:boolean;
 readonly existingOutcomeObserved:boolean;readonly readonlyReconciliation:boolean;
 readonly originalRegistrationOutcomeUnknown:boolean;readonly unknown:boolean;
 readonly retired:boolean;readonly closed:boolean;readonly sourceId:string;readonly instanceId:string;
 readonly firstCause:string;readonly cleanupCause:string;readonly dataOnly:true;readonly authorized:false;
}
/** Missing original Native/Source throws; an actual partial retains cleanup custody. */
export function acquireOriginalPQHostCatalogSource():OriginalPQHostCatalogSource;
export function isOriginalPQHostCatalogSource(value:unknown):value is OriginalPQHostCatalogSource;
export function readOriginalPQHostCatalogHandoff(source:OriginalPQHostCatalogSource,journal:OriginalPQHostCatalogJournalDATA):Promise<Readonly<OriginalPQHostCatalogHandoffDATA>>;
export function assertOriginalPQHostCatalogSourceCurrent(source:OriginalPQHostCatalogSource,journal:OriginalPQHostCatalogJournalDATA):undefined;
export function observeOriginalPQHostCatalogSourceRevocation(source:OriginalPQHostCatalogSource):Readonly<OriginalPQHostCatalogObservationDATA>;
export function retireOriginalPQHostCatalogSource(source:OriginalPQHostCatalogSource):undefined;
export function joinOriginalPQHostCatalogSource(source:OriginalPQHostCatalogSource):undefined;
export function closeOriginalPQHostCatalogSource(source:OriginalPQHostCatalogSource):undefined;
export function readOriginalPQHostCatalogSourceStatus(source:OriginalPQHostCatalogSource):Readonly<OriginalPQHostCatalogStatusDATA>;
