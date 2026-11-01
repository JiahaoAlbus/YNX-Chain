#pragma once
#include "pay_root_public_hold_private.hpp"
#include <array>
#include <string>
namespace ynx::wallet::pay::root_physical {
// PRIVATE owned deployment DATA. Not an SDK WIRE or authority. Only the final
// original Root producer may export these after signed scope+Ref+current AND.
struct TransportRoute { bool enabled=false;std::string method,path;uint64_t maximum_body_bytes=0,timeout_ms=0; };
struct TransportProfile {
 std::string protected_resource_ref,socket_path,service;
 uint32_t peer_uid=0;int32_t peer_pid=0;
 uint64_t timeout_ms=0,maximum_header_bytes=0,maximum_response_bytes=0;
 std::array<TransportRoute,5> routes;
};
// expected_ref comes from the genuinely authenticated dedicated SDK scope,
// NOT Binding/renderer. Does not itself authenticate Source or make a lease.
// Failed pre/post physical read or malformed data leaves out unchanged.
Code read_pay_transport_original_v1(PublicOriginalHold&,
 const std::string& expected_ref,TransportProfile&out) noexcept;
}
