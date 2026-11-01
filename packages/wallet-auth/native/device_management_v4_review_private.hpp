#pragma once
#include <node_api.h>
#include "device_management_v4_root_private.hpp"
// Private actual Native producer entry, NOT a JS export/provider setter.
// The producer has already captured the selected protected body, immutable
// unsigned21 and sole V4 E5. Recognition/current never follows JS methods.
napi_value CreateOriginalDeviceV4ManagementReview(napi_env,const std::shared_ptr<ynx::device::management::OriginalManagementRoot>&,NSData*unsigned21,NSData*e5,napi_value sameFrozenAbortContext,NSData*capturedBody=nil);
napi_value IsOriginalProductSessionDeviceV4ManagementReview(napi_env,napi_callback_info);
napi_value IsOriginalProductSessionDeviceV4ManagementLease(napi_env,napi_callback_info);
bool ClaimOriginalDeviceV4ManagementReview(napi_env,napi_value sameReview,napi_value sameFrozenAbortContext);
void RegisterOriginalDeviceV4ManagementReview(napi_env,napi_value exports);
bool BorrowOriginalDeviceV4ManagementReview(napi_env,napi_value sameReview,napi_value sameContext,const std::shared_ptr<ynx::device::management::OriginalManagementRoot>&,NSData**unsigned21,NSDictionary**binding14,NSDictionary**managementLease6);
