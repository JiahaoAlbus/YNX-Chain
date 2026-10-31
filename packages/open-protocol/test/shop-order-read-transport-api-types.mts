import{encodeShopOrderReadRequestDATA,decodeShopOrderReadRequestDATA,encodeShopOrderReadResponseDATA,decodeShopOrderReadResponseDATA,SHOP_ORDER_READ_REQUEST_CONTENT_TYPE}from'../src/shop-order-read.js';
import type{OriginalShopTaskOrderCallDATA,ShopOrderReadExpectedProfileDATA,ShopOrderReadResponseValueDATA,ShopOrderReadExpectedResponseDATA,ShopOrderReadResponseDATA}from'../src/shop-order-read.js';
declare const call:OriginalShopTaskOrderCallDATA,profile:ShopOrderReadExpectedProfileDATA,value:ShopOrderReadResponseValueDATA,expected:ShopOrderReadExpectedResponseDATA;
const request:Uint8Array=encodeShopOrderReadRequestDATA(call,profile);decodeShopOrderReadRequestDATA(request,profile,SHOP_ORDER_READ_REQUEST_CONTENT_TYPE);const encoded:ShopOrderReadResponseDATA=encodeShopOrderReadResponseDATA(value,expected),decoded:ShopOrderReadResponseDATA=decodeShopOrderReadResponseDATA(encoded.responseOriginal,expected);const noSourceVerification:false=decoded.sourceVerified;void noSourceVerification;
// @ts-expect-error Real request MIME must be passed by the normal adapter.
decodeShopOrderReadRequestDATA(request,profile);
// @ts-expect-error DATA never provides a verified original operation ID.
const originalOpID:string=decoded.originalOpID;
// @ts-expect-error Declared source bytes do not provide sourceVerified=true.
const sourceVerified:true=decoded.sourceVerified;
// @ts-expect-error A boolean approval cannot replace original typed proof bytes.
encodeShopOrderReadRequestDATA({...call,grant:{approved:true}},profile);
void originalOpID;void sourceVerified;
