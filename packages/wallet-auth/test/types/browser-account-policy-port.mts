import{createBrowserProductSessionClient,type ProductSessionGatewayFetchAdapter}from'../../src/index.js';
import type{PQClientAccountPolicyPorts,OriginalProductSessionAccountContextSource}from'../../src/product-session-pq-approval.js';
declare const gateway:ProductSessionGatewayFetchAdapter;declare const ports:PQClientAccountPolicyPorts;declare const source:OriginalProductSessionAccountContextSource;
const base={registry:{},productId:'social',scopes:['social.profile'],purpose:'type-only PUBLIC ports',gateway};
void createBrowserProductSessionClient(base);void createBrowserProductSessionClient({...base,accountPolicy:ports});
// @ts-expect-error a boolean is not an original policy port
void createBrowserProductSessionClient({...base,accountPolicy:true});
// @ts-expect-error acquire alone cannot replace the fixed completion verifier
void createBrowserProductSessionClient({...base,accountPolicy:source});
// @ts-expect-error ordinary DTO cannot create the opaque completion verification
void createBrowserProductSessionClient({...base,accountPolicy:{acquire:source.acquire,verifyCompletion:()=>({verification:{}})}});
// @ts-expect-error no public provider setter
void createBrowserProductSessionClient({...base,accountPolicy:ports,provider:()=>true});
// @ts-expect-error port methods must be callable
void createBrowserProductSessionClient({...base,accountPolicy:{acquire:0,verifyCompletion:ports.verifyCompletion}});

import type{RetainedProductSessionReferenceReadLoan}from'../../src/product-session-reference-read-loan-private.js';declare const loan:RetainedProductSessionReferenceReadLoan;
// @ts-expect-error a transport observation is not Root authorization
const grant:true=loan.RootAdmission;
// @ts-expect-error no target/provider setter exists on the readonly loan
loan.install({target:{}});
