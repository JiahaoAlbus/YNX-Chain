export interface IDEFiniteGETTargetV1DATA {
 readonly version:1;readonly parentSourceId:string;readonly projectSourceId:string;readonly deviceSourceId:string;
 readonly account:string;readonly deviceId:string;readonly sessionBinding:string;readonly registrationDigest:string;readonly catalogProjectId:string;
 readonly registeredCloudFullRef:Readonly<{realm:string;tenant:string;kind:string;id:string;rev:string}>;
 readonly resourceApprovalRef:string;readonly targetOrigin:string;readonly serverName:string;readonly port:number;readonly spkiSHA256:string;readonly productOrigin:string;
 readonly requiredScopes:readonly string[];readonly permittedSelectors:readonly ('deployment'|'logs'|'runtime'|'usage'|'usage.records'|'billing'|'billing.native-intent')[];
 readonly publicCredentialRef:string;readonly localSAN:string;readonly peerSAN:string;readonly rootCertificateSHA256:string;readonly clientCertificateSHA256:string;
 readonly notBeforeMs:number;readonly expiresMs:number;readonly rootEpoch:string;readonly rootUntilMs:number;readonly credentialEpoch:string;readonly credentialUntilMs:number;
}
export declare const IDE_FINITE_GET_TARGET_SELECTION_KEY:'ideFiniteGETTargetV1';
export declare const IDE_FINITE_GET_TARGET_SOURCE_PURPOSE:'ide-project-authority-v1';
export declare function inspectOriginalIDEFiniteGETTargetV1DATA(value:unknown):Readonly<{cap:IDEFiniteGETTargetV1DATA;capOriginal:string;capSHA256:string;dataOnly:true;TargetQualified:false;RootAdmission:false;SourceAdmission:false;permission:false}>;
export declare function assertOriginalIDEFiniteGETTargetProfileBindingDATA(value:unknown,profile:Readonly<{purpose:string;sourceId:string;issuedAtMs:number;expiresAtMs:number;selection:Readonly<{association:Readonly<{account:string;deviceId:string}>;projectAuthority:Readonly<{principal:Readonly<{account:string;deviceId:string;sessionRef:string}>;project:Readonly<{projectId:string}>}>}>}>):ReturnType<typeof inspectOriginalIDEFiniteGETTargetV1DATA>;
