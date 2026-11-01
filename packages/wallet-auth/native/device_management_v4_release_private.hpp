#pragma once
#include "original-auth-identity-native-release.h"
namespace ynx::device::management {
struct PublicOriginalResource{std::string ref,path;};
struct ApprovalCodeResource{std::string path,sha256;uint64_t bytes=0;};
struct SourceRelease{
 ynx_auth_private::NativeSourceRelease source;
 std::string resource_directory,application_id,product_id,platform;
 std::string implementing_image_path,implementing_image_sha256;uint64_t implementing_image_bytes=0;
 std::string originals_driver_path,originals_driver_sha256;uint64_t originals_driver_bytes=0;
 std::string approval_module_path,approval_module_sha256;uint64_t approval_module_bytes=0;
 std::vector<ApprovalCodeResource>approval_imports;
 std::vector<PublicOriginalResource> originals;uint64_t uid=0;
};
inline const std::vector<SourceRelease>&original_management_releases(){
#ifdef YNX_REVIEWED_DEVICE_V4_MANAGEMENT_SOURCE_ROWS
 static const std::vector<SourceRelease>rows={YNX_REVIEWED_DEVICE_V4_MANAGEMENT_SOURCE_ROWS};
#else
 static const std::vector<SourceRelease>rows;
#endif
 return rows;
}
}
