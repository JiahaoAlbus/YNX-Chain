#pragma once
#include "resource_current_client_v2.h"
#include "resource_current_auth_v2.h"
#include <cstdint>
#include <vector>
#include <thread>
#include <cstring>

// Private Native-only transport custody. Its profile/fence MUST originate from
// the actual qualified inventory. This class does not mint Source permission.
// Keep it in that inventory on debt; its destructor deliberately does no IO.
namespace ynx::auth::network_publisher {
class ReaderV2 final {
 ynx_link_resource_current_client_v2* client_=nullptr;
 const ynx_link_resource_current_packet_v2* packet_=nullptr;
 bool attempted_=false,retired_=false,freed_=false,releaseAmbiguous_=false;
 int32_t first_=0;
 int32_t nativeFirst_=0;
 std::vector<uint8_t> lastBody_;
 const std::thread::id thread_=std::this_thread::get_id();
 int32_t remember(int32_t rc){if(rc&&!first_)first_=rc;return rc;}
 bool actor()const{return std::this_thread::get_id()==thread_;}
 // Only Join/Close use this status classifier. LINK's DRAINING is known
 // local ACK ownership/pending progress, NOT a sticky operation failure.
 // Independently ask the SAME client for true firstcause and UNKNOWN; never
 // globally ignore numeric 5 or infer completion from a returned ACK alone.
 int32_t lifecycleStatus(int32_t rc,const char*operation){
  if(rc!=YNX_LINK_RESOURCE_CURRENT_DRAINING_V1)return remember(rc);
  int32_t native=0,system=0;
  const int32_t first=ynx_link_resource_current_first_error_v2(client_,&native,&system);
  if(first)return remember(first);
  ynx_link_resource_current_lifetime_v2 life{};
  const int32_t observed=ynx_link_resource_current_get_lifetime_v2(client_,&life);
  if(observed)return remember(observed);
  if(life.remote_unknown)return remember(YNX_LINK_RESOURCE_CURRENT_REMOTE_UNKNOWN_V2);
  if(packet_&&(!packet_->operation||std::strcmp(packet_->operation,operation)||
    !packet_->transport.body_complete||packet_->transport.status_code!=200||
    packet_->transport.error_code||packet_->lifetime.remote_unknown))
   return remember(YNX_LINK_RESOURCE_CURRENT_PROTOCOL_V1);
  return rc; // caller drops its packet BEFORE cached/local completion probes.
 }

 int32_t adopt(const ynx_link_resource_current_packet_v2*p){
  if(!p)return 0;
  // Calls are serialized and never made while an earlier packet is retained.
  if(packet_)return remember(YNX_LINK_RESOURCE_CURRENT_PROTOCOL_V1);
  packet_=p; // OWN before inspecting operation status, lengths or payload.
  lastBody_.clear(); // Never expose a prior Current as the new failed packet.
  const auto&t=p->transport;
  if(t.body_size>16384||(!t.body&&t.body_size))return remember(YNX_LINK_RESOURCE_CURRENT_BOUNDS_V1);
  if(t.body_size)lastBody_.assign(t.body,t.body+t.body_size);
  return 0;
 }
 int32_t drop(){
  if(!packet_)return 0;
  if(releaseAmbiguous_)return first_?first_:YNX_LINK_RESOURCE_CURRENT_PROTOCOL_V1;
  if(!client_)return remember(YNX_LINK_RESOURCE_CURRENT_PROTOCOL_V1);
  const int32_t rc=ynx_link_resource_current_release_packet_v2(client_,packet_);
  if(!rc)packet_=nullptr;else releaseAmbiguous_=true;return remember(rc);
 }
public:
 ReaderV2()=default;
 ReaderV2(const ReaderV2&)=delete;
 ReaderV2&operator=(const ReaderV2&)=delete;
 int32_t openOriginal(YNXOriginalNetworkPublisherResourceRef*original){
  if(!actor())return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
  if(attempted_||!original)return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
  attempted_=true;
  ynx_link_resource_current_client_v2*c=nullptr;const ynx_link_resource_current_packet_v2*q=nullptr;int32_t native=0;
  const int32_t rc=ynx_link_resource_current_open_original_auth_v2(original,&c,&q,&native);
  client_=c;const int32_t adopted=adopt(q);nativeFirst_=native;remember(rc);
  if(!rc&&(!client_||!packet_))return remember(YNX_LINK_RESOURCE_CURRENT_PROTOCOL_V1);
  return rc?rc:adopted;
 }
 #ifdef YNX_AUTH_READER_PUBLIC_CONTROLS
 // Test-only transport seam. The production header exposes only actual Ref.
 int32_t open(const ynx_link_resource_current_profile_v2&p,const ynx_link_private_client_source_fence_v1&f){
  if(!actor())return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
  if(attempted_)return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
  attempted_=true;
  ynx_link_resource_current_client_v2*c=nullptr;const ynx_link_resource_current_packet_v2*q=nullptr;
  const int32_t rc=ynx_link_resource_current_open_v2(&p,&f,&c,&q);
  client_=c; // Adopt BOTH partial outputs before interpreting any failure.
  const int32_t adopted=adopt(q);remember(rc);
  if(!rc&&(!client_||!packet_))return remember(YNX_LINK_RESOURCE_CURRENT_PROTOCOL_V1);
  return rc?rc:adopted;
 }
 #endif
 // First Current is the packet acquired by Open; never send a replacement
 // resource_current before consuming it. Error prefixes remain lastBody DATA.
 int32_t copyCurrent(std::vector<uint8_t>&out){
  if(!actor()||retired_||freed_||first_)return first_?first_:YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
  if(!client_)return remember(YNX_LINK_RESOURCE_CURRENT_UNAVAILABLE_V1);
  int32_t rc=0;
  if(!packet_){lastBody_.clear();const ynx_link_resource_current_packet_v2*q=nullptr;rc=ynx_link_resource_current_read_v2(client_,&q);const int32_t a=adopt(q);remember(rc);if(!rc)rc=a;}
  out=lastBody_; // Preserve actual returned DATA even on a late failure.
  const bool valid=packet_&&packet_->transport.body_complete&&packet_->transport.valid_current_data&&packet_->transport.status_code==200&&!lastBody_.empty();
  const int32_t released=drop();
  if(rc)return rc;if(released)return released;
  return valid?0:remember(YNX_LINK_RESOURCE_CURRENT_PROTOCOL_V1);
 }
 int32_t currentLocal(){if(!actor()||!client_||retired_||freed_)return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;return ynx_link_resource_current_current_local_v2(client_);}
 int32_t retire(){
  if(!actor())return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
  if(retired_)return first_;retired_=true;
  if(!client_)return first_;
  int32_t rc=drop();if(rc)return rc;
  ynx_link_resource_current_lifetime_v2 life{};
  rc=ynx_link_resource_current_get_lifetime_v2(client_,&life);if(rc)return remember(rc);
  if(life.remote_unknown)return remember(YNX_LINK_RESOURCE_CURRENT_REMOTE_UNKNOWN_V2);
  const ynx_link_resource_current_packet_v2*q=nullptr;
  rc=ynx_link_resource_current_retire_v2(client_,&q);const int32_t a=adopt(q);remember(rc);
  const int32_t released=drop();return rc?rc:(a?a:released);
 }
 // One explicit Join query per caller invocation, then cached probes only.
 // Close's owned ACK must also be released before local physical completion.
 // A remote UNKNOWN keeps client/fence debt; local EOF alone cannot free it.
 int32_t drain(bool&completed){
  completed=false;if(!actor()||!retired_)return YNX_LINK_RESOURCE_CURRENT_DENIED_V1;
  if(freed_){completed=true;return first_;}
  if(!client_){completed=packet_==nullptr;return first_?first_:(completed?0:YNX_LINK_RESOURCE_CURRENT_PROTOCOL_V1);}
  int32_t rc=drop();if(rc)return rc;
  ynx_link_resource_current_lifetime_v2 life{};
  rc=ynx_link_resource_current_get_lifetime_v2(client_,&life);if(rc)return remember(rc);
  if(life.remote_unknown)return remember(YNX_LINK_RESOURCE_CURRENT_REMOTE_UNKNOWN_V2);
  uint8_t done=0;const ynx_link_resource_current_packet_v2*q=nullptr;
  rc=ynx_link_resource_current_join_v2(client_,10000,&done,&q);const int32_t a=adopt(q);lifecycleStatus(rc,"resource_current_join");
  if(drop())return first_;if(a)return a;
  // Sticky firstcause is not a claim of physical debt: independently probe.
  q=nullptr;uint8_t cached=0;
  const int32_t probe=ynx_link_resource_current_join_v2(client_,0,&cached,&q);const int32_t pa=adopt(q);lifecycleStatus(probe,"resource_current_join");
  if(drop())return first_;if(pa)return pa;
  if(!cached)return first_?first_:YNX_LINK_RESOURCE_CURRENT_DRAINING_V1;
  q=nullptr;done=0;rc=ynx_link_resource_current_close_v2(client_,&done,&q);const int32_t ca=adopt(q);lifecycleStatus(rc,"resource_current_close");
  if(drop())return first_;if(ca)return ca;
  life={};const int32_t observed=ynx_link_resource_current_get_lifetime_v2(client_,&life);
  if(observed)return remember(observed);
  if(life.remote_unknown)return remember(YNX_LINK_RESOURCE_CURRENT_REMOTE_UNKNOWN_V2);
  if(life.remote_acquisition_possible&&!life.remote_close_ack)return first_?first_:YNX_LINK_RESOURCE_CURRENT_DRAINING_V1;
  // A second Close is a cached/finalization probe, never a new Close request
  // after UNKNOWN. LINK owns that exact same-session state machine.
  q=nullptr;done=0;rc=ynx_link_resource_current_close_v2(client_,&done,&q);const int32_t fa=adopt(q);lifecycleStatus(rc,"resource_current_close");
  if(drop())return first_;if(fa)return fa;
  if(!done)return first_?first_:YNX_LINK_RESOURCE_CURRENT_DRAINING_V1;
  rc=ynx_link_resource_current_free_v2(client_);if(rc)return remember(rc);
  client_=nullptr;freed_=true;completed=true;return first_;
 }
 bool hasDebt()const{return client_||packet_;}
 int32_t firstError()const{return first_;}
 int32_t nativeFirstCause()const{return nativeFirst_;}
 const std::vector<uint8_t>&lastBody()const{return lastBody_;}
};
}
