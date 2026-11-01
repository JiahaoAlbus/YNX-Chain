/** Private actual Native/Node ABI. Brands are runtime env/tag/inventory, not TS. */
export type Owned<T>=Readonly<{owner:T|null;errorPresent:boolean;error?:unknown}>;
export type Lifecycle={assertCurrent():void;retire():void;join():void|Promise<void>;close():void|Promise<void>;drainPartial?():void|Promise<void>};
export type Context=Readonly<{signal:AbortSignal}>;
export type Selector=Readonly<{sourceId:string;instanceId:string;resourceKey:string}>;
export type AgentPublic=Readonly<{version:'1';purpose:'PRODUCT-SESSION-AI-TASK-ACTION';networkId:string;canonicalOwner:string;registrationId:string;registrationDigest:string;keyEpoch:string;pkA:string;pkB:string;sourceId:string;instanceId:string;resourceKey:string;protectedResourceRef:string;registeredAtMs:number;expiresAtMs:number}>;
export type Identity=Readonly<{sessionBinding:string;productId:'ai';clientId:'ynx-ai-v1';applicationId:'com.ynxweb4.ai';platform:'ios'|'android';bundleId:'com.ynxweb4.ai'|null;packageId:'com.ynxweb4.ai'|null;origin:string;callback:'ynxai://wallet-auth/callback';account:string;canonicalOwner:string;deviceId:string;deviceRegistrationId:string;deviceRegistrationRevision:string;deviceRegistrationDigest:string;audience:string;holder:string;policyRevision:string}>;
export type Scope=Readonly<{version:'6';originURL:string;networkId:string;agentPublic:AgentPublic;currentSelector:Selector;identity:Identity;expiresAtMs:number}>;
declare const sdkPeer:unique symbol;export type Peer=Readonly<{[sdkPeer]:true}>;
export type Originals=Readonly<{rootOriginal:Uint8Array;enrollmentOriginal:Uint8Array;profileOriginal:Uint8Array;currentOriginal:Uint8Array}>;
export type Review=Lifecycle&{readOriginalUnsigned():string;readOriginalSourceCurrentOriginals():Originals;readOriginalSourceSummaryDATA():Readonly<{sourceId:string;instanceId:string;scope:Scope}>;readOriginalBindingDATA():Readonly<{version:'6';reviewId:string;networkId:string;canonicalOwner:string;operationId:string;requestDigest:string;nonce:string;issuedAt:string;expiresAt:string;domain:'YNX-PRODUCT-SESSION-AI-TASK-ACTION/v6';purpose:'PRODUCT-SESSION-AI-TASK-ACTION'}>;assertOriginalContext(same:Context):void};
export type Operation=Lifecycle&{readOriginalUnsigned():string;readOriginalMember():Uint8Array|null};
export type Response=Readonly<{status:number;headers:readonly(readonly[string,string])[];bodyOriginal:Uint8Array;complete:boolean}>;
export type Outcome=Lifecycle&{readOriginalOutcomeDATA():Readonly<{state:'COMMITTED'|'ACCEPTED'|'OBSERVED'|'DENIED'|'UNKNOWN';action:string;businessAction:'create-task'|'prepare-task'|'propose-tool-step'|'cancel-task'|'complete-task'|null;completionScope:'PRODUCT_LOCAL_COMMIT_ONLY'|'TASK_APPROVAL_COMMIT_ONLY'|'READ_ONLY_OBSERVATION'|null;requestRef:string|null}>;readOriginalBusinessReceipt():Uint8Array|null};
export type Lookup=Lifecycle&{readOriginalOperationId():string;readOriginalEvidence():Uint8Array};
export type Source=Lifecycle&{
 readOriginalScopeDATA():Scope;
 prepareOriginalAITaskActionV6Review(peer:Peer,same:Context):Promise<Owned<Review>>;
 produceOriginalAITaskActionV6(peer:Peer,same:Context,sameReview:Review):Promise<Owned<Operation>>;
 readOriginalServerCurrentDATA(peer:Peer,same:Context):Readonly<{networkId:string;responseIssuer:string;pkA:string;pkB:string;expiresAtMs:number}>|Promise<Readonly<{networkId:string;responseIssuer:string;pkA:string;pkB:string;expiresAtMs:number}>>;
 assertOriginalAITaskActionV6Response(peer:Peer,same:Context,response:Response):Promise<void>;
 assertOriginalAITaskActionV6OutcomeCurrent(peer:Peer,same:Context):void|Promise<void>;
 acquireOriginalAITaskActionV6Outcome(peer:Peer,same:Context,response:Response):Promise<Owned<Outcome>>;
 assertOriginalAITaskActionV6LookupCurrent(operationId:string,same:Context):void|Promise<void>;
 lookupOriginalAITaskActionV6(operationId:string,same:Context):Promise<Owned<Lookup>>;
};
/** Raw Native acquisition is synchronous; the sole SDK adopts it before flags,
 * runs its fixed Node ESM producer, awaits SAME ready promise, then fullcurrent. */
export declare function acquireOriginalAITaskActionClientV6Source():Owned<Source>;
export declare function isOriginalAITaskActionV6Review(value:unknown):value is Review;
/** Custody recognition ONLY, including Root0 partials; NOT qualification. */
export declare function isOriginalAITaskClientRootV6(value:unknown):boolean;
export declare function openOriginalAITaskActionClientV6LoaderV1(owner:Source):Readonly<{version:1;clientURI:string;assertCurrent():void;acceptCompleted(actualNamespace:unknown):void}>;
export declare function waitOriginalAITaskActionClientV6Ready(owner:Source):Promise<void>;
