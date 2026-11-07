#pragma once
#include <string>
#include <vector>
#include <cstdint>
namespace ynx::auth::sourceparent {
// Offline Root/A registered CODE resource locators only, never caller inputs.
// The external postbuild original avoids embedding any image's own digest
// into that image. These literals do NOT authorize SourceBIND or operations.
struct ReviewedProfileLocator {
 std::string registrationDirectory,registrationLeaf,packageDirectory;
 uint32_t imageOwnerUID=0;
};
inline const std::vector<ReviewedProfileLocator>&originalReviewedProfileLocators(){
#ifdef YNX_REVIEWED_SOURCEPARENT_CODE_LOCATORS
 static const std::vector<ReviewedProfileLocator>v={YNX_REVIEWED_SOURCEPARENT_CODE_LOCATORS};
#else
 static const std::vector<ReviewedProfileLocator>v;
#endif
 return v;
}
}
