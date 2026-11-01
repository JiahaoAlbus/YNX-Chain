#pragma once
#include <node_api.h>
napi_value RegisterOriginalDeviceV4ManagementSource(napi_env,napi_value exports);
#ifdef __OBJC__
#include "device_management_v4_root_private.hpp"
// Private normal owning entry used only by the zero-input compiled Root getter.
// Not a JS constructor, provider or arbitrary Root object setter.
napi_value CreateOriginalDeviceV4ManagementSource(napi_env,const std::shared_ptr<ynx::device::management::OriginalManagementRoot>&,NSError*acquisitionError);
#endif
