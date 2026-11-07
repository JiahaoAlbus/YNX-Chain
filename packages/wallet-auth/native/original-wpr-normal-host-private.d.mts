import type {RequiredWPRIssuerPublicOriginalLoanV1} from '../src/original-wallet-product-materializer-data.js';
/** Actual normal async Source-preload→SAME Native loan. Always adopt owner
 * before interpreting errorPresent; this is not a Native qualification brand. */
export interface OriginalWPRNormalHostOwnerV1 extends RequiredWPRIssuerPublicOriginalLoanV1 {drainPartial():Promise<void>}
export type OriginalWPRNormalHostOutcomeV1=Readonly<{owner:OriginalWPRNormalHostOwnerV1;errorPresent:boolean;error:unknown}>;
export declare function openOriginalWPRMaterializationHostV1():Promise<OriginalWPRNormalHostOutcomeV1>;
