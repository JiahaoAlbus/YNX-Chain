#pragma once
#ifndef YNX_ANDROID_PENDING_PAIR_ABORT_PUBLIC_CONTROLS
#error "PUBLIC finite Source/approval edge only, never production authority"
#endif
#include <PendingMainCalleePrivate.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>
using F=ynx_auth_android_provision_failure_v1;using D=ynx_auth_android_provision_drain_v1;using Source=ynx_auth_android_pending_source_v1;
namespace {
int sourceObject=1;Source*source=reinterpret_cast<Source*>(&sourceObject);
bool sourceLate0=false,approvalLate0=false,revoked=false;int authCalls=0,approvalCalls=0;std::string sourceID="actual-PUBLIC-source";
F fail(int32_t code=0,int64_t platform=41){return{1,code,0x5055424c,platform};}F invalid(){return fail(2);}
void review(uint8_t*b,size_t n,ynx_auth_android_pending_review_data_v1*out){
 using Span=ynx_auth_android_provision_bytes_v1;ynx_auth_android_pending_review_data_v1 v{};v.version=1;v.size=sizeof(v);v.kind=1;v.null_mask=1;v.not_before_ms=1;v.expires_at_ms=9999999;
 size_t at=0;auto put=[&](const std::string&s)->Span{if(at+s.size()>n)std::abort();auto*p=b+at;if(!s.empty())std::memcpy(p,s.data(),s.size());at+=s.size();return{p,s.size()};};
 v.scope_original=put("PUBLIC verified scope only");v.registration_original=put("PUBLIC registration");v.request_original=put("PUBLIC original request");v.challenge_original=put("");v.pending_id=put(std::string(64,'1'));v.registration_digest=put(std::string(64,'2'));v.request_digest=put("");v.approval_digest=put(std::string(64,'3'));
 v.source_id=put(sourceID);v.instance_id=put("actual-instance");v.source_generation=put("1");v.stable_device_identity=put("");v.device_generation=put("2");v.account=put("ynx:PUBLIC-account");v.product_id=put("social");v.client_id=put("native");v.application_id=put("com.ynx.social");v.bundle_id={};v.package_id=put("com.ynx.social");v.origin=put("");v.callback=put("ynx://callback");v.device_id=put("device");v.network[0]=1;v.canonical_owner[0]='0';v.canonical_owner[1]='x';std::memset(v.canonical_owner+2,'a',40);v.device_pk_a[0]=1;v.device_pk_b[0]=2;*out=v;
}
}
extern "C" void ynx_auth_android_pending_source_current_v1(Source*p,F*f){++authCalls;*f=p!=source?invalid():(revoked||sourceLate0?fail():F{});}
extern "C" void ynx_auth_android_pending_source_copy_review_v1(Source*p,uint8_t*b,size_t n,ynx_auth_android_pending_review_data_v1*out,F*f){++authCalls;if(p!=source){*f=invalid();return;}review(b,n,out);*f=revoked?fail():F{};}
extern "C" void ynx_auth_android_pending_source_copy_user_approval_v1(Source*p,uint8_t*b,size_t n,ynx_auth_android_provision_bytes_v1*a,ynx_auth_android_provision_bytes_v1*policy,F*f){++approvalCalls;if(p!=source||n<15){*f=invalid();return;}std::memcpy(b,"approval-policy",15);*a={b,8};*policy={b+8,7};*f=approvalLate0?fail():F{};}
#define CHECK(x) do{if(!(x)){std::fprintf(stderr,"CHECK line%d: %s\n",__LINE__,#x);return 1;}}while(false)
