// PUBLIC structural control only: no keys, Source, mathematics or HTTP.
#include "original-product-device-v5-http-call.h"
#include <cassert>
#include <iostream>
#include <memory>
using namespace ynx_auth_private;
static unsigned calls=0;static std::string mode;
extern "C" int32_t YNXProductSessionHTTPProofSignV5(YNXProductSessionHTTPRequestV5*r,uint8_t*out,size_t cap,size_t*length,uint32_t*cleanup){
 ++calls;assert(r&&out&&length&&cleanup);assert(cap==98304);out[0]=7;out[1]=8;out[2]=9;*length=3;*cleanup=2;
 if(mode=="throw"){*length=2;*cleanup=3;throw 17;}
 if(mode=="oversize"){*length=cap+17;return -123;}
 if(mode=="max-member"){std::fill(out,out+cap,42);*length=cap;return 0;}
 if(mode=="negative-rc")return -42;if(mode=="bad-cleanup"){*cleanup=UINT32_MAX;return 0;}if(mode=="zero"){*length=0;return 0;}return 0;
}
#include "product-device-v5-public-data.h"
int main(int argc,char**argv){assert(argc==2);const std::string scenario=argv[1];PUBLICFixture f;
 if(scenario=="span-bounds"){
  for(const auto which:{0,1,2,3}){auto reg=bytes(f.registration),u=bytes(f.original),b=bytes(f.body),c=bytes(f.ctype);if(which==0)reg.length=16385;if(which==1)u.length=16385;if(which==2)b.length=68288513;if(which==3)c.length=100;refused([&]{ProductDeviceV5Once x(f.journal,f.binding,reg,u,b,c);});}assert(calls==0);
 }else if(scenario=="constructor-bounds"){
  auto b=f.binding;b.nonce="short";refused([&]{ProductDeviceV5Once x(f.journal,b,bytes(f.registration),bytes(f.original),bytes(f.body),bytes(f.ctype));});
  b=f.binding;b.registration.fill(8);refused([&]{ProductDeviceV5Once x(f.journal,b,bytes(f.registration),bytes(f.original),bytes(f.body),bytes(f.ctype));});
  b=f.binding;b.canonicalOwner[3]='A';refused([&]{ProductDeviceV5Once x(f.journal,b,bytes(f.registration),bytes(f.original),bytes(f.body),bytes(f.ctype));});
  f.ctype="multipart/form-data; boundary=bad space";refused([&]{f.make();});f.ctype="multipart/form-data; boundary="+std::string(71,'x');refused([&]{f.make();});assert(calls==0);
 }else if(scenario=="thread"){
  auto once=f.make();once->reserve();bool rejected=false;std::thread worker([&]{try{once->selectPrimitiveEntry();}catch(...){rejected=true;}});worker.join();assert(rejected);auto r=f.request();const auto out=invokeOriginalProductDeviceV5HTTPBorrow(*once,r);assert(out.mathCompleted&&calls==1);
 }else if(scenario=="no-reserve"){
  auto once=f.make();auto r=f.request();refused([&]{invokeOriginalProductDeviceV5HTTPBorrow(*once,r);});assert(calls==0);
 }else if(scenario.rfind("reserve-",0)==0){
  auto once=f.make();f.journal.fault=scenario.substr(8);refused([&]{once->reserve();});f.journal.fault.clear();refused([&]{once->reserve();});refused([&]{once->selectPrimitiveEntry();});assert(calls==0);
  if(!f.journal.records.empty()){auto cold=f.make();refused([&]{cold->reserve();});refused([&]{cold->selectPrimitiveEntry();});}
 }else if(scenario.rfind("collision-",0)==0){
  auto once=f.make();once->reserve();const auto key=once->recordKeyDATA();const auto before=f.journal.records;
  if(scenario=="collision-body")f.body[0]^=1;else if(scenario=="collision-ctype")f.ctype+="x";else if(scenario=="collision-original")f.original+=" ";else if(scenario=="collision-pair")f.binding.pkA[0]^=1;else if(scenario=="collision-owner")f.binding.canonicalOwner[3]='2';
  auto other=f.make();assert(other->recordKeyDATA()==key);refused([&]{other->reserve();});refused([&]{other->selectPrimitiveEntry();});assert(f.journal.records==before&&calls==0);
 }else if(scenario=="domain-identity"){
  auto one=f.make();const auto key=one->recordKeyDATA();f.binding.nonce[0]='O';assert(f.make()->recordKeyDATA()!=key);f.binding.nonce[0]='N';f.binding.network[0]++;assert(f.make()->recordKeyDATA()!=key);f.binding.network[0]--;f.binding.session[0]++;assert(f.make()->recordKeyDATA()!=key);
  one->reserve();const auto&raw=f.journal.records.at(key+".entered");assert(raw.rfind("YNX-PRODUCT-DEVICE-HTTP-ENTERED/v5",0)==0);assert(raw.find(f.original)!=std::string::npos);assert(raw.find(f.body)==std::string::npos);assert(raw.find("/v4")==std::string::npos);
 }else if(scenario=="large-body"){
  f.body.assign(YNX_PRODUCT_SESSION_HTTP_V5_BODY_MAX,'z');f.body[9]='\0';auto once=f.make();once->reserve();assert(f.journal.records.begin()->second.size()<24000);auto r=f.request();const auto out=invokeOriginalProductDeviceV5HTTPBorrow(*once,r);assert(out.mathCompleted&&calls==1);assert(f.journal.records.size()==2);
 }else if(scenario=="orphan"||scenario=="corrupt-terminal"){
  auto once=f.make();once->reserve();auto r=f.request();invokeOriginalProductDeviceV5HTTPBorrow(*once,r);const auto key=once->recordKeyDATA();if(scenario=="orphan")f.journal.records.erase(key+".entered");else f.journal.records[key+".terminal"].pop_back();auto cold=f.make();refused([&]{cold->reserve();});refused([&]{cold->selectPrimitiveEntry();});assert(calls==1);
 }else{
  auto once=f.make();once->reserve();auto r=f.request();const auto originalBody=f.body;std::string changed;std::array<uint8_t,2592>otherA{};otherA.fill(12);std::array<uint8_t,32>otherNet{};otherNet.fill(8);
  const bool local=scenario.rfind("changed-",0)==0;
  if(scenario=="changed-body")f.body[0]^=1;
  if(scenario=="changed-body-length")r.actual_body.length--;
  if(scenario=="changed-ctype"){changed=f.ctype+"x";r.actual_content_type=bytes(changed);}
  if(scenario=="changed-original"){changed=f.original;changed[1]^=1;r.unsigned_original=bytes(changed);}
  if(scenario=="changed-null-body")r.actual_body.bytes=nullptr;
  if(scenario=="changed-unsigned-length")r.unsigned_original.length--;
  if(scenario=="changed-network")r.expected.network_id={otherNet.data(),otherNet.size()};
  if(scenario=="changed-owner"){changed="0x"+std::string(40,'2');r.expected.owner=bytes(changed);}
  if(scenario=="changed-pair")r.expected.pk_a={otherA.data(),otherA.size()};
  if(scenario=="changed-pair-b")r.expected.pk_b={otherA.data(),64};
  if(scenario=="changed-borrow-pair")r.pk_a={otherA.data(),otherA.size()};
  if(scenario=="changed-layout")r.struct_size--;
  if(scenario=="changed-version")r.version=4;
  if(scenario=="relocated-equal-body"){changed=f.body;r.actual_body=bytes(changed);}
  if(scenario.rfind("terminal-",0)==0)f.journal.fault=scenario.substr(9);
  mode=scenario;if(scenario=="dual-failure"||scenario=="dual-readback"){mode="throw";f.journal.fault=scenario=="dual-failure"?"before-terminal":"read-terminal";}const auto out=invokeOriginalProductDeviceV5HTTPBorrow(*once,r);assert(!out.authorized&&!out.usableHTTP);assert(calls==(local?0u:1u));assert(out.primitiveCalled==!local);
  if(local){assert(!out.mathCompleted&&out.member.empty());assert(out.result==YNX_HTTP_V5_INTERNAL&&out.cleanup==0&&out.reportedLength==0);}
  else if(scenario=="oversize"){assert(out.member.size()==98304&&out.reportedLength==98321&&out.result==-123&&!out.mathCompleted);assert(out.member[0]==7);}
  else if(scenario=="dual-failure"||scenario=="dual-readback"){assert(out.member.size()==2&&out.primitiveFailure&&out.persistenceFailure&&out.cleanup==3&&!out.mathCompleted);bool original=false;try{std::rethrow_exception(out.persistenceFailure);}catch(const std::exception&e){original=std::string(e.what())==(scenario=="dual-failure"?"PUBLIC_BEFORE_WRITE":"DEVICE_V5_ONCE_TERMINAL_READBACK");}assert(original);}
  else if(scenario=="throw"){assert(out.member.size()==2&&out.primitiveFailure&&out.cleanup==3&&!out.mathCompleted);}
  else if(scenario=="negative-rc"){assert(out.result==-42&&out.member.size()==3&&!out.mathCompleted);}
  else if(scenario=="bad-cleanup"){assert(out.cleanup==UINT32_MAX&&out.member.size()==3&&!out.mathCompleted);}
  else if(scenario=="zero")assert(out.member.empty()&&!out.mathCompleted);
  else if(scenario.rfind("terminal-",0)==0){assert(out.member.size()==3&&out.persistenceFailure&&!out.mathCompleted);}
  else assert(out.mathCompleted&&out.member.size()==(scenario=="max-member"?98304:3));
  assert(once->copyRetainedOutcomeDATA()==out.member);assert(once->reportedLengthDATA()==out.reportedLength);assert(once->resultDATA()==out.result);assert(once->cleanupDATA()==out.cleanup);
  refused([&]{invokeOriginalProductDeviceV5HTTPBorrow(*once,r);});f.journal.fault.clear();f.body=originalBody;auto cold=f.make();refused([&]{cold->reserve();});refused([&]{cold->selectPrimitiveEntry();});
  if(out.terminalRecorded||scenario=="terminal-ack-terminal"||scenario=="terminal-read-terminal"){assert(cold->recoveredDATA());assert(cold->copyRetainedOutcomeDATA()==out.member);assert(cold->reportedLengthDATA()==out.reportedLength);assert(cold->resultDATA()==out.result);assert(cold->cleanupDATA()==out.cleanup);}
  assert(calls==(local?0u:1u));
 }
 std::cout<<"PUBLIC_V5_"<<scenario<<"_PASS\n";
}
