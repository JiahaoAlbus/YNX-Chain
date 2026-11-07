#ifndef YNX_LINK_RESOURCE_CURRENT_HELD_IDENTITY_HPP
#define YNX_LINK_RESOURCE_CURRENT_HELD_IDENTITY_HPP
#include "resource-current-held-json.hpp"
namespace ynx::resource_current_detail {
/* Native OS observations for matching the existing P09 observation fields.
 * This does not construct a Root/Source or turn an observed PID/image into Go
 * qualification. The actual server is independently bound by PeerLease and
 * Auth's original Root-selected immutable profile. */
bool observe_held_process(int32_t pid, HeldProcessIdentity &out, std::string &failure);
bool same_held_process(const HeldProcessIdentity &a, const HeldProcessIdentity &b);
}
#endif
