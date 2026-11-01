#include "pay_native_link_channel.hpp"
#include "pay_native_requests.hpp"
#include <mutex>
#include <utility>

namespace ynx::wallet::pay::producer {
namespace {
using Raw=ynx_link_private_client_packet_v1;
struct FreePacket {void operator()(Raw*p)const{if(p)ynx_link_private_client_packet_free_v1(p);}};
using OwnedPacket=std::unique_ptr<Raw,FreePacket>;
[[noreturn]] void deny(const char*code){throw Failure{code};}
std::string text(const uint8_t*p,size_t n,size_t maximum){
 if(n>maximum||(!p&&n))deny("PAY_LINK_PACKET_BOUNDS");
 return n?std::string(reinterpret_cast<const char*>(p),n):std::string{};
}
Failure failure(int32_t code,const Raw*packet){
 const auto observed=packet&&packet->error_code!=YNX_LINK_PRIVATE_OK_V1?packet->error_code:code;
 std::string value="PAY_LINK_TRANSPORT_ERROR_"+std::to_string(observed);
 if(packet&&packet->native_current_code)value+=":native="+std::to_string(packet->native_current_code);
 if(packet&&packet->error_message_size){
  value+=":"+text(reinterpret_cast<const uint8_t*>(packet->error_message),packet->error_message_size,16384);
 }
 return Failure{std::move(value)};
}
uint8_t index(Operation op){
 switch(op){
  case Operation::post_terms:return YNX_LINK_PRIVATE_POST_TERMS_V1;
  case Operation::post_settlement:return YNX_LINK_PRIVATE_POST_SETTLEMENT_V1;
  case Operation::post_refund:return YNX_LINK_PRIVATE_POST_REFUND_V1;
  case Operation::get_intent:return YNX_LINK_PRIVATE_GET_INTENT_V1;
  case Operation::get_invoice:return YNX_LINK_PRIVATE_GET_INVOICE_V1;
 }
 deny("PAY_NATIVE_OPERATION_INVALID");
}
class RegisteredChannel final:public QualifiedPayChannel {
 Binding original_;bool query_,attempted_=false,retired_=false,joined_=false,closed_=false;
 ynx_link_private_client_holder_v1*holder_=nullptr;
 std::mutex mutex_;
 std::optional<Failure>first_;
 void check(int32_t rc){
  if(rc==YNX_LINK_PRIVATE_OK_V1)return;
  Raw*raw=nullptr;if(holder_)ynx_link_private_client_error_v1(holder_,&raw);OwnedPacket packet(raw);
  const auto cause=failure(rc,packet.get());
  {std::lock_guard<std::mutex>g(mutex_);if(!first_)first_=cause;}
  throw cause;
 }
public:
 RegisteredChannel(Binding b,bool query):original_(std::move(b)),query_(query){}
 ~RegisteredChannel()override{
  // The C owner retains its Source fence on any uncertain drain/close. A
  // finalizer must never free that borrow or turn failure into a fresh client.
  if(!holder_)return;
  ynx_link_private_client_retire_v1(holder_);
 }
 void initialize(ynx_link_private_client_registration_v1*registration,
                 const ynx_link_private_client_source_fence_v1&fence){
  validate_binding(original_);
  // Always retain the returned partial before interpreting its error.
  const auto rc=ynx_link_private_client_capture_v1(registration,&fence,query_,&holder_);
  check(rc);if(!holder_)deny("PAY_LINK_HOLDER_NOT_SUPPLIED");
  current();
 }
 void current()override{
  {std::lock_guard<std::mutex>g(mutex_);if(first_)throw *first_;if(retired_||closed_||!holder_)deny("PAY_LINK_NOT_CURRENT");}
  check(ynx_link_private_client_current_source_v1(holder_));
 }
 void recheck()override{current();check(ynx_link_private_client_recheck_v1(holder_));}
 Exchange exchange(Operation op,const Binding&binding,const std::vector<uint8_t>&member)override{
  if(!(binding==original_))deny("PAY_NATIVE_ORIGINAL_CHANGED");
  const auto request=original_request(op,original_,query_,member);
  current();
  {std::lock_guard<std::mutex>g(mutex_);if(retired_||closed_)deny("PAY_LINK_NOT_CURRENT");
   if(request.method=="POST"){if(attempted_)deny("PAY_NATIVE_ORIGINAL_QUERY_ONLY");attempted_=true;}}
  Raw*raw=nullptr;
  const auto rc=ynx_link_private_client_call_v1(holder_,index(op),request.body.empty()?nullptr:request.body.data(),request.body.size(),&raw);
  OwnedPacket packet(raw);Exchange result;
  if(packet&&packet->packet_present){
   if(packet->status_code<100||packet->status_code>599||packet->body_size>2097152||(!packet->body&&packet->body_size))deny("PAY_LINK_PACKET_BOUNDS");
   Packet actual{text(packet->method,packet->method_size,1024),text(packet->request_path,packet->request_path_size,8192),
    text(packet->content_type,packet->content_type_size,8192),text(packet->cache_control,packet->cache_control_size,8192),
    static_cast<uint32_t>(packet->status_code),{}};
   if(packet->body_size)actual.body.assign(packet->body,packet->body+packet->body_size);
   result.packet=std::move(actual);
  }
  // Preserve the actual response before any late error/current check. No MIME
  // normalization, JSON parsing, expected-path relabel, retry or query fallback.
  if(rc!=YNX_LINK_PRIVATE_OK_V1||(packet&&packet->error_code!=YNX_LINK_PRIVATE_OK_V1)){
   result.error=failure(rc,packet.get());std::lock_guard<std::mutex>g(mutex_);if(!first_)first_=result.error;
  }else if(!result.packet){result.error=Failure{"PAY_LINK_PACKET_NOT_SUPPLIED"};std::lock_guard<std::mutex>g(mutex_);if(!first_)first_=result.error;}
  return result;
 }
 void retire()override{
  {std::lock_guard<std::mutex>g(mutex_);retired_=true;}
  if(holder_)check(ynx_link_private_client_retire_v1(holder_));
 }
 void join()override{
  {std::lock_guard<std::mutex>g(mutex_);if(!retired_)deny("PAY_NATIVE_RETIRE_REQUIRED");if(joined_)return;}
  if(holder_)check(ynx_link_private_client_join_v1(holder_,30000));
  std::lock_guard<std::mutex>g(mutex_);joined_=true;
 }
 void close()override{
  {std::lock_guard<std::mutex>g(mutex_);if(closed_)return;if(!retired_||!joined_)deny("PAY_NATIVE_CHILDREN_RETAINED");}
  if(holder_){check(ynx_link_private_client_close_v1(holder_));check(ynx_link_private_client_free_v1(holder_));holder_=nullptr;}
  std::lock_guard<std::mutex>g(mutex_);closed_=true;
 }
};
}
void capture_registered_channel(const Binding&original,bool query,
 ynx_link_private_client_registration_v1*registration,
 const ynx_link_private_client_source_fence_v1&fence,
 std::unique_ptr<QualifiedPayChannel>*out){
 if(!out)deny("PAY_LINK_PARTIAL_OUT_REQUIRED");
 auto channel=std::make_unique<RegisteredChannel>(original,query);auto*partial=channel.get();
 *out=std::move(channel);partial->initialize(registration,fence);
}
}
