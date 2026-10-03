// Reject invalid wire input before creating an opaque mutation identity. Keep
// exact legacy string contents so restoring an old request never changes it.
export function sellerOrderInput(fields){
 const Action=String(fields.get('action')||''),Carrier=String(fields.get('carrier')||''),TrackingNumber=String(fields.get('trackingNumber')||''),Explanation=String(fields.get('explanation')||'');
 if(!['shipped','delivered','return_approved','return_rejected','refund_approved','refund_rejected'].includes(Action))throw Error('Choose an available Seller action.');
 const bytes=value=>new TextEncoder().encode(value).length;
 if(bytes(Carrier)>120||bytes(TrackingNumber)>200||bytes(Explanation)>5000||Action==='shipped'&&(!Carrier.trim()||!TrackingNumber.trim())||['return_rejected','refund_rejected'].includes(Action)&&!Explanation.trim())throw Error('Enter the actual shipment or decision. Carrier: up to 120 UTF-8 bytes; tracking: 200; explanation: 5000.');
 return {Action,Carrier,TrackingNumber,Explanation};
}
export function sellerInteger(value,minimum,label){if(!Number.isSafeInteger(value)||value<minimum)throw Error(label+' must be a whole number in the supported range.');return value;}
export function validateSellerVariants(variants){for(const value of variants){sellerInteger(value.PriceYNXT,1,'Price');sellerInteger(value.Inventory,0,'Inventory');}return variants;}
