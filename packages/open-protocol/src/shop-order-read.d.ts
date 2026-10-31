import type {GrantBindV1} from './bound-grant.js';
export declare const SHOP_ORDER_READ_OPERATION:'shop.order.read';
export declare const SHOP_ORDER_READ_PATH:'/api/tools/shop.order.read';
export type ShopOrderReadField='createdAt'|'currency'|'reservationExpiresAt'|'shippingYNXT'|'status'|'subtotalYNXT'|'taxYNXT'|'totalYNXT'|'updatedAt';
export declare const SHOP_ORDER_READ_FIELDS:readonly ShopOrderReadField[];
export interface ShopOrderReadSelection {readonly orderId:string;readonly fields:readonly ShopOrderReadField[];readonly snapshot:string}
export interface ShopOrderReadTool {readonly id:'shop.order.read';readonly version:'1';readonly operation:'shop.order.read';readonly purpose:'read-selected-shop-order';readonly risk:'read';readonly schema:GrantBindV1}
export declare function encodeShopOrderReadInputDATA(input:ShopOrderReadSelection):Uint8Array;
export declare function decodeShopOrderReadInputDATA(input:Uint8Array):ShopOrderReadSelection;
export declare function bindShopOrderReadInputDATA(input:Uint8Array):GrantBindV1;
export declare function shopOrderReadInputSchemaDATA():Uint8Array;
export declare function shopOrderReadToolDescriptorDATA():ShopOrderReadTool;

import type{LegacyGrantRefV1,GrantTargetV1,GrantSourceV1}from'./bound-grant.js';
/** Mirrors the existing private TaskEffectBinding DATA; no authority methods. */
export interface ShopOrderReadTaskEffectBindingDATA {
 readonly realm:string;readonly tenant:string;readonly account:string;readonly audience:string;
 readonly grantId:string;readonly grantRevision:string;readonly task:LegacyGrantRefV1;readonly generation:string;readonly stepId:string;
 readonly holder:LegacyGrantRefV1;readonly holderEpoch:string;readonly sessionId:string;readonly sessionEpoch:string;readonly channelBinding:string;
 readonly tool:ShopOrderReadTool;readonly input:GrantBindV1;readonly fields:readonly ShopOrderReadField[];readonly target:GrantTargetV1;
 readonly resources:readonly LegacyGrantRefV1[];readonly sources:readonly GrantSourceV1[];readonly egressActual:null;
}
/** Opaque original signed operands; never JSON approved/verified flags. */
export interface ShopOrderReadProofDATA {readonly purpose:string;readonly payload:Uint8Array;readonly wire:Uint8Array}
export interface OriginalShopTaskOrderCallDATA {readonly binding:ShopOrderReadTaskEffectBindingDATA;readonly grant:ShopOrderReadProofDATA;readonly holder:ShopOrderReadProofDATA;readonly input:Uint8Array}
export type ShopOrderReadFenceDATA='same-authority-resource-fence'|'egress-only-read-fence';
export interface OriginalShopTaskOrderEncodingDATA {readonly sourceBytes:Uint8Array;readonly body:Uint8Array;readonly contentType:'application/json'|'application/cbor'}
/** Independent original registered target/kind, not copied back from a request. */
export interface ShopOrderReadExpectedProfileDATA {readonly target:GrantTargetV1;readonly orderKind:string}
export declare function encodeShopOrderReadBindingDATA(binding:ShopOrderReadTaskEffectBindingDATA,inputOriginal:Uint8Array,expected:ShopOrderReadExpectedProfileDATA):Uint8Array;
export declare function decodeShopOrderReadBindingDATA(wire:Uint8Array,inputOriginal:Uint8Array,expected:ShopOrderReadExpectedProfileDATA):ShopOrderReadTaskEffectBindingDATA;
export declare function encodeShopOrderReadProofDATA(proof:ShopOrderReadProofDATA,expectedPurpose:string):Uint8Array;
export declare function decodeShopOrderReadProofDATA(wire:Uint8Array,expectedPurpose:string):ShopOrderReadProofDATA;
export declare const SHOP_ORDER_READ_REQUEST_DOMAIN:'YNX-OPEN/SHOP-ORDER-READ-REQUEST/1';
export declare const SHOP_ORDER_READ_REQUEST_CONTENT_TYPE:'application/vnd.ynx.shop-order-read.v1';
export declare const SHOP_ORDER_READ_RESULT_PROFILE:'YNX-OPEN/SHOP-ORDER-READ-RESULT/1';
export declare function encodeShopOrderReadRequestDATA(call:OriginalShopTaskOrderCallDATA,expected:ShopOrderReadExpectedProfileDATA):Uint8Array;
/** The original normal adapter must supply the actual HTTP Content-Type. */
export declare function decodeShopOrderReadRequestDATA(wire:Uint8Array,expected:ShopOrderReadExpectedProfileDATA,actualContentType:string):OriginalShopTaskOrderCallDATA;
export interface ShopOrderReadProjectionDATA {readonly orderId:string;readonly snapshot:string;readonly fields:readonly ShopOrderReadField[];readonly data:Readonly<Partial<Record<ShopOrderReadField,string>>>}
/** Exactly maps original authgrant.Source (Resource -> resource, Revision -> rev). */
export interface ShopOrderReadDeclaredSourceDATA {readonly resource:LegacyGrantRefV1;readonly fields:readonly ShopOrderReadField[];readonly label:'PUBLIC'|'TENANT'|'RESTRICTED'|'VAULT';readonly binding:GrantBindV1}
export interface ShopOrderReadResponseValueDATA {readonly version:'1';readonly profile:'YNX-OPEN/SHOP-ORDER-READ-RESULT/1';readonly projection:ShopOrderReadProjectionDATA;readonly source:ShopOrderReadDeclaredSourceDATA;readonly authFence:ShopOrderReadFenceDATA}
/** Both operands must be from the independent original selected call/Source. */
export interface ShopOrderReadExpectedResponseDATA {readonly selection:ShopOrderReadSelection;readonly source:ShopOrderReadDeclaredSourceDATA}
export interface ShopOrderReadResponseDATA {readonly responseOriginal:Uint8Array;readonly sourceBytes:Uint8Array;readonly responseBinding:GrantBindV1;readonly sourceBinding:GrantBindV1;readonly declaredSource:ShopOrderReadDeclaredSourceDATA;readonly projection:ShopOrderReadProjectionDATA;readonly authFence:ShopOrderReadFenceDATA;readonly dataOnly:true;readonly sourceVerified:false;readonly operationVerified:false}
export declare function encodeShopOrderReadResponseDATA(value:ShopOrderReadResponseValueDATA,expected:ShopOrderReadExpectedResponseDATA):ShopOrderReadResponseDATA;
export declare function decodeShopOrderReadResponseDATA(original:Uint8Array,expected:ShopOrderReadExpectedResponseDATA):ShopOrderReadResponseDATA;
