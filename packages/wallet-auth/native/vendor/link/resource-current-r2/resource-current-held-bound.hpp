#ifndef YNX_LINK_RESOURCE_CURRENT_HELD_BOUND_HPP
#define YNX_LINK_RESOURCE_CURRENT_HELD_BOUND_HPP
#include "resource_current_client_v2.h"
namespace ynx::resource_current_detail {
/* Internal transport DATA from the SAME original Auth resource binding.
 * Not a Root constructor/JSON setter. The strong Auth adapter is the normal
 * caller. PUBLIC controls may exercise mismatch denial without a real Root.
 * Checks include post-connect and immediately-before-write observations; they
 * do not claim an atomic filesystem/connect/GoSource transaction.
 */
struct HeldEndpointBinding {
    uint64_t directory_device, directory_inode, socket_device, socket_inode;
};
int32_t open_bound_resource_current_v2(const ynx_link_resource_current_profile_v2 *profile,
    const ynx_link_private_client_source_fence_v1 *fence, const HeldEndpointBinding &original_endpoint,
    ynx_link_resource_current_client_v2 **out_client,
    const ynx_link_resource_current_packet_v2 **out_packet);
}
#endif
