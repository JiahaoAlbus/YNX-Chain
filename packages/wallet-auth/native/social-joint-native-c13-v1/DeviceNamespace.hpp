#pragma once
#include "OriginalServices.hpp"
#include "DeviceV4SourceBorrowPrivate.h"

namespace ynx::social::joint::original {
// Thin comparison through Auth's sole Source-owned private C API. The full
// paired failure is retained by the SAME Device view before a later fence.
Result matchQualifiedDeviceNamespace(ynx_auth_device_v4_view_v1*,
 const AccountNamespace&,ynx_auth_device_v4_failure_v1&) noexcept;
}
