#include "pay_native_channel_private.hpp"
#include "pay_native_source_lease_private.hpp"
#include "private_client_v1.h"
#include <atomic>
#include <cassert>
#include <iostream>

// PUBLIC fixture executable only. Real C++ Auth/P06 -> Go -> private Unix
// transport, with substituted Root/current scope. No Member crypto, actual
// Main approval, Source admission, keys, funds or finality is asserted.
extern "C" ynx_link_private_client_registration_borrow_v1*ynx_link_private_fixture_borrow_v1(uint32_t);
extern "C" int32_t ynx_link_private_fixture_finish_v1();
using namespace ynx::wallet::pay;
namespace {
const std::vector<uint8_t>member={0,255,128,1,2};
std::atomic<unsigned>root_closed{0};
Binding binding(Kind kind){
 Target t;t.kind=kind;t.merchant="0x"+std::string(40,'2');t.invoice_id="original-invoice";
 if(kind==Kind::terms)t.intent_id="npi_"+std::string(48,'a');
 const auto op=kind==Kind::terms?Operation::post_terms:kind==Kind::settlement?Operation::post_settlement:Operation::post_refund;
 t.request_path=path(op,t);
 return {std::string(64,'a'),kind==Kind::settlement?"0x"+std::string(40,'1'):*t.merchant,
  "0x"+std::string(64,'3'),hash_original(member),"PUBLIC-original-operation",t};
}
class PublicRoot final:public OriginalRootSource {
 Binding binding_;bool query_;
public:
 PublicRoot(Binding b,bool query):binding_(std::move(b)),query_(query){}
 ~PublicRoot()override{root_closed++;}
 int32_t current_native()noexcept override{return 0;}
 bool matches_original_binding(const Binding&b,bool query)noexcept override{return b==binding_&&query==query_;}
};
struct Session {
 Binding original;bool query;
 std::shared_ptr<PublicRoot>root;
 std::shared_ptr<MainNativeEpoch>epoch;
 ynx_wallet_pay_source_lease_v1*source=nullptr;
 std::unique_ptr<QualifiedPayChannel>channel;
 Session(Kind kind,bool q,uint32_t mode):original(binding(kind)),query(q),root(std::make_shared<PublicRoot>(original,q)),epoch(std::make_shared<MainNativeEpoch>()){
  auto*borrow=ynx_link_private_fixture_borrow_v1(mode);assert(borrow);
  const auto status=borrow_original_pay_source_lease(root,epoch,borrow,original,query,&source);
  if(!source)assert(ynx_link_private_client_registration_borrow_release_v1(borrow)==0);
  assert(status==0&&source);
  ynx_wallet_capture_original_pay_channel_v1(&original,query,source,&channel);assert(channel);
 }
 void close(){
  if(channel){channel->retire();channel->join();channel->close();channel.reset();}
  if(source){ynx_wallet_pay_source_lease_drop_v1(source);source=nullptr;}
  root.reset();epoch.reset();
 }
 ~Session(){try{close();}catch(...){std::cerr<<"PUBLIC cleanup debt retained\n";}}
};
void original_packet(const Exchange&result,Operation op,const Binding&b){
 assert(result.packet&&!result.error);const auto&p=*result.packet;
 assert(p.method==method(op)&&p.request_path==path(op,b.target)&&p.status==200);
 assert(p.content_type=="application/json"&&p.cache_control=="no-store");
 assert(std::string(p.body.begin(),p.body.end())=="{\"PUBLIC\":\"original packet\"}");
}
template<class F>void refuses(F f){bool denied=false;try{f();}catch(const Failure&){denied=true;}assert(denied);}
}
int main(){try{
 unsigned packets=0;
 for(auto kind:{Kind::terms,Kind::settlement,Kind::refund}){
  const auto post=kind==Kind::terms?Operation::post_terms:kind==Kind::settlement?Operation::post_settlement:Operation::post_refund;
  const auto get=kind==Kind::terms?Operation::get_intent:Operation::get_invoice;
  Session s(kind,false,kind==Kind::terms?0:3);
  original_packet(s.channel->exchange(post,s.original,member),post,s.original);packets++;
  refuses([&]{s.channel->exchange(post,s.original,member);});
  original_packet(s.channel->exchange(get,s.original,{}),get,s.original);packets++;
  s.close();
  Session query(kind,true,kind==Kind::terms?0:3);
  refuses([&]{query.channel->exchange(post,query.original,member);});
  original_packet(query.channel->exchange(get,query.original,{}),get,query.original);packets++;
  query.close();
 }
 {
  Session s(Kind::terms,false,1);
  const auto raw=s.channel->exchange(Operation::post_terms,s.original,member);
  assert(raw.packet&&raw.error&&raw.packet->method=="POST"&&raw.packet->request_path==s.original.target.request_path);
  assert(raw.packet->status==200&&std::string(raw.packet->body.begin(),raw.packet->body.end())=="abc");packets++;
  assert(raw.error->code.find("unexpected EOF")!=std::string::npos);
  refuses([&]{s.channel->current();});
  refuses([&]{s.channel->exchange(Operation::post_terms,s.original,member);});
  s.close();
 }
 {
  Session s(Kind::terms,false,0);auto changed=s.original;changed.operation_id="PUBLIC-changed-operation";
  std::unique_ptr<QualifiedPayChannel>out;
  refuses([&]{ynx_wallet_capture_original_pay_channel_v1(&changed,false,s.source,&out);});assert(!out);
  s.epoch->retire();refuses([&]{s.channel->exchange(Operation::post_terms,s.original,member);});s.close();
 }
 {
  const auto before=root_closed.load();Session s(Kind::terms,false,0);
  ynx_wallet_pay_source_lease_drop_v1(s.source);s.source=nullptr;s.root.reset();s.epoch.reset();
  assert(root_closed.load()==before); // actual C child retains Auth Source.
  assert(ynx_link_private_fixture_finish_v1()==YNX_LINK_PRIVATE_DRAINING_V1);
  s.close();assert(root_closed.load()==before+1);
  assert(ynx_link_private_fixture_finish_v1()==0);
 }
 {
  auto*borrow=ynx_link_private_fixture_borrow_v1(0);assert(borrow);
  ynx_wallet_pay_source_lease_v1*out=nullptr;
  const auto status=borrow_original_pay_source_lease(nullptr,std::make_shared<MainNativeEpoch>(),borrow,binding(Kind::terms),false,&out);
  assert(status==YNX_PAY_SOURCE_ROOT_PRODUCER_NOT_SUPPLIED&&!out);
  assert(ynx_link_private_client_registration_borrow_release_v1(borrow)==0);
  assert(ynx_link_private_fixture_finish_v1()==0);
 }
 std::cout<<"{\"passed\":true,\"actualUnixPackets\":"<<packets<<",\"threePostsTwoGets\":true,\"queryPostRefused\":true,\"latePartialPreserved\":true,\"sameBindingAndNativeRetirement\":true,\"actualRegistrationBorrowDebt\":true,\"RootMissingRefused\":true,\"RootAdmission\":false,\"SourceAdmission\":false,\"actualMainApproval\":false,\"realFunds\":false}\n";
 return 0;
}catch(const Failure&e){std::cerr<<e.code<<"\n";return 1;}catch(const std::exception&e){std::cerr<<e.what()<<"\n";return 1;}}
