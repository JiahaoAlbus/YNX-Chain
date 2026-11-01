#pragma once
#include <string>
#include <vector>
namespace ynx_auth_ide_private {
// Build identity only, not a Root or Source role. App installer and Node
// message client have DISTINCT designated requirements. Empty stays denied.
struct IDEHelperBuildRelease {
 std::string teamIdentifier,clientRequirement,helperRequirement;
 std::string helperSHA256,plistSHA256;
 std::string nodeRequirement;
};
inline const std::vector<IDEHelperBuildRelease>&originalIDEHelperBuildReleases(){
 static const std::vector<IDEHelperBuildRelease> admitted;return admitted;
}
}
