#pragma once
#include "pay_native_kernel.hpp"

namespace ynx::wallet::pay::producer {
// Native DATA selected from the retained original binding. This value cannot
// qualify a channel; only the original LINK holder may dispatch it.
struct Request final {
 std::string method,path,content_type;
 std::vector<uint8_t> body;
};
struct RouteConstraint final {
 Operation operation;
 std::string method,path,content_type;
};
// Constraints to AND with the real Root-owned registered profile. These do
// not register a destination or authorize an operation. No invented intent ID
// is needed for a settlement/refund, and query scopes contain only one GET.
std::vector<RouteConstraint> original_route_constraints(const Binding&,bool query_only);
Request original_request(Operation,const Binding&,bool query_only,
                         const std::vector<uint8_t>& original_member);
}
