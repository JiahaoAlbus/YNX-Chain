#include "pay_native_requests.hpp"

namespace ynx::wallet::pay::producer {
namespace {
[[noreturn]] void deny(const char*code){throw Failure{code};}
std::string base64(const std::vector<uint8_t>& bytes){
 static constexpr char alphabet[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
 std::string out;out.reserve(4*((bytes.size()+2)/3));
 for(size_t i=0;i<bytes.size();i+=3){
  const uint32_t n=(static_cast<uint32_t>(bytes[i])<<16)|
   (i+1<bytes.size()?static_cast<uint32_t>(bytes[i+1])<<8:0)|
   (i+2<bytes.size()?static_cast<uint32_t>(bytes[i+2]):0);
  out+=alphabet[(n>>18)&63];out+=alphabet[(n>>12)&63];
  out+=i+1<bytes.size()?alphabet[(n>>6)&63]:'=';
  out+=i+2<bytes.size()?alphabet[n&63]:'=';
 }
 return out;
}
}
std::vector<RouteConstraint> original_route_constraints(const Binding&original,bool query){
 validate_binding(original);
 const auto kind=original.target.kind;
 const auto post=kind==Kind::terms?Operation::post_terms:kind==Kind::settlement?Operation::post_settlement:Operation::post_refund;
 const auto get=kind==Kind::terms?Operation::get_intent:Operation::get_invoice;
 std::vector<RouteConstraint> routes;
 if(!query)routes.push_back({post,"POST",path(post,original.target),"application/json"});
 routes.push_back({get,"GET",path(get,original.target),{}});
 return routes;
}
Request original_request(Operation op,const Binding& original,bool query_only,
                         const std::vector<uint8_t>& member){
 validate_binding(original);
 switch(op){
  case Operation::post_terms:case Operation::post_settlement:case Operation::post_refund:
  case Operation::get_intent:case Operation::get_invoice:break;
  default:deny("PAY_NATIVE_OPERATION_INVALID");
 }
 Request request{method(op),path(op,original.target),{}, {}};
 if(request.method=="GET"){
  if(!member.empty())deny("PAY_NATIVE_QUERY_MEMBER");
  return request;
 }
 if(query_only)deny("PAY_NATIVE_ORIGINAL_QUERY_ONLY");
 if(member.empty()||member.size()>98304)deny("PAY_NATIVE_ORIGINAL_MEMBER_BOUNDS");
 if(hash_original(member)!=original.member_hash)deny("PAY_NATIVE_MEMBER_CHANGED");
 if(request.path!=original.target.request_path)deny("PAY_NATIVE_TARGET_PATH");
 request.content_type="application/json";
 const auto body="{\"member\":\""+base64(member)+"\"}";
 request.body.assign(body.begin(),body.end());
 return request;
}
}
