#pragma once
#include "pay_root_public_hold_private.hpp"
#include <string>
#include <vector>
namespace ynx_auth_ide_cloud_private {
// Release-reviewed lookup locator only. A mapping file is DATA, not Source or
// permission. Neither local workspace IDs nor caller URLs select these rows.
// GET and E11 require their own actual protected typed authority afterwards.
struct ProjectCloudLookupRelease {
 std::string account,catalog_project_id;
 // Stable independently reviewed Root0 parent/leaf only. Do NOT compile a
 // short-lived record tuple/hash/window into the image or require prebuild
 // current. Each original read captures the actual Root-controlled FD.
 ynx::wallet::pay::root_physical::RootPublicLocator mapping;
};
inline const std::vector<ProjectCloudLookupRelease>&originalProjectCloudLookupReleases(){
#ifdef YNX_IDE_CLOUD_PUBLIC_CONTROLS
 extern const std::vector<ProjectCloudLookupRelease>&PUBLICProjectCloudLookupReleases();return PUBLICProjectCloudLookupReleases();
#else
 static const std::vector<ProjectCloudLookupRelease>rows;return rows;
#endif
}
}
