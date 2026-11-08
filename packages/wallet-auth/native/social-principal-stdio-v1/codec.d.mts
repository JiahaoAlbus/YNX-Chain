/** Shared framing DATA only. No decoded value is a Source/Root/native grant. */
export type SocialPrincipalCommand='read'|'current'|'qualify'|'retire'|'join'|'close';
export const SOCIAL_PRINCIPAL_STDIO_VERSION:1;
export const SOCIAL_PRINCIPAL_STDIO_MAX_FRAME_BYTES:3149824;
export const SOCIAL_PRINCIPAL_STDIO_COMMANDS:readonly SocialPrincipalCommand[];
export const SOCIAL_PRINCIPAL_EXPECTED17:readonly string[];
export type SocialPrincipalErrorDATA=Readonly<{tag:'none';code:0}>|Readonly<{tag:'code';code:number}>|Readonly<{tag:'retained';code:0}>;
export type SocialPrincipalRequestDATA=Readonly<{version:1;sequence:string}>&(Readonly<{command:'qualify';requestOriginal:string;replayKey:string;proofExpiresMS:number}>|Readonly<{command:Exclude<SocialPrincipalCommand,'qualify'>;requestOriginal:'';replayKey:'';proofExpiresMS:0}>);
export interface SocialPrincipalResponseDATA {readonly version:1;readonly sequence:string;readonly original:string|null;readonly errorPresent:boolean;readonly error:SocialPrincipalErrorDATA;readonly physicalDone:boolean;}
declare const profileOriginal:unique symbol,registrationOriginal:unique symbol;
/** Non-interchangeable captured ORIGINAL UTF8 labels only, not proof brands. */
export type SocialSignedProfileOriginalUTF8=string&{readonly [profileOriginal]:never};
export type SocialSourceRegistrationOriginalUTF8=string&{readonly [registrationOriginal]:never};
export interface SocialPrincipalExpected17DATA {readonly networkId:string;readonly canonicalOwner:string;readonly account:string;readonly sessionBinding:string;readonly productId:'social';readonly clientId:string;readonly platform:string;readonly applicationId:string;readonly bundleId:string|null;readonly packageId:string|null;readonly origin:string;readonly callback:string;readonly deviceId:string;readonly generation:string;readonly registrationId:string;readonly revision:string;readonly registrationDigest:string;}
interface OriginalFlags {readonly dataOnly:true;readonly RootAdmission:false;readonly V4Authentication:false;}
export interface SocialPrincipalBindingOriginalDATA extends OriginalFlags {readonly version:'YNX-SOCIAL-JOINT-PROFILE-ORIGINAL/v1';readonly profileOriginal:SocialSignedProfileOriginalUTF8;readonly registrationOriginal:SocialSourceRegistrationOriginalUTF8;readonly expiresMS:number;readonly expected:SocialPrincipalExpected17DATA;}
export interface SocialPrincipalQualifiedOriginalDATA extends OriginalFlags {readonly version:'YNX-SOCIAL-DIRECTORY-PRINCIPAL-ORIGINAL/v1';readonly profileOriginal:SocialSignedProfileOriginalUTF8;readonly registrationOriginal:SocialSourceRegistrationOriginalUTF8;readonly requestOriginalSHA256:string;readonly proofReplayKey:string;readonly expiresMS:number;}
export function nextSocialPrincipalSequence(value:string):string;
export function encodeSocialPrincipalRequestFrame(value:SocialPrincipalRequestDATA):Uint8Array;
export function decodeSocialPrincipalRequestFrame(raw:Uint8Array):SocialPrincipalRequestDATA;
/** expectedSequence/command must come from same outstanding child locally. They
 * constrain DATA only; callers cannot claim permission by choosing them. */
export function encodeSocialPrincipalResponseFrame(value:SocialPrincipalResponseDATA,expectedSequence:string,command:SocialPrincipalCommand):Uint8Array;
export function decodeSocialPrincipalResponseFrame(raw:Uint8Array,expectedSequence:string,command:SocialPrincipalCommand):SocialPrincipalResponseDATA;
/** Parse outer original DATA exactly once; signed profile and registration
 * remain raw strings. Never parse/re-marshal their inner signed envelopes. */
export function decodeSocialPrincipalBindingOriginal(raw:string):SocialPrincipalBindingOriginalDATA;
export function decodeSocialPrincipalQualifiedOriginal(raw:string):SocialPrincipalQualifiedOriginalDATA;
export function createSocialPrincipalFrameReaderDATA():Readonly<{push(chunk:Uint8Array):Readonly<{frames:readonly Uint8Array[];errorPresent:boolean;error?:unknown}>;finish():Readonly<{errorPresent:boolean;error?:unknown}>}>;
export function createSocialPrincipalExchangeDATA():Readonly<{acceptStartup(raw:Uint8Array):SocialPrincipalResponseDATA;begin(command:SocialPrincipalCommand,payload?:Readonly<{requestOriginal:string;replayKey:string;proofExpiresMS:number}>):Uint8Array;acceptResponse(raw:Uint8Array):SocialPrincipalResponseDATA;retainUnknownDATA(cause:unknown):void;readStatusDATA():Readonly<{startupObserved:boolean;sequence:string;pending:boolean;retired:boolean;physicalDoneObserved:boolean;unknown:boolean;firstCausePresent:boolean;firstCause:unknown;lastOriginalFrame:SocialPrincipalResponseDATA|null;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>}>;
