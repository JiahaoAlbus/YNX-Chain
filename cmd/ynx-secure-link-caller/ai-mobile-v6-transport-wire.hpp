#ifndef YNX_AI_MOBILE_V6_TRANSPORT_WIRE_HPP
#define YNX_AI_MOBILE_V6_TRANSPORT_WIRE_HPP

#include "ide-finite-get-wire.hpp"
#include <cstddef>
#include <string>

// PRIVATE HTTP DATA framing only. Native supplies immutable captured method,
// target, authority, original head and body. No proof/route/signature/Source
// parser or request builder is provided here.
namespace ynx::ai_mobile_v6::physical::wire {

bool check_request_head(const std::string &head, const std::string &method,
                        const std::string &path, const std::string &authority,
                        std::size_t body_size, std::size_t header_limit,
                        std::string &why);

// Reuse only the frozen standard HTTP response framing, with its existing
// <=262144 header, <=1048576 entity and bounded wire limits. Reader exceptions
// propagate; received prefixes stay in Response. Completion grants no business
// or Root/Source acceptance. No finite7 route/build_request operation is used.
using Response = ::ynx::ide_finite_get::wire::Response;
using Reader = ::ynx::ide_finite_get::wire::Reader;
using Limits = ::ynx::ide_finite_get::wire::Limits;
using ::ynx::ide_finite_get::wire::read_response;

} // namespace ynx::ai_mobile_v6::physical::wire
#endif
