#pragma once
#include "product_source_release_private.hpp"
#include <array>
#include <sys/types.h>
#include <climits>
#include <tuple>
namespace ynx::wallet::product::publication {
// Private independently reviewed INSTALLATION input, not consumer read
// permission, an issuer, Root key, JSON input, ENV or runtime row setter.
// One frozen external typed header supplies this and ProductSourceRelease.
struct InstallationRelease {
 ProductSourceRelease product;
 std::string operation_id,approval_original_sha256;
 std::string materialized_directory;
 std::array<std::string,4> public_original_sha256;
 uint64_t materialized_device=0,materialized_inode=0;
 uint64_t target_device=0,target_inode=0;
 uint64_t issued_ms=0,expires_ms=0;
 std::string client_requirement,node_requirement,helper_requirement,team_identifier;
 // Optional SAME Root-reviewed transport/public metadata resource. Empty never
 // acquires a materialization loan; publication-only old rows are not upgraded.
 std::string materialization_service_name,independent_materialization_sha256;
 uint64_t independent_materialization_bytes=0;
 std::string registration_capture_entry,registration_capture_entry_sha256;
};
inline const std::vector<InstallationRelease>&original_installation_releases(){
#ifdef YNX_REVIEWED_WPR_PUBLIC_INSTALLATION_ROWS
 static const std::vector<InstallationRelease>rows={YNX_REVIEWED_WPR_PUBLIC_INSTALLATION_ROWS};
#else
 static const std::vector<InstallationRelease>rows;
#endif
 return rows;
}
inline bool registered(const InstallationRelease*row){if(!row)return false;for(const auto&r:original_installation_releases())if(&r==row)return true;return false;}
inline bool same_installation_release(const InstallationRelease&a,const InstallationRelease&b){
 auto common=[](const ynx_auth_private::NativeSourceRelease&s){return std::tie(s.sourceId,s.rootDigest,s.enrollmentDigest,s.verifierImageDigest,s.nodeImageDigest,s.verifierImagePath,s.nodeImagePath,s.endpoint,s.spki,s.purpose,s.enrollmentFrame,s.profileFrame,s.currentFrame,s.proofContract,s.proofDispatchDigest,s.proofRuntimeManifestDigest,s.nativeNodeOrigin,s.nativeNodeSPKI,s.nativeChainId);};
 auto installation=[](const InstallationRelease&r){return std::tie(r.product.application_id,r.product.product_id,r.product.platform,r.product.resource_directory,r.product.uid,r.operation_id,r.approval_original_sha256,r.materialized_directory,r.public_original_sha256,r.materialized_device,r.materialized_inode,r.target_device,r.target_inode,r.issued_ms,r.expires_ms,r.client_requirement,r.node_requirement,r.helper_requirement,r.team_identifier,r.materialization_service_name,r.independent_materialization_sha256,r.independent_materialization_bytes);};
 return common(a.product.source)==common(b.product.source)&&installation(a)==installation(b)&&a.registration_capture_entry==b.registration_capture_entry&&a.registration_capture_entry_sha256==b.registration_capture_entry_sha256;
}
inline bool digest(const std::string&s){if(s.size()!=64)return false;for(unsigned char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;return true;}
inline bool valid_installation_release(const InstallationRelease&r){
 const auto&p=r.product;const auto&s=p.source;
 // Release-review window is not the fresh current-signature lifetime. The
 // latter remains independently <=30s and nonrenewing per receiver attempt;
 // conflating them would make any normal compile/install pipeline impossible.
 if(s.purpose!="wallet-native-product-source-v1"||p.product_id!="wallet"||p.platform!="macos"||p.application_id.empty()||!p.uid||p.uid>UINT32_MAX||!digest(r.operation_id)||!digest(r.approval_original_sha256)||!r.materialized_device||!r.materialized_inode||!r.target_device||!r.target_inode||r.issued_ms==0||r.expires_ms<=r.issued_ms||r.expires_ms>9007199254740991ULL)return false;
 auto path=[](const std::string&s){return !s.empty()&&s.front()=='/'&&s.size()<PATH_MAX&&s.find('\0')==std::string::npos;};
 if(!path(r.materialized_directory)||!path(p.resource_directory)||r.materialized_directory==p.resource_directory||!path(s.verifierImagePath)||!path(s.nodeImagePath)||s.sourceId.size()>128||p.application_id.size()>256)return false;
 if(r.client_requirement.empty()||r.node_requirement.empty()||r.helper_requirement.empty()||r.team_identifier.empty()||r.node_requirement==r.client_requirement||r.helper_requirement==r.client_requirement)return false;
 if(s.sourceId.empty()||!digest(s.rootDigest)||!digest(s.enrollmentDigest)||!digest(s.verifierImageDigest)||!digest(s.nodeImageDigest)||s.verifierImagePath.empty()||s.nodeImagePath.empty()||s.enrollmentFrame.empty()||s.profileFrame.empty()||s.currentFrame.empty()||s.endpoint.empty()||s.spki.empty()||s.proofContract.empty()||!digest(s.proofDispatchDigest)||!digest(s.proofRuntimeManifestDigest)||s.nativeNodeOrigin.empty()||!digest(s.nativeNodeSPKI)||s.nativeChainId.empty())return false;
 for(const auto&h:r.public_original_sha256)if(!digest(h))return false;
 return r.public_original_sha256[0]==s.rootDigest&&r.public_original_sha256[1]==s.enrollmentDigest;
}
}
