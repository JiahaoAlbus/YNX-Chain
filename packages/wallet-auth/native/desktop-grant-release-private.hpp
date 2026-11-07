#pragma once
#include "original-auth-identity-native-release.h"
namespace ynx::auth::desktopgrant {
inline constexpr const char*purpose="desktop-task-grant-authority-source-v1";
struct PublicOriginalRef {std::string path,sha256;uint64_t bytes=0;};
struct Release {
 ynx_auth_private::NativeSourceRelease source;
 std::string application_id,product_id,platform,resource_directory;
 uint64_t uid=0;
 // Scope contains the independent postbuild hash of Auth's own addon; only
 // its fixed path is compiled here. Never compile an image's own hash in it.
 std::string native_image_path;
 PublicOriginalRef caller_scope,link_registration;
 // Root-reviewed code closure for the SEPARATE LINK module/addon. These are
 // not an Auth handle/brand or credential; original LINK mints its own owner.
 std::string link_module_path;
 std::vector<PublicOriginalRef>link_code_closure;
 // Independent reviewed DATA resources; never caller paths or Source grants.
 // All absent preserves management-only composition, never enables an effect.
 PublicOriginalRef task_read_material,task_read_peer,task_read_target;
 std::string task_read_account;
 std::string task_read_module_path;
 std::vector<PublicOriginalRef>task_read_code_closure;
 // Separate exact Root-selected continuation carrier; no sibling path inference.
 std::string task_read_continuation_module_path;
 std::vector<PublicOriginalRef>task_read_continuation_code_closure;
};
inline const std::vector<Release>&original_desktop_grant_releases(){
#ifdef YNX_REVIEWED_DESKTOP_TASK_GRANT_RELEASE_ROWS
 static const std::vector<Release> rows={YNX_REVIEWED_DESKTOP_TASK_GRANT_RELEASE_ROWS};
#else
 static const std::vector<Release> rows;
#endif
 return rows;
}
}
