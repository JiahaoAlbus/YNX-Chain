#include "pay_native_requests.hpp"
#include <cassert>
#include <iostream>

using namespace ynx::wallet::pay;
using namespace ynx::wallet::pay::producer;
namespace {
// PUBLIC bytes test framing/binding only, never Member crypto or Source grant.
const std::vector<uint8_t> member={0,255,128,1,2};
Binding original(Kind kind){
 Target t;t.kind=kind;t.merchant="0x"+std::string(40,'2');t.invoice_id="original-invoice";
 if(kind==Kind::terms)t.intent_id="npi_"+std::string(48,'a');
 const auto op=kind==Kind::terms?Operation::post_terms:kind==Kind::settlement?Operation::post_settlement:Operation::post_refund;
 t.request_path=path(op,t);
 return {std::string(64,'a'),kind==Kind::settlement?"0x"+std::string(40,'1'):*t.merchant,"0x"+std::string(64,'3'),hash_original(member),"PUBLIC-original-operation",t};
}
template<class F>void rejects(const char*code,F f){
 try{f();assert(false);}catch(const Failure&e){assert(e.code==code);}
}
}
int main(){
 for(const auto kind:{Kind::terms,Kind::settlement,Kind::refund}){
  const auto b=original(kind);
  const auto op=kind==Kind::terms?Operation::post_terms:kind==Kind::settlement?Operation::post_settlement:Operation::post_refund;
  const auto req=original_request(op,b,false,member);
  assert(req.method=="POST"&&req.path==b.target.request_path&&req.content_type=="application/json");
  assert(std::string(req.body.begin(),req.body.end())=="{\"member\":\"AP+AAQI=\"}");
  rejects("PAY_NATIVE_ORIGINAL_QUERY_ONLY",[&]{original_request(op,b,true,member);});
  rejects("PAY_NATIVE_MEMBER_CHANGED",[&]{original_request(op,b,false,{1,2,3});});
  const auto read=kind==Kind::terms?Operation::get_intent:Operation::get_invoice;
  for(bool query:{false,true}){
   const auto constraints=original_route_constraints(b,query);
   assert(constraints.size()==(query?1:2));
   assert(constraints.back().operation==read&&constraints.back().method=="GET"&&constraints.back().path==path(read,b.target)&&constraints.back().content_type.empty());
   if(!query)assert(constraints.front().operation==op&&constraints.front().method=="POST"&&constraints.front().path==b.target.request_path&&constraints.front().content_type=="application/json");
   const auto req=original_request(read,b,query,{});
   assert(req.method=="GET"&&req.path==path(read,b.target)&&req.content_type.empty()&&req.body.empty());
  }
  rejects("PAY_NATIVE_QUERY_MEMBER",[&]{original_request(read,b,true,member);});
 }
 auto b=original(Kind::settlement);
 rejects("PAY_NATIVE_TARGET_KIND",[&]{original_request(Operation::post_refund,b,false,member);});
 rejects("PAY_NATIVE_OPERATION_INVALID",[&]{original_request(static_cast<Operation>(99),b,false,member);});
 rejects("PAY_NATIVE_ORIGINAL_MEMBER_BOUNDS",[&]{original_request(Operation::post_settlement,b,false,{});});
 rejects("PAY_NATIVE_ORIGINAL_MEMBER_BOUNDS",[&]{original_request(Operation::post_settlement,b,false,std::vector<uint8_t>(98305));});
 for(size_t size:{size_t(1),size_t(2),size_t(3),size_t(98304)}){
  std::vector<uint8_t> bytes(size,0xff);b.member_hash=hash_original(bytes);
  const auto req=original_request(Operation::post_settlement,b,false,bytes);
  assert(req.body.size()==13+4*((size+2)/3));
 }
 b.target.request_path+="?override=1";
 rejects("PAY_NATIVE_TARGET_PATH",[&]{original_request(Operation::post_settlement,b,false,member);});
 std::cout<<"PASS fixed5 original framing, query prohibition, wrong-kind/hash/path, 98304-byte bounds; PUBLIC DATA only\n";
}
