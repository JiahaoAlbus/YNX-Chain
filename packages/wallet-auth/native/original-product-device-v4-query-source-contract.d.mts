import type {OriginalDeviceIdentityInputDATA,OriginalDeviceIdentityDATA} from '../src/original-device-create-intent.js';
export const PRODUCT_DEVICE_V4_QUERY_PURPOSE:'product-session-device-query-source-v4';
export const PRODUCT_DEVICE_V4_QUERY_OPERATIONS:readonly ['device.original-query'];
export interface OriginalProductDeviceV4QueryScopeDATA {
 readonly version:'4';
 readonly stableDeviceIdentity:string;
 readonly identityBinding:OriginalDeviceIdentityInputDATA;
}
export type OriginalProductDeviceV4QueryAssociationDATA=Pick<OriginalDeviceIdentityInputDATA,'account'|'clientId'|'productId'|'platform'|'applicationId'|'deviceId'>;
export interface OriginalProductDeviceV4QueryViewDATA {
 readonly stableDeviceIdentity:string;
 readonly identity:OriginalDeviceIdentityDATA['identity'];
 readonly applicationBinding:OriginalDeviceIdentityDATA['applicationBinding'];
 readonly expiresAtMs:number;
 readonly queryOnly:true;
 readonly devicePublic:null;
 readonly accountAuthorization:null;
 readonly dataOnly:true;
 readonly userApproved:false;
 readonly registrationPerformed:false;
 readonly deviceKeyAccess:false;
 readonly authorized:false;
 readonly nativeAdmission:false;
}
export function inspectOriginalProductDeviceV4QueryScopeDATA(scope:OriginalProductDeviceV4QueryScopeDATA,association:OriginalProductDeviceV4QueryAssociationDATA,networkId:string,subjectOwner:string,issued:number,expires:number,at:number):OriginalProductDeviceV4QueryViewDATA;
