#pragma once
#import <Foundation/Foundation.h>
#include <memory>
#include "browser_page_request_private_v2.h"
@class YNXBrowserPageTransport;
namespace ynx::browser::page {
/* Source-private call contract, NOT a public provider/verifiedbool/Root setter.
 * Real implementation must retain SAME independently qualified Browser Source
 * owner and epoch, and execute that owner's actual current. No replacement/
 * reacquire/refresh, no child-current masquerading as the Source parent.
 * No production implementation or Source-mint exists in this component yet. */
class OriginalParentCurrent {
public:
    virtual int32_t current_original() noexcept = 0;
    virtual ~OriginalParentCurrent() = default;
};
/* Native DATA assembly only. These private functions confer NO Source grant.
 * Only the future Source-v2 math constructor may use these in normal startup;
 * normal zero-input C capture remains NOT_SUPPLIED until that constructor exists.
 * Shared parent must physically retain original resources/child debt. */
ynx_browser_page_parent_v2 *retain_original_parent_for_request_data(
    std::shared_ptr<OriginalParentCurrent> original) noexcept;
int32_t assemble_original_request_data(ynx_browser_page_parent_v2 *,
    YNXBrowserPageTransport *same_child, NSData *original_raw,
    NSString *original_preparation,NSString *original_profile,
    ynx_browser_page_request_v2 **out) noexcept;
}
