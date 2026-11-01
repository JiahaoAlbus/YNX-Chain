export const NETWORK_RESOURCE_SOURCE_PURPOSE:'network-resource-source-v1';
export const NETWORK_RESOURCE_SOURCE_SELECTION_KEY:'networkResourceV1';
export const NETWORK_RESOURCE_SOURCE_OPERATIONS:readonly ['resource.public-block-histogram'];
export const NETWORK_RESOURCE_FIXED_KIND:'public_block_histogram';
/** Actual P09 contribution.Binding fields. Decimal u64 strings, raw lowerhex512 digests. */
export interface NetworkResourceBindingV1 {readonly bytes:string;readonly sha3_512:string;readonly sha512:string;}
/** Actual P09 contribution.Limits, not claims of enforced OS containment. */
export interface NetworkResourceLimitsV1 {readonly cpuMilli:string;readonly memoryBytes:string;readonly storageBytes:'0';readonly egressBytes:'0';readonly durationMillis:string;}
export interface NetworkResourceWorkV1 {readonly job:string;readonly kind:'public_block_histogram';readonly issuer:string;readonly input:NetworkResourceBindingV1;readonly limits:NetworkResourceLimitsV1;/** UTC RFC3339Nano, exact original string retained. */readonly expiresAt:string;}
export interface NetworkResourceConsentV1 {readonly principal:string;readonly job:string;readonly manifest:NetworkResourceBindingV1;readonly limits:NetworkResourceLimitsV1;readonly expiresAt:string;readonly nonce:string;readonly allow:boolean;}
export interface NetworkResourceCurrentSelectorV1 {readonly sourceId:string;readonly instanceId:string;readonly resourceKey:string;}
/** These four fields describe what the original independently authenticated publisher Source must supply. A DATA object is never that Source. */
export interface NetworkResourceIssuerV1 {readonly canonicalIssuer:string;readonly keyEpoch:string;readonly trustPublisherSource:string;readonly currentSelector:NetworkResourceCurrentSelectorV1;}
export interface NetworkResourceRequestV1 {readonly principal:string;readonly principalKeyEpoch:string;readonly originalCallerRef:string;readonly requestId:string;readonly lifecycleRef:string;readonly principalCurrentSelector:NetworkResourceCurrentSelectorV1;}
export interface NetworkResourceScopeV1 {readonly version:1;readonly protectedResourceRef:string;readonly issuer:NetworkResourceIssuerV1;readonly manifestOriginal:string;readonly consentOriginal:string;readonly request:NetworkResourceRequestV1;}
export interface NetworkResourceIssuerCurrentV1 extends NetworkResourceIssuerV1 {readonly status:'active'|'revoked'|'stale'|'unknown'|'unavailable';readonly observedAtMs:number;readonly expiresAtMs:number;}
export interface NetworkResourcePrincipalCurrentV1 extends NetworkResourceRequestV1 {readonly status:'active'|'revoked'|'cancelled'|'stale'|'unknown'|'unavailable';readonly observedAtMs:number;readonly expiresAtMs:number;}
export interface NetworkResourceOnceV1 {readonly principal:string;readonly nonce:string;readonly job:string;readonly requestId:string;readonly lifecycleRef:string;readonly manifest:NetworkResourceBindingV1;readonly state:'FRESH'|'CLAIMED'|'UNKNOWN'|'REVOKED'|'COMPLETE';}
export interface NetworkResourceDATAOnly {readonly dataOnly:true;readonly authorized:false;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly registered:false;readonly consentAuthenticated:false;readonly issuerAuthenticated:false;readonly oneUseNonceConsumed:false;readonly productionDisabled:true;readonly rewards:'NOT_AUTHORIZED';}
export function encodeOriginalNetworkResourceManifestV1DATA(value:NetworkResourceWorkV1,originalInput:Uint8Array,atMs:number):Readonly<NetworkResourceDATAOnly&{manifestOriginal:string;manifest:NetworkResourceBindingV1;work:NetworkResourceWorkV1}>;
export function encodeOriginalNetworkResourceConsentV1DATA(value:NetworkResourceConsentV1,manifestOriginal:string,originalInput:Uint8Array,atMs:number):Readonly<NetworkResourceDATAOnly&{consentOriginal:string;decision:'ALLOW'|'DENY';allow:boolean;manifest:NetworkResourceBindingV1}>;
export function inspectOriginalNetworkResourceScopeV1DATA(value:NetworkResourceScopeV1,originalInput:Uint8Array,atMs:number):Readonly<NetworkResourceDATAOnly&{scopeOriginal:string;scope:NetworkResourceScopeV1;manifest:NetworkResourceBindingV1;input:NetworkResourceBindingV1;principal:string;oneUseNonce:string;decision:'ALLOW'|'DENY';allow:boolean}>;
export function inspectOriginalNetworkResourceIssuerCurrentV1DATA(expected:NetworkResourceIssuerV1,current:NetworkResourceIssuerCurrentV1,atMs:number):Readonly<NetworkResourceDATAOnly&{canonicalIssuer:string;keyEpoch:string;status:'active'}>;
export function inspectOriginalNetworkResourceExecutionV1DATA(value:NetworkResourceScopeV1,originalInput:Uint8Array,current:NetworkResourceIssuerCurrentV1,principalCurrent:NetworkResourcePrincipalCurrentV1,once:NetworkResourceOnceV1,atMs:number):Readonly<NetworkResourceDATAOnly&{manifest:NetworkResourceBindingV1;job:string;kind:'public_block_histogram';principal:string;oneUseNonce:string}>;

export function inspectOriginalNetworkResourcePrincipalCurrentV1DATA(expected:NetworkResourceRequestV1,current:NetworkResourcePrincipalCurrentV1,atMs:number):Readonly<NetworkResourceDATAOnly&{principal:string;status:'active'}>;
