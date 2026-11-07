#ifndef YNX_LINK_RESOURCE_CURRENT_AUTH_V2_H
#define YNX_LINK_RESOURCE_CURRENT_AUTH_V2_H
#include "resource_current_client_v2.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Exact opaque type from Auth's original private resource-ref ABI. There is
 * no constructor, cast from transport metadata or caller-supplied callback.
 * The original native owner must hold this exact ref through the call. */
typedef struct YNXOriginalNetworkPublisherResourceRef YNXOriginalNetworkPublisherResourceRef;
/* Optional strong same-image adapter. Build its implementation explicitly
 * with YNX_LINK_RESOURCE_CURRENT_AUTH_ADAPTER and the pinned original Auth
 * private header/body. Ordinary transport CI has no unresolved Auth symbols.
 * copy_link_profile/copy_binding use the SAME actual ref; LINK open itself
 * retains its original typed fence. native_current_code preserves failures
 * before a LINK partial exists. Nonnull outputs are still adopted first.
 * This conversion of the original Darwin v1 binding to the held v2 transport
 * does not qualify r2 remote cleanup, a Root, Source, issuer or signature.
 */
int32_t ynx_link_resource_current_open_original_auth_v2(
    YNXOriginalNetworkPublisherResourceRef *original,
    ynx_link_resource_current_client_v2 **out_client,
    const ynx_link_resource_current_packet_v2 **out_packet,
    int32_t *native_current_code);
#ifdef __cplusplus
}
#endif
#endif
