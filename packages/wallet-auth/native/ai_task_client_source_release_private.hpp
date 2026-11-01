#pragma once
#include "original-auth-identity-native-release.h"
namespace ynx::ai::client {
// Independent AI release. No catalog/CodeRoot/WPC/asset/server row aliases.
struct SourceRelease {
 ynx_auth_private::NativeSourceRelease source;
 std::string resource_directory,application_id,product_id,platform;
 std::string agent_resource_ref,agent_original_sha256;
 std::string private_kernel_path,private_kernel_sha256;uint64_t private_kernel_bytes=0;
 std::string node_loader_path,node_loader_sha256;uint64_t node_loader_bytes=0;
 uint64_t uid=0;
};
inline const std::vector<SourceRelease>& original_releases(){
#ifdef YNX_REVIEWED_AI_TASK_CLIENT_SOURCE_ROWS
 static const std::vector<SourceRelease> rows={YNX_REVIEWED_AI_TASK_CLIENT_SOURCE_ROWS};
#else
 static const std::vector<SourceRelease> rows;
#endif
 return rows;
}
}
