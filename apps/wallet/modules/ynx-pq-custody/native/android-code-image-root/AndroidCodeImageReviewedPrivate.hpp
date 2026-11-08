#pragma once
#include <vector>
#include <string>
namespace ynx::mobilepq::android_code_image {
// SAME Root/A protected external CODE registration model as the existing
// SourceParent producer; this platform adapter does not borrow Network roles.
// The reviewed locator has NO own-image hash/size. Those facts live only in
// the independently protected external record created AFTER final JNI link.
struct ReviewedLocator {std::string registrationDirectory,registrationLeaf,processName;};
inline const std::vector<ReviewedLocator>&originalReviewedLocators(){
#ifdef YNX_REVIEWED_ANDROID_CODE_IMAGE_LOCATORS
 static const std::vector<ReviewedLocator>rows={YNX_REVIEWED_ANDROID_CODE_IMAGE_LOCATORS};
#else
 static const std::vector<ReviewedLocator>rows;
#endif
 return rows;
}
}
