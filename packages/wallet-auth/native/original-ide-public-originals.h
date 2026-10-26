#pragma once
#include <cstdint>
#include "original-auth-identity-public-limits.h"
#include <string>
#include <sys/stat.h>
namespace ynx_auth_ide_private {
// Pure layout/identity predicates, NOT enrollment/Root/permission evidence.
// Only the owning Native callee supplies kernel getuid(), never a JS argument.
inline std::string originalIDERegistryBase(std::uint32_t kernelUID){return "/Library/Application Support/YNX/OriginalAuthIdentity/UID-"+std::to_string(kernelUID)+"/Developer";}
inline bool originalIDERegistryDirectory(const struct stat&s){return S_ISDIR(s.st_mode)&&s.st_uid==0&&(s.st_mode&0022)==0;}
inline bool originalIDERegistryPublicFile(const struct stat&s){return S_ISREG(s.st_mode)&&s.st_uid==0&&(s.st_mode&0022)==0&&s.st_nlink==1&&s.st_size>0&&s.st_size<=(off_t)ynx_auth_private::OriginalAuthPublicOriginalMax;}
}
