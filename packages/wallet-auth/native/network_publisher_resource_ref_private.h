#pragma once
#include <stdint.h>
#include <stddef.h>
#include "resource_current_client_v1.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct YNXOriginalNetworkPublisherResourceRef YNXOriginalNetworkPublisherResourceRef;
typedef struct {
 uint32_t version,size;
 const char *network_id,*source_id,*instance_id,*resource_key,*registered_resource_ref;
 const char *publisher_owner,*peer_image_path,*peer_image_sha256,*socket_directory,*socket_leaf;
 uint32_t peer_uid,peer_pid;uint64_t peer_start_seconds;uint32_t peer_start_microseconds;
 uint64_t directory_device,directory_inode,socket_device,socket_inode;
 uint64_t peer_image_bytes;uint32_t timeout_ms;
} YNXOriginalNetworkPublisherResourceBinding;
/* Opaque ref is minted ONLY by actual qualified Native capture. No create,
 * register, JSON, pid/path selector, constructor or callback setter is exported.
 * retain/current/release are pure Native observation/debt operations, no JS/IO.
 * Local current is NOT a fresh Root/peer verification: actual transport must
 * check kernel peer+same connection; Native owner full Root pre/post still AND.
 * Binding pointers live until retained borrow is released. Never close parent.
 */
int32_t ynx_auth_network_publisher_resource_retain_v1(YNXOriginalNetworkPublisherResourceRef*);
int32_t ynx_auth_network_publisher_resource_current_v1(YNXOriginalNetworkPublisherResourceRef*);
int32_t ynx_auth_network_publisher_resource_copy_binding_v1(YNXOriginalNetworkPublisherResourceRef*,YNXOriginalNetworkPublisherResourceBinding*);
void ynx_auth_network_publisher_resource_release_v1(YNXOriginalNetworkPublisherResourceRef*);
/* Converts only a known live Root ref. No new borrow: LINK open takes its own
 * retain. Every callback's ctx is SAME ref; never caller function/JSON config. */
int32_t ynx_auth_network_publisher_resource_copy_link_profile_v1(YNXOriginalNetworkPublisherResourceRef*,ynx_link_resource_current_profile_v1*,ynx_link_private_client_source_fence_v1*);
#ifdef __cplusplus
}
#endif
