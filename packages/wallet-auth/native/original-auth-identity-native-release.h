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
 // Dedicated independently admitted initiator runtime. Empty historical rows
 // do not qualify it. Paths/digests are compile-time release inputs, NOT ENV,
 // caller JSON, a project owner boolean or a public signature projection.
 std::string contractRelayRuntimeDirectory,contractRelayRuntimeManifestDigest,contractRelayExecutorDigest;
 // Original independently admitted project authority endpoint. Never supplied
 // by renderer/HTTP request or inferred from Relay/login source selections.
 std::string projectAuthorityEndpoint,projectAuthoritySPKI;
};
inline const std::vector<NativeSourceRelease>& originalNativeSourceReleases(){
 // An independently approved App build may supply typed ROWS via its frozen
 // private compile input. No runtime ENV/JSON/provider/setter is consulted.
 // Keep those values OUTSIDE the packaged SDK runtime inventory, avoiding a
 // digest self-reference through this public generic header. Macro presence
 // is not authority: all original protected registry/Root/current checks run.
#ifdef YNX_ORIGINAL_NATIVE_SOURCE_RELEASE_ROWS
 static const std::vector<NativeSourceRelease> admitted={YNX_ORIGINAL_NATIVE_SOURCE_RELEASE_ROWS};
#else
 static const std::vector<NativeSourceRelease> admitted;
#endif
 return admitted;
}
}

