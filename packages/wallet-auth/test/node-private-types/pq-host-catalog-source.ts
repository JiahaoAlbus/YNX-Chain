import {type OriginalPQHostCatalogSource, type OriginalPQHostCatalogJournalDATA, readOriginalPQHostCatalogHandoff, assertOriginalPQHostCatalogSourceCurrent, readOriginalPQHostCatalogSourceStatus} from '../../src/original-pq-host-catalog-source.js';
import type {OriginalAuthSourceV2Policy, OriginalAuthSourceV2Service, OriginalAuthSourceV2Operations, OriginalAuthSourceV2Selection} from '../../native/original-auth-identity-source-v2-verifier.mjs';
declare const original:OriginalPQHostCatalogSource;
declare const journal:OriginalPQHostCatalogJournalDATA;
const received:Promise<Readonly<{catalogPath:string;catalogSha256:string}>> = readOriginalPQHostCatalogHandoff(original,journal);
const current:undefined = assertOriginalPQHostCatalogSourceCurrent(original,journal);
const noGrant:false = readOriginalPQHostCatalogSourceStatus(original).authorized;
const service:OriginalAuthSourceV2Service = 'wallet-pq-host-catalog-source-v1';
const operations:OriginalAuthSourceV2Operations = ['catalog.receive','catalog.current','catalog.retire'];
declare const policy:OriginalAuthSourceV2Policy;
const app:string|undefined = policy.applicationId;
const association:OriginalAuthSourceV2Selection['association'] = {account:'PUBLIC',clientId:'PUBLIC',deviceId:'PUBLIC',platform:'macos',productId:'wallet',applicationId:'com.PUBLIC.wallet'};
void [received,current,noGrant,service,operations,app,association];
// @ts-expect-error Ordinary DATA cannot forge original same-image custody.
const fabricated:OriginalPQHostCatalogSource = {};
// @ts-expect-error No caller Root/provider can be supplied to this fixed API.
readOriginalPQHostCatalogHandoff(original,journal,{root:'PUBLIC'});
// @ts-expect-error Registration cannot be concluded from status DATA.
const grant:true = readOriginalPQHostCatalogSourceStatus(original).authorized;
