// Auth-owned Source18 + provisional capture3. No SDK Source factory, caller
// root/JSON installer, Node process, creator, key, signing or OS write exists.
#include "CollectorPrivate.hpp"
#include "AndroidDeviceProvisioningCapturePrivate.h"
#include "AndroidDeviceProvisioningProjectionPrivate.h"
#include "AndroidDevicePublicGetPrivate.h"
#include "CaptureJSON.hpp"
#include "RootCaptureResource.hpp"
#include "RootFile.hpp"
#include "SourceNamespace.hpp"
#include "Inventory.hpp"
#include "Lifetime.hpp"
#include "ProjectionFacts.hpp"
#include "PolicyBinding.hpp"
#include "RootImageLease.hpp"
#ifdef YNX_AUTH_ANDROID_PENDING_REGISTRATION_SOURCE_STAGE
#include "AndroidDeviceRegistrationPortsPrivate.h"
#include "AndroidDevicePendingProjectionPrivate.h"
#include "PendingJournalConstraints.hpp"
#endif
#include <dlfcn.h>
#include <fstream>
#include <sstream>
#include <memory>
#include <vector>
#include <algorithm>
#include <cerrno>
#include <unistd.h>
#include <sys/random.h>
#if defined(__linux__)
#include <sys/syscall.h>
#endif
namespace ac=ynx::auth::android_capture;namespace ad=ynx::auth::android_device_provisioning;
namespace {
using F=ynx_auth_android_provision_failure_v1;using D=ynx_auth_android_provision_drain_v1;using B=ynx_auth_android_provision_bytes_v1;using Bytes=std::vector<uint8_t>;
F error(int code){return{1,code,0x524f4f54,0};}bool bad(F f){return f.present!=0;}
struct Captured{
 const ac::Resource*row=nullptr;std::vector<std::unique_ptr<ac::RootFile>>files;
 std::unique_ptr<ac::RootImageLease>image_lease;ac::FileResource module_resource{};
#ifdef YNX_AUTH_ANDROID_PENDING_REGISTRATION_SOURCE_STAGE
 ynx_auth_android_pending_review_data_v1 pending{};Bytes pending_storage;std::string pending_previous;
#endif
 ynx_auth_android_device_evaluator_v1*evaluator=nullptr;void*token=nullptr;
 ac::Batch batch;std::string canonical,previous,operation;std::array<std::string,19>value;
 ynx_auth_android_device_public_pair_v1 pair{};ad::Window clock;
 F first{};bool held=false,retired=false,closed=false,qualified=false,snapshot_set=false,ready=false,refreshing=false,eval_closed=false,close_unknown=false,outcome_unknown=false;
 unsigned borrowed=0,active=0;int64_t wall_anchor=0,mono_anchor=0,expiry=0,not_before=0;
 std::uint32_t kind=0;std::string retained_transport_url,retained_transport,retained_math;Bytes retained_projection;std::vector<ynx_auth_android_device_math_observation_v1>retained_observations;
 void keep(F f){if(f.present>1||(!f.present&&f.code))f=error(8);if(f.present&&!held){first=f;held=true;}}
};
ad::Inventory<Captured,16384>&captures(){static auto*p=new ad::Inventory<Captured,16384>;return*p;}
Captured*find(const void*p){return captures().find(const_cast<void*>(p));}
struct Borrow{Captured&c;explicit Borrow(Captured&x):c(x){++c.borrowed;++c.active;}~Borrow(){--c.active;--c.borrowed;}};
const char*purpose(uint32_t k){return ac::source_purpose(k);}
const ac::Resource*select(uint32_t kind,const std::array<uint8_t,32>*id=nullptr){std::size_t n=0;auto rows=ac::original_root_resources(n);const ac::Resource*chosen=nullptr;for(std::size_t i=0;i<n;++i){auto*r=rows[i];if(r&&r->kind==kind&&(!id||r->resource==*id)){if(chosen)throw 7;chosen=r;}}if(!chosen)throw 1;return chosen;}
bool bounded(const char*s,size_t n){return s&&*s&&std::strlen(s)<=n;}
std::array<uint8_t,32>hex32(const char*s){if(!s||std::strlen(s)!=64)throw 2;std::array<uint8_t,32>out{};for(unsigned i=0;i<64;++i){char c=s[i];unsigned x=c>='0'&&c<='9'?unsigned(c-'0'):c>='a'&&c<='f'?unsigned(c-'a'+10):16;if(x>15)throw 2;out[i/2]|=uint8_t(x<<(i%2?0:4));}return out;}
std::string random_nonce(){uint8_t raw[32]{};size_t at=0;
#if defined(__linux__)
 while(at<sizeof(raw)){auto n=::syscall(SYS_getrandom,raw+at,sizeof(raw)-at,0);if(n<0&&errno==EINTR)continue;if(n<=0)throw 3;at+=size_t(n);}
#else
 (void)at;if(::getentropy(raw,sizeof(raw)))throw 3;
#endif
 // Original Source challenge encoding only, not a DEVICE operation/nonce.
 constexpr char alphabet[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";std::string out;uint32_t bits=0;unsigned count=0;for(auto b:raw){bits=(bits<<8)|b;count+=8;while(count>=6){count-=6;out+=alphabet[(bits>>count)&63];}}if(count)out+=alphabet[(bits<<(6-count))&63];return out;
}
void module_current(const ac::Resource&r,const ac::FileResource&image){
#if defined(__linux__)
 Dl_info d{};auto address=reinterpret_cast<uintptr_t>(&ynx_original_android_provision_source_open_v1);if(!dladdr(reinterpret_cast<void*>(address),&d)||!d.dli_fname)throw 4;char path[PATH_MAX];if(!realpath(d.dli_fname,path)||std::strcmp(path,image.path))throw 4;std::ifstream in("/proc/self/maps");std::string line;bool mapped=false;while(std::getline(in,line)){unsigned long long a=0,b=0,offset=0,inode=0;char perm[5]{},dev[32]{};if(std::sscanf(line.c_str(),"%llx-%llx %4s %llx %31s %llu",&a,&b,perm,&offset,dev,&inode)==6&&address>=a&&address<b&&perm[2]=='x'&&inode==image.inode)mapped=true;}if(!mapped)throw 4;std::ifstream cmd("/proc/self/cmdline",std::ios::binary);std::string name;std::getline(cmd,name,'\0');if(name!=r.process_name)throw 4;
#else
 // Only empty-admission is a supported host normal path. The real Android
 // module/process check is never replaced by a Darwin path/name projection.
 (void)r;(void)image;throw 1;
#endif
}
void physical(Captured&c){if(c.closed||c.retired||!c.row)throw 9;if(c.held)throw c.first;if(::geteuid()!=c.row->application_uid||::getegid()!=c.row->application_gid)throw 4;if(c.row->maximum_capture_ms<=0||c.row->maximum_capture_ms>30000||!c.image_lease)throw 2;auto image=c.image_lease->current();if(image.present)throw F{image.present,image.code,image.origin,image.platform_code};module_current(*c.row,c.module_resource);for(auto&f:c.files)f->current();if(c.batch.nonce.size()!=43)throw 2;const auto wall=ad::Window::wall(),mono=ad::Window::mono();if(!c.clock.check(c.wall_anchor,c.wall_anchor+c.row->maximum_capture_ms,wall,mono))throw 5;if(c.expiry&&(wall>=c.expiry||c.expiry<=c.wall_anchor||mono<c.mono_anchor||mono-c.mono_anchor>=c.expiry-c.wall_anchor))throw 5;}
template<class FN>F guarded(Captured&c,FN fn){try{fn();return{};}catch(F f){c.keep(f);}catch(int code){c.keep(error(code));}catch(...){c.keep(error(8));}return c.first;}
std::string get(Captured&c,const std::string&url,const char*pin){physical(c);auto hash=hex32(pin);ynx_social_android_device_public_get_request_v1 req{};req.version=1;req.size=sizeof(req);req.url=reinterpret_cast<const uint8_t*>(url.data());req.url_bytes=url.size();std::copy(hash.begin(),hash.end(),req.spki_sha256);req.maximum_ms=2000;req.body_capacity=262144;Bytes bytes(req.body_capacity);size_t used=0;F f{};{Borrow b(c);ynx_social_android_device_public_get_v1(reinterpret_cast<ynx_auth_android_device_capture_v1*>(c.token),&req,bytes.data(),bytes.size(),&used,&f);}if(used>bytes.size())throw 2;c.retained_transport_url=url;c.retained_transport.assign(reinterpret_cast<const char*>(bytes.data()),used);if(bad(f))throw f;if(!used)throw 2;physical(c);return std::string(reinterpret_cast<const char*>(bytes.data()),used);}
std::string copied(B s,const Bytes&buffer,bool empty=false){if(!s.length){if(empty)return{};throw 2;}auto a=reinterpret_cast<uintptr_t>(s.bytes),b=reinterpret_cast<uintptr_t>(buffer.data());if(!s.bytes||s.length>buffer.size()||a<b||a>UINTPTR_MAX-s.length||a+s.length>b+buffer.size())throw 2;return std::string(reinterpret_cast<const char*>(s.bytes),s.length);}
#ifdef YNX_AUTH_ANDROID_PENDING_REGISTRATION_SOURCE_STAGE
#include "PendingRootCapture.inc"
#endif
void refresh(Captured&c){if(c.refreshing)throw 8;physical(c);c.refreshing=true;struct End{bool&b;~End(){b=false;}}end{c.refreshing};auto&r=*c.row;c.ready=false;c.qualified=false;c.batch.previous_canonical=c.previous;c.batch.nonce=random_nonce();
 c.batch.baseline_at_ms=ad::Window::wall();for(size_t i=0;i<4;++i){const char*p=r.original_authorization_paths[i];if(!bounded(p,4096)||p[0]!='/')throw 2;c.batch.before_raw4[i]=get(c,std::string(r.node_origin)+p,r.node_spki);}if(std::strcmp(r.current_endpoint,"https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current"))throw 2;(void)hex32(r.profile_sha256);c.batch.current_raw=get(c,std::string(r.current_endpoint)+"?profile="+r.profile_sha256+"&nonce="+c.batch.nonce,r.current_spki);c.batch.current_at_ms=ad::Window::wall();for(size_t i=0;i<4;++i)c.batch.after_raw4[i]=get(c,std::string(r.node_origin)+r.original_authorization_paths[i],r.node_spki);c.batch.after_at_ms=ad::Window::wall();c.canonical=ac::encode(c.batch);c.ready=true;physical(c);
 F f{};Bytes output(YNX_AUTH_ANDROID_EVALUATOR_OUTPUT_MAX_V1);size_t used=0,count=0;std::array<ynx_auth_android_device_math_observation_v1,YNX_AUTH_ANDROID_EVALUATOR_MATH_MAX_V1>math{};
 {Borrow b(c);ynx_auth_android_device_evaluator_collect_v1(c.evaluator,reinterpret_cast<ynx_auth_android_device_capture_v1*>(c.token),output.data(),output.size(),&used,math.data(),math.size(),&count,&f);}if(used>output.size()||count>math.size())throw 2;c.retained_math.assign(reinterpret_cast<const char*>(output.data()),used);c.retained_observations.assign(math.begin(),math.begin()+count);if(bad(f))throw f;if(!used||count<3)throw 1;for(size_t i=0;i<count;++i){auto&m=math[i];if(m.version!=1||m.size!=sizeof(m)||m.entered!=1||m.original_core_code!=0||m.bridge_rejection||m.reserved||m.result_version!=1||m.result_size!=32||m.verified!=1||m.member_count!=1||m.index||m.cleanup_status||m.result_reserved)throw 8;}
#ifdef YNX_AUTH_ANDROID_PENDING_REGISTRATION_SOURCE_STAGE
 if(c.kind==4){collectPendingProjection(c);return;}
#endif
 Bytes storage(YNX_AUTH_ANDROID_EVALUATOR_OUTPUT_MAX_V1);ynx_auth_android_device_projection_data_v1 v{};
 {Borrow b(c);ynx_auth_android_device_evaluator_copy_projection_v1(c.evaluator,reinterpret_cast<ynx_auth_android_device_capture_v1*>(c.token),storage.data(),storage.size(),&v,&f);}c.retained_projection=storage;if(bad(f))throw f;if(v.version!=1||v.size!=sizeof(v)||v.kind!=c.kind||v.reserved||v.not_before_ms<0||v.expires_at_ms<=v.not_before_ms)throw 2;
 std::array<B,19>spans{v.network,v.account,v.stable_device_identity,v.intent_original,v.source_id,v.instance_id,v.source_generation,v.device_generation,v.canonical_owner,v.registration_original,v.comparison_purpose,v.comparison_source_id,v.comparison_instance_id,v.comparison_source_generation,v.comparison_issuer,v.comparison_subject,v.primary_issuer,v.primary_subject,v.previous_canonical};std::array<std::string,19>values;for(size_t i=0;i<spans.size();++i)values[i]=copied(spans[i],storage,true);
 ac::normalize_identity(c.kind,values);if(values[18].empty()||values[18].size()>4096||values[0].empty()||values[1].empty()||values[4].empty()||values[5].empty()||values[6].empty())throw 2;
 if(c.kind==1&&(values[2].empty()||values[3].empty()||values[7].empty()||values[8].empty()))throw 1;if(c.kind==2&&(values[9].empty()||v.public_pair.version!=1||v.public_pair.size!=sizeof(v.public_pair)))throw 2;
 if(!values[10].empty()&&(values[10]!=purpose(c.kind)||values[11]!=values[4]||values[12]!=values[5]||values[13]!=values[6]))throw 6;
 auto expiry=std::min(v.expires_at_ms,c.wall_anchor+r.maximum_capture_ms);if(c.expiry)expiry=std::min(expiry,c.expiry);if(ad::Window::wall()<v.not_before_ms||ad::Window::wall()>=expiry)throw 5;
 // Fresh current may advance original watermarks, never immutable Source
 // identity/window/namespace/intent or the Native challenge/lifetime.
 ac::assert_same_snapshot(c.snapshot_set,c.value,c.not_before,values,v.not_before_ms);if(!c.snapshot_set){c.not_before=v.not_before_ms;c.snapshot_set=true;}c.value=std::move(values);c.pair=v.public_pair;c.expiry=expiry;c.previous=c.value[18];physical(c);c.qualified=true;
}
void initialize(Captured&c,const ac::Resource&r){c.row=&r;c.kind=r.kind;c.wall_anchor=ad::Window::wall();c.mono_anchor=ad::Window::mono();if(!r.selected_policy)throw 1;
#ifdef YNX_AUTH_ANDROID_PENDING_REGISTRATION_SOURCE_STAGE
 constexpr unsigned maximumKind=4;
#else
 constexpr unsigned maximumKind=3;
#endif
 if(r.kind<1||r.kind>maximumKind||!bounded(r.process_name,256)||!bounded(r.node_origin,2048)||!bounded(r.node_spki,64)||!bounded(r.native_chain_id,20))throw 2;
 c.image_lease=std::make_unique<ac::RootImageLease>();auto image=c.image_lease->acquire(r);if(image.present)throw F{image.present,image.code,image.origin,image.platform_code};const ac::FileResource*actual=nullptr;image=c.image_lease->read_resource(&actual);if(image.present)throw F{image.present,image.code,image.origin,image.platform_code};if(!actual||!actual->image||!actual->image_expectation)throw 1;c.module_resource=*actual;
 // CODE expected bytes/path/SHA are owned by the genuine independent Root9
 // lease. The old row.module_image self/finalSHA is never used as the Root.
 const std::array<const ac::FileResource*,7> originals{&c.module_resource,&r.root,&r.enrollment,&r.profile,&r.baseline_head,&r.policy,&r.previous};
 for(auto*p:originals){auto f=std::make_unique<ac::RootFile>();auto*raw=f.get();c.files.push_back(std::move(f));raw->open(*p);}c.batch.node_origin=r.node_origin;c.batch.node_spki=r.node_spki;c.batch.native_chain_id=r.native_chain_id;c.batch.root_raw=c.files[1]->original();c.batch.enrollment_raw=c.files[2]->original();c.batch.profile_raw=c.files[3]->original();c.batch.head_raw=c.files[4]->original();c.batch.policy_canonical=ac::bind_selected_policy(r,c.batch.root_raw,c.batch.enrollment_raw,c.files[5]->original());c.previous=c.files[6]->original();c.batch.nonce=random_nonce();physical(c);F f{};
#ifdef YNX_AUTH_ANDROID_PENDING_REGISTRATION_SOURCE_STAGE
 if(c.kind==4){ynx_auth_android_device_evaluator_open_pending_fixed_v1(&c.evaluator,&f);}else
#endif
 {ynx_auth_android_device_evaluator_open_fixed_v1(&c.evaluator,&f);}
 if(bad(f))throw f;if(!c.evaluator)throw 8;refresh(c);}
Captured*open(uint32_t kind,const std::array<uint8_t,32>*id,void**out,F*f){auto owner=std::make_unique<Captured>();void*token=captures().adopt(owner);if(!token){*f=error(10);return nullptr;}auto*c=find(token);c->token=token;c->kind=kind;*out=token;*f=guarded(*c,[&]{auto*r=select(kind,id);initialize(*c,*r);});return c;}
F current(Captured*c,uint32_t kind){if(!c||c->kind!=kind)return error(2);if(c->held)return c->first;return guarded(*c,[&]{refresh(*c);});}
struct Pack{uint8_t*p;size_t n,at=0;B put(const std::string&s){if(s.size()>n-at)throw 2;auto out=p+at;if(!s.empty())std::memcpy(out,s.data(),s.size());at+=s.size();return{out,s.size()};}};
D drain(Captured*c,bool close){if(!c)return{error(2),0,0};if(c->closed)return{c->held?c->first:F{},uint32_t(c->close_unknown||c->outcome_unknown),1};c->retired=true;if(c->active||c->borrowed)return{c->held?c->first:F{},0,0};if(!close)return{c->held?c->first:F{},0,1};if(c->close_unknown)return{c->held?c->first:error(8),1,0};
 if(c->evaluator&&!c->eval_closed){D d{};ynx_auth_android_device_evaluator_close_v1(c->evaluator,&d);c->keep(d.failure);c->outcome_unknown=c->outcome_unknown||d.unknown;if(!d.physical_done){if(d.unknown)c->close_unknown=true;return{c->held?c->first:F{},d.unknown,0};}c->eval_closed=true;}
 if(c->evaluator){D d{};ynx_auth_android_device_evaluator_release_closed_v1(&c->evaluator,&d);c->keep(d.failure);c->outcome_unknown=c->outcome_unknown||d.unknown;if(c->evaluator||!d.physical_done){c->close_unknown=true;return{c->held?c->first:error(8),1,0};}}
 for(auto it=c->files.rbegin();it!=c->files.rend();++it)if(!(*it)->close()){c->close_unknown=true;c->keep(error(8));return{c->first,1,0};}c->files.clear();
 // Only after evaluator, actual seven FDs and active/borrowed child debt have
 // physically completed may the CODE view/root release their original lease.
 if(c->image_lease){auto d=c->image_lease->close();c->keep(F{d.failure.present,d.failure.code,d.failure.origin,d.failure.platform_code});c->outcome_unknown=c->outcome_unknown||d.unknown;if(!d.physical_done){if(d.unknown)c->close_unknown=true;return{c->held?c->first:F{},d.unknown,0};}c->image_lease.reset();}
 c->canonical.clear();c->retained_transport.clear();c->retained_transport_url.clear();c->retained_math.clear();c->retained_projection.clear();c->retained_observations.clear();c->operation.clear();c->batch=ac::Batch{};c->value={};c->previous.clear();
#ifdef YNX_AUTH_ANDROID_PENDING_REGISTRATION_SOURCE_STAGE
 c->pending={};c->pending_storage.clear();c->pending_previous.clear();
#endif
 c->closed=true;return{c->held?c->first:F{},uint32_t(c->outcome_unknown),1};}
template<class FN>void boundary(F*f,FN fn){if(!f)return;*f={};try{fn();}catch(F e){*f=e;}catch(int e){*f=error(e);}catch(...){*f=error(8);}}
}
extern "C" void ynx_auth_android_device_capture_current_v1(ynx_auth_android_device_capture_v1*p,F*f){boundary(f,[&]{auto*c=find(p);if(!c||!c->borrowed)throw 2;*f=guarded(*c,[&]{physical(*c);});});}
extern "C" void ynx_auth_android_device_capture_info_v1_read(ynx_auth_android_device_capture_v1*p,ynx_auth_android_device_capture_info_v1*out,F*f){boundary(f,[&]{if(!out)throw 2;*out={};auto*c=find(p);if(!c||!c->borrowed)throw 2;physical(*c);*out={1,sizeof(*out),c->kind,0,c->batch.baseline_at_ms,c->batch.current_at_ms,c->batch.after_at_ms};physical(*c);});}
extern "C" void ynx_auth_android_device_capture_copy_canonical_v1(ynx_auth_android_device_capture_v1*p,uint8_t*out,size_t cap,size_t*used,F*f){if(used)*used=0;boundary(f,[&]{auto*c=find(p);if(!c||!c->borrowed||!out||!used||!c->ready)throw 2;physical(*c);if(c->canonical.size()>cap)throw 2;std::memcpy(out,c->canonical.data(),c->canonical.size());*used=c->canonical.size();physical(*c);});}
extern "C" void ynx_original_android_provision_source_open_v1(ynx_original_android_provision_source_v1**out,F*f){boundary(f,[&]{if(!out)throw 2;*out=nullptr;void*p=nullptr;open(1,nullptr,&p,f);*out=reinterpret_cast<ynx_original_android_provision_source_v1*>(p);});}
extern "C" void ynx_original_android_registered_device_open_v1(ynx_original_android_provision_source_v1*s,B operation,const ynx_auth_android_device_public_pair_v1*pair,ynx_original_android_registered_device_v1**out,F*f){boundary(f,[&]{if(!out||!operation.bytes||operation.length!=64||!pair)throw 2;*out=nullptr;auto*parent=find(s);auto e=current(parent,1);if(bad(e))throw e;void*p=nullptr;auto*c=open(2,&parent->row->registered_resource,&p,f);*out=reinterpret_cast<ynx_original_android_registered_device_v1*>(p);if(!c||bad(*f))return;c->operation.assign(reinterpret_cast<const char*>(operation.bytes),operation.length);if(c->value[0]!=parent->value[0]||c->value[1]!=parent->value[1]||std::memcmp(c->pair.pk_a,pair->pk_a,2592)||std::memcmp(c->pair.pk_b,pair->pk_b,64)){c->keep(error(6));*f=c->first;}});}
extern "C" void ynx_original_android_device_query_open_v1(B operation,B account,B network,ynx_original_android_device_query_v1**out,F*f){boundary(f,[&]{if(!out||!operation.bytes||!operation.length||!account.bytes||!account.length||!network.bytes||!network.length)throw 2;*out=nullptr;void*p=nullptr;auto*c=open(3,nullptr,&p,f);*out=reinterpret_cast<ynx_original_android_device_query_v1*>(p);if(!c||bad(*f))return;c->operation.assign(reinterpret_cast<const char*>(operation.bytes),operation.length);if(c->value[0]!=std::string(reinterpret_cast<const char*>(network.bytes),network.length)||c->value[1]!=std::string(reinterpret_cast<const char*>(account.bytes),account.length)){c->keep(error(6));*f=c->first;}});}
#define ROOT_LIFE(NAME,TYPE,KIND) \
extern "C" void NAME##_current_v1(TYPE*p,F*f){boundary(f,[&]{*f=current(find(p),KIND);});} \
extern "C" void NAME##_retire_v1(TYPE*p){if(auto*c=find(p);c&&c->kind==KIND)c->retired=true;} \
extern "C" void NAME##_join_v1(TYPE*p,D*d){if(!d)return;auto*c=find(p);*d=c&&c->kind==KIND?drain(c,false):D{error(2),0,0};} \
extern "C" void NAME##_close_v1(TYPE**p,D*d){if(!d||!p)return;auto*c=find(*p);*d=c&&(c->kind==KIND||!c->row)?drain(c,true):D{error(2),0,0};if(d->physical_done)*p=nullptr;}
ROOT_LIFE(ynx_original_android_provision_source,ynx_original_android_provision_source_v1,1)
ROOT_LIFE(ynx_original_android_registered_device,ynx_original_android_registered_device_v1,2)
ROOT_LIFE(ynx_original_android_device_query,ynx_original_android_device_query_v1,3)
#undef ROOT_LIFE
#ifdef YNX_AUTH_ANDROID_PENDING_REGISTRATION_SOURCE_STAGE
extern "C" void ynx_original_android_pending_root_open_v1(ynx_original_android_pending_root_v1**out,F*f){boundary(f,[&]{if(!out)throw 2;*out=nullptr;void*p=nullptr;open(4,nullptr,&p,f);*out=reinterpret_cast<ynx_original_android_pending_root_v1*>(p);});}
extern "C" void ynx_original_android_pending_root_current_v1(ynx_original_android_pending_root_v1*p,F*f){boundary(f,[&]{*f=current(find(p),4);});}
extern "C" void ynx_original_android_pending_root_copy_journal_constraints_v1(ynx_original_android_pending_root_v1*p,ynx_auth_android_pending_journal_constraints_v1*out,F*f){if(out)*out={};boundary(f,[&]{auto*c=find(p);if(!c||c->kind!=4||!c->qualified||!out)throw 2;Borrow loan(*c);physical(*c);ynx_auth_android_pending_journal_constraints_v1 value{};if(int e=ac::copy_pending_journal_constraints(*c->row,value))throw e;physical(*c);*out=value;});}
extern "C" void ynx_original_android_pending_root_copy_v1(ynx_original_android_pending_root_v1*p,uint8_t*b,size_t cap,ynx_auth_android_pending_review_data_v1*out,F*f){boundary(f,[&]{auto*c=find(p);if(!c||c->kind!=4||!c->qualified||!out||!b)throw 2;physical(*c);auto value=c->pending;Pack w{b,cap};for(auto*span:pendingFields(value)){if(!span->bytes&&!span->length){*span={};continue;}*span=w.put(copied(*span,c->pending_storage,true));}*out=value;physical(*c);});}
extern "C" void ynx_original_android_pending_root_retire_v1(ynx_original_android_pending_root_v1*p){if(auto*c=find(p);c&&c->kind==4)c->retired=true;}
extern "C" void ynx_original_android_pending_root_join_v1(ynx_original_android_pending_root_v1*p,D*d){if(!d)return;auto*c=find(p);*d=c&&c->kind==4?drain(c,false):D{error(2),0,0};}
extern "C" void ynx_original_android_pending_root_close_v1(ynx_original_android_pending_root_v1**p,D*d){if(!p||!d)return;auto*c=find(*p);*d=c&&c->kind==4?drain(c,true):D{error(2),0,0};if(d->physical_done)*p=nullptr;}
#endif
extern "C" void ynx_original_android_provision_source_copy_intent_v1(ynx_original_android_provision_source_v1*p,uint8_t*b,size_t n,ynx_auth_android_provision_intent_v1*out,F*f){boundary(f,[&]{auto*c=find(p);if(!c||c->kind!=1||!out||!b||!c->qualified)throw 2;physical(*c);Pack w{b,n};*out={1,sizeof(*out),w.put(c->value[0]),w.put(c->value[1]),w.put(c->value[2]),w.put(c->value[3]),w.put(c->value[4]),w.put(c->value[5]),w.put(c->value[6]),c->not_before,c->expiry};physical(*c);});}
extern "C" void ynx_original_android_registered_device_copy_v1(ynx_original_android_registered_device_v1*p,uint8_t*b,size_t n,ynx_auth_android_provision_registered_data_v1*out,F*f){boundary(f,[&]{auto*c=find(p);if(!c||c->kind!=2||!out||!b||!c->qualified)throw 2;physical(*c);Pack w{b,n};*out={1,sizeof(*out),w.put(c->operation),w.put(c->value[9]),w.put(c->value[1]),w.put(c->value[0]),c->not_before,c->expiry};physical(*c);});}
extern "C" void ynx_original_android_device_query_copy_v1(ynx_original_android_device_query_v1*p,uint8_t*b,size_t n,ynx_auth_android_provision_query_data_v1*out,F*f){boundary(f,[&]{auto*c=find(p);if(!c||c->kind!=3||!out||!b||!c->qualified)throw 2;physical(*c);Pack w{b,n};*out={1,sizeof(*out),w.put(c->operation),{},0,0,c->not_before,c->expiry};physical(*c);});}
namespace ynx::auth::android_device_provisioning {
void read_creation_coordinates(ynx_original_android_provision_source_v1*p,CreationCoordinates&out,F*f){boundary(f,[&]{auto*c=find(p);if(!c||c->kind!=1||!c->qualified)throw 2;physical(*c);if(!ac::canonical_device_generation(c->value[7])||!ac::canonical_owner(c->value[8]))throw 1;out={c->value[7],c->value[8]};physical(*c);});}
void read_source_namespace(ynx_original_android_provision_source_v1*p,SourceNamespace&out,F*f){boundary(f,[&]{auto*c=find(p);if(!c||c->kind!=1||!c->qualified)throw 2;physical(*c);if(c->value[10]!=purpose(1)||c->value[14].empty()||c->value[15].empty())throw 1;out={c->value[14],c->value[15],c->value[10],c->value[11],c->value[12],c->value[13]};physical(*c);});}
}
