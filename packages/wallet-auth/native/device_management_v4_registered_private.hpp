#pragma once
#include "device_management_v4_root_private.hpp"
#include "original-product-device-v4-provisioning.h"
namespace ynx_auth_private {
struct ManagementRegisteredOriginalView{
 std::string registrationOriginal,sessionOriginal;
 NSDictionary*__strong context=nil;DeviceAssociationIdentity sameItem;
 uint64_t expiresAtMs=0;bool completionQueryOnly=false;
};
class OriginalManagementRegisteredReadLease final{
 struct State;std::unique_ptr<State>state_;
 explicit OriginalManagementRegisteredReadLease(std::shared_ptr<ynx::device::management::OriginalManagementRoot>);
 friend std::shared_ptr<OriginalManagementRegisteredReadLease>borrowOriginalManagementRegisteredReadLease(const std::shared_ptr<ynx::device::management::OriginalManagementRoot>&,NSError**);
public:
 ~OriginalManagementRegisteredReadLease();
 void assertCurrent();const ManagementRegisteredOriginalView&readOriginalRegisteredView();
 void retire()noexcept;bool close()noexcept;
};
std::shared_ptr<OriginalManagementRegisteredReadLease>borrowOriginalManagementRegisteredReadLease(const std::shared_ptr<ynx::device::management::OriginalManagementRoot>&,NSError**);
}
