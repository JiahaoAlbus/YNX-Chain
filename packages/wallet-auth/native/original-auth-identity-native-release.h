#pragma once
#include <string>
#include <vector>
namespace ynx_auth_private {
// PRIVATE release admission, not a runtime JSON/ENV allowlist. Root must bind
// actual independently approved public enrollment and exact verifier images.
// No QA/SSO/IDE project root is enrolled by this implementation delivery.
struct NativeSourceRelease {
 std::string sourceId,rootDigest,enrollmentDigest,verifierImageDigest,nodeImageDigest,verifierImagePath,nodeImagePath,endpoint,spki;
 // Exact EXISTING Auth signature contract, independently accepted with the
 // same registration. Never assigned defaults by the verifier or producer.
 std::string purpose,enrollmentFrame,profileFrame,currentFrame;
};
inline const std::vector<NativeSourceRelease>& originalNativeSourceReleases(){
 static const std::vector<NativeSourceRelease> admitted;return admitted;
}
}
