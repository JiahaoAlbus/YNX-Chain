#pragma once
#include <string>
#include <stdexcept>
#include <array>
namespace ynx::device::management {
enum class Operation{active,recover,revoke,cancel};
enum class SessionProvenance{registered_original,completion_intended,pair_without_session};
inline const char*path(Operation op){switch(op){case Operation::active:return"/v4/product-sessions/active";case Operation::recover:return"/v4/product-sessions/recover";case Operation::revoke:return"/v4/product-sessions/revoke";case Operation::cancel:return"/v4/product-session-challenges/cancel";}throw std::runtime_error("DEVICE_MANAGEMENT_V4_OPERATION");}
inline Operation operation_from_path(const std::string&p){for(auto op:{Operation::active,Operation::recover,Operation::revoke,Operation::cancel})if(p==path(op))return op;throw std::runtime_error("DEVICE_MANAGEMENT_V4_ROUTE_NOT_REGISTERED");}
inline bool hex64(const std::string&s){if(s.size()!=64)return false;for(char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;return true;}
// Pure DATA gate, never a Root/current/registered-state proof. Native factory
// must independently obtain this provenance from its genuine Source owner.
inline void assert_binding_role(Operation op,SessionProvenance kind,const std::string&binding){
 if(kind==SessionProvenance::pair_without_session)throw std::runtime_error("PAIR_V4_RECOVERY_SESSION_BINDING_NOT_DERIVABLE");
 if(!hex64(binding)||binding==std::string(64,'0'))throw std::runtime_error("DEVICE_MANAGEMENT_V4_ORIGINAL_SESSION_BINDING_REQUIRED");
 if(kind==SessionProvenance::completion_intended&&op!=Operation::recover)throw std::runtime_error("DEVICE_MANAGEMENT_V4_INTENDED_QUERY_ONLY");
 if(kind!=SessionProvenance::registered_original&&kind!=SessionProvenance::completion_intended)throw std::runtime_error("DEVICE_MANAGEMENT_V4_PROVENANCE");
}
inline constexpr size_t body_max=393216,unsigned_max=16384,member_max=98304;
}
