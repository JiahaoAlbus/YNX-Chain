#include "pay_native_kernel.hpp"
#include <regex>
#include <utility>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
#endif

namespace ynx::wallet::pay {
static void deny(const char*c){throw Failure{c};}
bool Target::operator==(const Target&o)const{return version==o.version&&service==o.service&&kind==o.kind&&intent_id==o.intent_id&&merchant==o.merchant&&invoice_id==o.invoice_id&&request_path==o.request_path;}
bool Binding::operator==(const Binding&o)const{return network_id==o.network_id&&account==o.account&&hash==o.hash&&member_hash==o.member_hash&&operation_id==o.operation_id&&target==o.target;}
static bool match(const std::string&s,const char*p){return std::regex_match(s,std::regex(p));}
std::string hash_original(const std::vector<uint8_t>&bytes){unsigned char out[32];
#ifdef __APPLE__
 CC_SHA256(bytes.data(),static_cast<CC_LONG>(bytes.size()),out);
#else
 SHA256(bytes.data(),bytes.size(),out);
#endif
 static constexpr char hex[]="0123456789abcdef";std::string value="0x";for(auto b:out){value+=hex[b>>4];value+=hex[b&15];}return value;}
std::string method(Operation op){return op==Operation::get_intent||op==Operation::get_invoice?"GET":"POST";}
std::string path(Operation op,const Target&t){
 if(op==Operation::get_intent||op==Operation::post_terms){if(t.kind!=Kind::terms||!t.intent_id)deny("PAY_NATIVE_TARGET_KIND");return "/v5/pay/invoice-intents/"+*t.intent_id+(op==Operation::post_terms?"/merchant-member":"");}
 if(t.kind==Kind::terms||!t.merchant||!t.invoice_id)deny("PAY_NATIVE_TARGET_KIND");
 const auto base="/v5/pay/invoices/"+*t.merchant+"/"+*t.invoice_id;
 if(op==Operation::get_invoice)return base;
 if(op==Operation::post_settlement&&t.kind==Kind::settlement)return base+"/settlements";
 if(op==Operation::post_refund&&t.kind==Kind::refund)return base+"/refunds";
 deny("PAY_NATIVE_TARGET_KIND");return {};
}
void validate_binding(const Binding&b){
 if(!match(b.network_id,"[a-f0-9]{64}")||!match(b.account,"0x[a-f0-9]{40}")||!match(b.hash,"0x[a-f0-9]{64}")||!match(b.member_hash,"0x[a-f0-9]{64}")||b.operation_id.empty()||b.operation_id.size()>128)deny("PAY_NATIVE_ORIGINAL_BINDING");
 for(const auto c:b.operation_id)if(static_cast<unsigned char>(c)<32||c==127)deny("PAY_NATIVE_OPERATION_ID");
 const auto&t=b.target;if(t.version!=1||t.service!="pay")deny("PAY_NATIVE_TARGET_VERSION");
 if(t.kind!=Kind::terms&&t.kind!=Kind::settlement&&t.kind!=Kind::refund)deny("PAY_NATIVE_TARGET_KIND");
 if(!t.merchant||!match(*t.merchant,"0x[a-f0-9]{40}")||!t.invoice_id||!match(*t.invoice_id,"[a-z0-9][a-z0-9._:-]{0,63}"))deny("PAY_NATIVE_TARGET_INVOICE");
 if(t.kind==Kind::terms){if(!t.intent_id||!match(*t.intent_id,"npi_[a-f0-9]{48}")||*t.merchant!=b.account)deny("PAY_NATIVE_TARGET_TERMS");}
 else if(t.intent_id||(t.kind==Kind::refund&&*t.merchant!=b.account))deny("PAY_NATIVE_TARGET_INVOICE");
 const auto op=t.kind==Kind::terms?Operation::post_terms:t.kind==Kind::settlement?Operation::post_settlement:Operation::post_refund;
 if(t.request_path!=path(op,t))deny("PAY_NATIVE_TARGET_PATH");
}
Owner::Owner(Binding b,bool query):selected_(std::move(b)),query_(query){}
Owner::~Owner(){
 // GC/finalization is not a Join/Close retry and must never release an actual
 // Source fence underneath a still-draining/UNKNOWN transport child. The
 // explicit caller owns normal cleanup. Preserve undrained original custody
 // for process lifetime rather than running a destructor that frees its ctx.
 try{retire();}catch(...){}
 if(loan_&&(!close_attempted_||close_first_||!joined_||in_flight_||loan_->cleanup_debt_retained())){
  struct Debt {std::mutex mutex;std::vector<std::unique_ptr<ProtectedLoan>>held;};
  static auto*debt=new Debt;
  std::lock_guard<std::mutex>lock(debt->mutex);debt->held.push_back(std::move(loan_));
 }
}
void Owner::remember_locked(const Failure&f){if(!first_)first_=f;}
void Owner::fail(std::string c){std::lock_guard<std::mutex>g(mutex_);remember_locked(Failure{std::move(c)});}
void Owner::adopt(std::unique_ptr<ProtectedLoan>p){std::lock_guard<std::mutex>g(mutex_);if(loan_)deny("PAY_NATIVE_ALREADY_ADOPTED");loan_=std::move(p);}
void Owner::check_locked(){if(first_)throw *first_;if(retired_||close_selected_||!ready_||!loan_)deny("PAY_NATIVE_NOT_CURRENT");loan_->current();if(!(loan_->read_original()==selected_)||loan_->query_only()!=query_)deny("PAY_NATIVE_ORIGINAL_CHANGED");}
void Owner::initialize(){std::lock_guard<std::mutex>g(mutex_);try{validate_binding(selected_);if(!loan_)deny("PAY_NATIVE_PROTECTED_PRODUCER_NOT_SUPPLIED");if(!(loan_->read_original()==selected_)||loan_->query_only()!=query_)deny("PAY_NATIVE_ORIGINAL_MISMATCH");const auto purpose=query_?ProtectedPurpose::pay_query:selected_.target.kind==Kind::terms?ProtectedPurpose::invoice_terms:selected_.target.kind==Kind::settlement?ProtectedPurpose::invoice_settlement:ProtectedPurpose::invoice_refund;if(loan_->protected_purpose()!=purpose)deny("PAY_NATIVE_PROTECTED_PURPOSE");member_=loan_->read_original_member();auto envelope=loan_->read_original_envelope();if(member_.empty()||member_.size()>98304||envelope.empty()||envelope.size()>196608)deny("PAY_NATIVE_ORIGINAL_MEMBER_BOUNDS");if(hash_original(member_)!=selected_.member_hash||hash_original(envelope)!=selected_.hash)deny("PAY_NATIVE_ORIGINAL_HASH");ready_=true;check_locked();}catch(const Failure&f){remember_locked(f);throw;}catch(...){remember_locked(Failure{"PAY_NATIVE_INITIALIZE_EXCEPTION"});throw *first_;}}
void Owner::current(){std::lock_guard<std::mutex>g(mutex_);try{check_locked();}catch(const Failure&f){remember_locked(f);throw;}catch(...){remember_locked(Failure{"PAY_NATIVE_CURRENT_EXCEPTION"});throw *first_;}}
Binding Owner::read_original(){current();std::lock_guard<std::mutex>g(mutex_);return selected_;}
void Owner::recheck(){std::lock_guard<std::mutex>g(mutex_);try{check_locked();loan_->recheck();check_locked();}catch(const Failure&f){remember_locked(f);throw;}catch(...){remember_locked(Failure{"PAY_NATIVE_RECHECK_EXCEPTION"});throw *first_;}}
Packet Owner::packet(Operation op,const Target&target,const std::vector<uint8_t>&member){
 std::unique_lock<std::mutex>g(mutex_);std::string expected;
 try{check_locked();if(!(target==selected_.target))deny("PAY_NATIVE_TARGET_CHANGED");const bool effect=method(op)=="POST";if(effect&&(query_||attempted_))deny("PAY_NATIVE_ORIGINAL_QUERY_ONLY");if(effect&&member!=member_)deny("PAY_NATIVE_MEMBER_CHANGED");if(!effect&&!member.empty())deny("PAY_NATIVE_QUERY_MEMBER");expected=path(op,target);if(in_flight_)deny("PAY_NATIVE_OPERATION_IN_FLIGHT");if(effect)attempted_=true;in_flight_++;}
 catch(const Failure&f){remember_locked(f);throw;}
 auto*loan=loan_.get();g.unlock();Exchange raw;
 try{raw=loan->exchange(op);}catch(const Failure&f){raw.error=f;}catch(...){raw.error=Failure{"PAY_NATIVE_EXCHANGE_EXCEPTION"};}
 g.lock();in_flight_--;changed_.notify_all();const bool supplied=raw.packet.has_value();if(raw.packet)packet_=std::move(raw.packet);if(raw.error)remember_locked(*raw.error);
 if(supplied){if(packet_->method!=method(op)||packet_->request_path!=expected||packet_->status<100||packet_->status>599||packet_->body.size()>2097152){remember_locked(Failure{"PAY_NATIVE_PACKET_BINDING"});throw *first_;}
 // Return retained DATA before any late current/transport error is exposed.
 // Main must journal this packet first; assertCurrent then reports first cause.
 return *packet_;}if(first_)throw *first_;remember_locked(Failure{"PAY_NATIVE_PACKET_NOT_SUPPLIED"});throw *first_;
}
void Owner::retire(){std::lock_guard<std::mutex>g(mutex_);if(retired_)return;retired_=true;if(loan_)try{loan_->retire();}catch(const Failure&f){remember_locked(f);throw;}catch(...){remember_locked(Failure{"PAY_NATIVE_RETIRE_EXCEPTION"});throw *first_;}}
void Owner::join(){std::unique_lock<std::mutex>g(mutex_);if(!retired_)deny("PAY_NATIVE_RETIRE_REQUIRED");if(joined_)return;changed_.wait(g,[this]{return in_flight_==0;});if(loan_)loan_->join();joined_=true;}
void Owner::close(){std::lock_guard<std::mutex>g(mutex_);if(close_selected_){if(close_first_)throw *close_first_;return;}close_selected_=true;if(!retired_||!joined_||in_flight_){close_first_=Failure{"PAY_NATIVE_CHILDREN_RETAINED"};throw *close_first_;}close_attempted_=true;try{if(loan_)loan_->close();member_.clear();}catch(const Failure&f){close_first_=f;throw;}catch(...){close_first_=Failure{"PAY_NATIVE_CLOSE_EXCEPTION"};throw *close_first_;}}
void Owner::drain_partial(){std::lock_guard<std::mutex>g(mutex_);if(!close_selected_||!retired_||!joined_||in_flight_)deny("PAY_NATIVE_DRAIN_NOT_READY");if(!close_attempted_){close_attempted_=true;try{if(loan_)loan_->close();member_.clear();}catch(const Failure&f){if(!close_first_)close_first_=f;}catch(...){if(!close_first_)close_first_=Failure{"PAY_NATIVE_CLOSE_EXCEPTION"};}}if(close_first_)throw *close_first_;}
std::optional<Packet>Owner::retained_packet()const{std::lock_guard<std::mutex>g(mutex_);return packet_;}
std::optional<Failure>Owner::first_failure()const{std::lock_guard<std::mutex>g(mutex_);return first_;}
}
