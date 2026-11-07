/** Copyable DATA, never a Source/Root/accepted-target brand. */
export interface SocialF06DirectoryRowDATA {
 readonly device:string; readonly generation:string;
 readonly registrationSHA256:string; readonly state:'committed'|'revoked';
}
export interface SocialF06DirectoryDATA {
 readonly realm:string; readonly epoch:string; readonly sequence:string;
 readonly headSHA256:string; readonly rootSHA256:string;
 readonly devices:readonly SocialF06DirectoryRowDATA[];
}
export declare function copySocialF06DirectoryDATA(value:unknown):SocialF06DirectoryDATA;
export declare function sameSocialF06DirectoryDATA(original:unknown,current:unknown):boolean;
export declare function selectSocialF06DirectoryTargetDATA(snapshot:unknown,targetDevice:string,generation:string):SocialF06DirectoryRowDATA|null;
