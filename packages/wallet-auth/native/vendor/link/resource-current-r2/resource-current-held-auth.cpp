#include "resource_current_auth_v2.h"
#include "resource-current-held-bound.hpp"
#if defined(YNX_LINK_RESOURCE_CURRENT_AUTH_ADAPTER)
#include "network_publisher_resource_ref_private.h"
#include <cstring>
#include <string>

namespace {
bool bounded(const char *p, size_t max, std::string &out) {
    if (!p) return false;size_t size = ::strnlen(p, max);if (!size || size == max) return false;out.assign(p, size);return true;
}
std::string image_hex(const uint8_t hash[32]) {
    static const char digits[] = "0123456789abcdef";std::string out;out.reserve(64);
    for (size_t i = 0; i < 32; ++i) { out.push_back(digits[hash[i] >> 4]);out.push_back(digits[hash[i] & 15]); }
    return out;
}
}
extern "C" int32_t ynx_link_resource_current_open_original_auth_v2(
    YNXOriginalNetworkPublisherResourceRef *original, ynx_link_resource_current_client_v2 **out,
    const ynx_link_resource_current_packet_v2 **packet, int32_t *native) {
    if (!out || !packet || !native) return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
    *out = nullptr;*packet = nullptr;*native = 0;
    if (!original) return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
    try {
    ynx_link_resource_current_profile_v2 profile{};profile.version = 2;profile.size = sizeof(profile);
    ynx_link_private_client_source_fence_v1 fence{};
    int32_t rc = ynx_auth_network_publisher_resource_copy_link_profile_v1(original, &profile.peer, &fence);
    if (rc) { *native = rc;return YNX_LINK_RESOURCE_CURRENT_NATIVE_CURRENT_V1; }
    YNXOriginalNetworkPublisherResourceBinding binding{};binding.version = 1;binding.size = sizeof(binding);
    rc = ynx_auth_network_publisher_resource_copy_binding_v1(original, &binding);
    if (rc) { *native = rc;return YNX_LINK_RESOURCE_CURRENT_NATIVE_CURRENT_V1; }
    // The actual frozen producer's binding is Darwin seconds/microseconds.
    // Do not invent a Linux or response-JSON identity for this original ref.
    if (profile.peer.start_kind != YNX_LINK_RESOURCE_CURRENT_DARWIN_START_V1 || fence.ctx != original ||
        binding.version != 1 || binding.size != sizeof(binding) || binding.peer_pid != static_cast<uint32_t>(profile.peer.peer_pid) ||
        binding.peer_uid != profile.peer.peer_uid || binding.peer_start_seconds != profile.peer.start_a ||
        binding.peer_start_microseconds != profile.peer.start_b || binding.peer_image_bytes != profile.peer.image_bytes ||
        binding.timeout_ms != profile.peer.timeout_ms) return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
    std::string source, instance, key, image, hash, directory, leaf;
    if (!bounded(binding.source_id, 257, source) || !bounded(binding.instance_id, 257, instance) || !bounded(binding.resource_key, 257, key) ||
        !bounded(binding.peer_image_path, 4096, image) || !bounded(binding.peer_image_sha256, 65, hash) ||
        !bounded(binding.socket_directory, 104, directory) || !bounded(binding.socket_leaf, 104, leaf) ||
        source != profile.peer.source_id || instance != profile.peer.instance_id || key != profile.peer.resource_key ||
        image != profile.peer.image_path || hash != image_hex(profile.peer.image_sha256) || directory + "/" + leaf != profile.peer.socket_path)
        return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
    const std::string start = "darwin:" + std::to_string(binding.peer_start_seconds) + ":" + std::to_string(binding.peer_start_microseconds);
    if (start.size() >= sizeof(profile.expected_server_start_identity)) return YNX_LINK_RESOURCE_CURRENT_BOUNDS_V1;
    std::memcpy(profile.expected_server_start_identity, start.c_str(), start.size() + 1);
    // These are the original producer-supplied typed thunks, not casts or
    // caller booleans. Open retains and owns the same ref until real r2 drain.
    const ynx::resource_current_detail::HeldEndpointBinding endpoint{
        binding.directory_device, binding.directory_inode, binding.socket_device, binding.socket_inode};
    return ynx::resource_current_detail::open_bound_resource_current_v2(&profile, &fence, endpoint, out, packet);
    } catch (...) {
        // Both original getters promise no acquired reference; LINK's Open
        // handles/adopts its own partial and never throws across this ABI.
        return YNX_LINK_RESOURCE_CURRENT_UNAVAILABLE_V1;
    }
}
#else
static_assert(true, "Original Auth adapter not selected; no production symbols emitted.");
#endif
