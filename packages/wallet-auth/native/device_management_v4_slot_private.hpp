#pragma once
#include "device_management_v4_root_private.hpp"
#include "original-product-device-v4-slot-record.h"
namespace ynx_auth_private {
class DeviceManagementV4Factory;
class DeviceManagementV4Slot final{
 struct Impl;std::unique_ptr<Impl>impl_;DeviceManagementV4Slot();
 bool selectOriginalPrivateBorrow(ProductDeviceV4SlotBorrow&,std::string&);
 friend class DeviceManagementV4Factory;
public:
 static std::unique_ptr<DeviceManagementV4Slot>acquire(const std::shared_ptr<ynx::device::management::OriginalManagementRoot>&,std::string&);
 bool assertCurrent(std::string&);void retire();bool close(std::string&);
 ~DeviceManagementV4Slot();DeviceManagementV4Slot(const DeviceManagementV4Slot&)=delete;
};
}
