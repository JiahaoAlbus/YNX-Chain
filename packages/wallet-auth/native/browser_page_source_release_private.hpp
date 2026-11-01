#pragma once
#include "original-auth-identity-native-release.h"
namespace ynx::browser::page {
/* Separate independently reviewed Browser release, never an IDE/Wallet/AI row.
 * Existing exact signature frames/runtime/node pins remain in source. No
 * endpoint object, postbuild selfhash, caller path or approval bool is compiled.
 * No values/default row are supplied in this implementation delivery. */
struct BrowserPageSourceRelease {
    ynx_auth_private::NativeSourceRelease source;
    std::string resource_directory,application_id,product_id,platform;
    uint64_t uid=0;
};
inline const std::vector<BrowserPageSourceRelease>& original_browser_page_releases(){
#ifdef YNX_REVIEWED_BROWSER_PAGE_SOURCE_ROWS
    static const std::vector<BrowserPageSourceRelease> rows={YNX_REVIEWED_BROWSER_PAGE_SOURCE_ROWS};
#else
    static const std::vector<BrowserPageSourceRelease> rows;
#endif
    return rows;
}
}
