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
 // Explicit optional versioned extension. Empty old rows remain unsupported;
 // these fields MUST be bound by the original independent release process.
 std::string persistentVersion,persistentContractDigest,persistentFrame,persistentNamespace;
 std::string firstEnterVerifierDigest,persistentModuleDigest;
 // Independent exact runtime closure and canonical NativeNode binding. Empty
 // historical rows are NOT proof consumers; no endpoint/TOFU/ENV defaults.
 std::string proofContract,proofDispatchDigest,proofRuntimeManifestDigest;
 std::string nativeNodeOrigin,nativeNodeSPKI,nativeChainId;
};
inline const std::vector<NativeSourceRelease>& originalNativeSourceReleases(){
 static const std::vector<NativeSourceRelease> admitted;return admitted;
}
}

