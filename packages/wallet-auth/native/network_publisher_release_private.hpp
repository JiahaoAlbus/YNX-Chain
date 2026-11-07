#pragma once
#include "original-auth-identity-native-release.h"
namespace ynx::network::publisher {
inline constexpr char purpose[]="network-resource-current-publisher-source-v1";
struct Release {
 ynx_auth_private::NativeSourceRelease source;
 std::string resourceDirectory,applicationId,platform,originalOperation64;
 // Independently commissioned original P09 mapping. Root profile descriptor
 // must match ref/source/instance/key; observed peer/FD must ALSO match these.
 // Merely copying these public fields never creates the opaque Native ref.
 std::string registeredResourceRef,peerImagePath,peerImageSHA256,socketDirectory,socketLeaf;
 uint32_t peerUID=0,peerPID=0;uint64_t peerStartSeconds=0;uint32_t peerStartMicros=0;
 uint64_t directoryDevice=0,directoryInode=0,socketDevice=0,socketInode=0;
 uint64_t peerImageBytes=0;uint32_t timeoutMS=10000;
 uint64_t uid=0;
};
inline const std::vector<Release>& releases(){
#ifdef YNX_REVIEWED_NETWORK_CURRENT_PUBLISHER_ROWS
 static const std::vector<Release> rows={YNX_REVIEWED_NETWORK_CURRENT_PUBLISHER_ROWS};
#else
 static const std::vector<Release> rows;
#endif
 return rows;
}
}
