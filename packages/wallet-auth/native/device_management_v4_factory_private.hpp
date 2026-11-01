#pragma once
#include "device_management_v4_root_private.hpp"
#include "device_management_v4_approval_private.hpp"
#include "original-product-device-v4-http-call.h"
namespace ynx_auth_private {
class DeviceManagementV4Factory;
class DeviceManagementV4Operation final{
 struct Impl;std::unique_ptr<Impl>impl_;DeviceManagementV4Operation();
 friend class DeviceManagementV4Factory;
public:
 ~DeviceManagementV4Operation();
 NSData*readOriginalUnsigned()const;
 NSData*readOriginalE5()const;
 NSData*readOriginalBody()const;
 std::vector<uint8_t>readOriginalMemberDATA()const;
 ProductDeviceV4HTTPOutcomeDATA readOriginalOutcomeDATA()const;
 bool assertCurrent(std::string&);
 void retire();bool join(std::string&);bool close(std::string&);
};
class DeviceManagementV4Factory final{
public:
 // Public partial owner exists before Source/nonce/OS work; prepare once per
 // normal Source. Not a JS input constructor or arbitrary unsigned signer.
 static std::shared_ptr<DeviceManagementV4Operation>prepare(const std::shared_ptr<ynx::device::management::OriginalManagementRoot>&,std::string&);
 // Only a genuine Native approval loan for SAME Root+unsigned may enter.
 static bool produce(const std::shared_ptr<DeviceManagementV4Operation>&,const std::shared_ptr<OriginalManagementApprovalLoan>&,std::string&);
};
}
