import{openOriginalProductSessionDeviceV4ManagementClient}from'../src/original-product-device-v4-management-client.js';
const result=openOriginalProductSessionDeviceV4ManagementClient();
if(!result.errorPresent){const owner=result.owner,ctx=Object.freeze({signal:new AbortController().signal}),review=owner.prepareReview(ctx);if(!review.errorPresent)owner.readReviewDATA(review.owner);void owner.producePreparedProof(ctx);const value:false=owner.statusDATA().RootAdmission;void value;
// @ts-expect-error caller objects cannot forge a review handle
owner.readReviewDATA({});
// @ts-expect-error same original context is mandatory
owner.prepareReview();
// @ts-expect-error no signer/provider/approval arguments
owner.producePreparedProof(ctx,{approved:true});
// @ts-expect-error review handle cannot be used as proof handle
if(!review.errorPresent)owner.readProofDATA(review.owner);
}
// @ts-expect-error fixed zero-input factory
openOriginalProductSessionDeviceV4ManagementClient({source:{}});
