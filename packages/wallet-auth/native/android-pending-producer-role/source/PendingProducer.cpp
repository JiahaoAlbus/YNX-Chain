#include "AndroidDeviceRegistrationPortsPrivate.h"
#include "product_device_challenge_v4.h"
#include "PendingJournal.hpp"
#include "Lifetime.hpp"
#include <algorithm>
#include <array>
#include <atomic>
#include <cstring>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <unistd.h>
namespace ap=ynx::auth::android_pending;
namespace life=ynx::auth::android_device_provisioning;
namespace {
using F=ynx_auth_android_provision_failure_v1;using D=ynx_auth_android_provision_drain_v1;using B=ynx_auth_android_provision_bytes_v1;using V=ynx_auth_android_pending_review_data_v1;
constexpr uint32_t Origin=0x504f5056;constexpr int Missing=-84201,Malformed=-84202,Actor=-84203,Retired=-84204,Pending=-84205,Once=-84206,Expired=-84207,Internal=-84208;
F error(int code){return {1,code,Origin,0};}bool bad(F f){return f.present!=0||f.code!=0||f.origin!=0||f.platform_code!=0;}F checked(F f){return f.present>1||(!f.present&&(f.code||f.origin||f.platform_code))?error(Malformed):f;}
void keep(F&first,F f){f=checked(f);if(!first.present&&f.present)first=f;}
struct Source;struct Proof;
std::mutex inventoryMutex;std::unordered_map<void*,std::unique_ptr<Source>>sources;std::unordered_map<void*,std::unique_ptr<Proof>>proofs;
bool hex(const std::string&s,size_t n){if(s.size()!=n)return false;for(char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;return true;}
std::string hexBytes(const uint8_t*p,size_t n){const char*x="0123456789abcdef";std::string s;s.reserve(n*2);for(size_t i=0;i<n;i++){s.push_back(x[p[i]>>4]);s.push_back(x[p[i]&15]);}return s;}
bool generation(const std::string&s){if(s.empty()||s.size()>20||(s.size()>1&&s[0]=='0'))return false;for(char c:s)if(c<'0'||c>'9')return false;return s.size()<20||s<="18446744073709551615";}
std::vector<B*>fields(V&v){return {&v.scope_original,&v.registration_original,&v.request_original,&v.challenge_original,&v.pending_id,&v.registration_digest,&v.request_digest,&v.approval_digest,&v.source_id,&v.instance_id,&v.source_generation,&v.stable_device_identity,&v.device_generation,&v.account,&v.product_id,&v.client_id,&v.application_id,&v.bundle_id,&v.package_id,&v.origin,&v.callback,&v.device_id};}
std::string text(B b){return b.length?std::string(reinterpret_cast<const char*>(b.bytes),b.length):std::string{};}
bool inside(B b,const std::vector<uint8_t>&buf,bool empty=false){const auto p=reinterpret_cast<uintptr_t>(b.bytes),start=reinterpret_cast<uintptr_t>(buf.data());return b.length?(p>=start&&p<=start+buf.size()&&b.length<=start+buf.size()-p):(empty&&(!b.bytes||(p>=start&&p<=start+buf.size())));}
struct Review {
 V v{};std::vector<uint8_t>storage;
 void read(ynx_original_android_pending_root_v1*r){storage.resize(262144);F f{};ynx_original_android_pending_root_copy_v1(r,storage.data(),storage.size(),&v,&f);if(bad(f))throw f;
  if(v.version!=1||v.size!=sizeof(v)||v.kind<1||v.kind>2||v.reserved||v.app_reserved||(v.null_mask&~3u)||v.not_before_ms<0||v.expires_at_ms<=v.not_before_ms)throw error(Malformed);
  for(auto*b:fields(v))if(!inside(*b,storage,true))throw error(Malformed);
  if(!v.scope_original.length||v.scope_original.length>65536||!v.registration_original.length||v.registration_original.length>16384||!v.request_original.length||v.request_original.length>16384||v.challenge_original.length>16384||(v.kind==1&&v.challenge_original.length)||(v.kind==2&&!v.challenge_original.length))throw error(Malformed);
  if(!hex(text(v.pending_id),64)||!hex(text(v.registration_digest),64)||!hex(text(v.approval_digest),64)||(v.request_digest.length&&!hex(text(v.request_digest),64)))throw error(Malformed);
  for(auto b:{v.source_id,v.instance_id,v.account,v.product_id,v.client_id,v.application_id,v.device_id})if(!b.length||b.length>2048)throw error(Malformed);
  if(v.stable_device_identity.length>2048)throw error(Malformed); // Optional original Native PENDING identity, never deviceId-derived
  if(!generation(text(v.source_generation))||!generation(text(v.device_generation)))throw error(Malformed);
  // Only bundleId/packageId nullable. Origin/callback are actual typed strings
  // even when the original contract permits an empty string, never null.
  if(!v.origin.bytes||v.origin.length>2048||!v.callback.bytes||!v.callback.length||v.callback.length>2048)throw error(Malformed);
  if((v.null_mask&1)?v.bundle_id.length!=0:(!v.bundle_id.bytes||v.bundle_id.length>2048))throw error(Malformed);
  if((v.null_mask&2)?v.package_id.length!=0:(!v.package_id.bytes||v.package_id.length>2048))throw error(Malformed);
  const std::string owner(reinterpret_cast<const char*>(v.canonical_owner),42);if(owner.substr(0,2)!="0x"||!hex(owner.substr(2),40))throw error(Malformed);
 }
 bool same(Review&b){auto aFields=fields(v),bFields=fields(b.v);if(v.kind!=b.v.kind||v.null_mask!=b.v.null_mask||v.not_before_ms!=b.v.not_before_ms||v.expires_at_ms!=b.v.expires_at_ms||std::memcmp(v.network,b.v.network,32)||std::memcmp(v.canonical_owner,b.v.canonical_owner,42)||std::memcmp(v.device_pk_a,b.v.device_pk_a,2592)||std::memcmp(v.device_pk_b,b.v.device_pk_b,64))return false;for(size_t i=0;i<aFields.size();i++)if(text(*aFields[i])!=text(*bFields[i]))return false;return true;}
 void copy(uint8_t*out,size_t cap,V*dst){if(!out||!dst)throw error(Malformed);V value=v;size_t at=0;for(auto*b:fields(value)){if(b->length>cap-at)throw error(Malformed);auto p=out+at;if(b->length)std::memcpy(p,b->bytes,b->length);at+=b->length;if(b==&value.bundle_id&&(v.null_mask&1))b->bytes=nullptr;else if(b==&value.package_id&&(v.null_mask&2))b->bytes=nullptr;else b->bytes=p;}*dst=value;}
};
struct Source {
 const std::thread::id actor=std::this_thread::get_id();const pid_t pid=getpid();const uid_t uid=geteuid();
 std::atomic<bool>cancelled{false};ynx_original_android_pending_root_v1*root=nullptr;ynx_original_android_pending_approval_v1*approval=nullptr;
 Review review;bool haveReview=false,selected=false,approvalSelected=false,retired=false,closed=false,released=false,closing=false,rootCloseUnknown=false,approvalCloseUnknown=false;unsigned children=0,active=0;
 F first{};life::Window window{86400000};int64_t approvalBegin=0,approvalEnd=0;std::vector<uint8_t>approvalStorage;ynx_original_android_pending_approval_data_v1 approvalData{};
 bool same()const{return actor==std::this_thread::get_id()&&pid==getpid()&&uid==geteuid();}
 void retain(F f){keep(first,f);}
 void local(){if(cancelled.load(std::memory_order_acquire)||retired||closed||released)throw error(Retired);if(!haveReview||!window.current(review.v.not_before_ms,review.v.expires_at_ms))throw error(Expired);if(approvalEnd&&(life::Window::wall()<approvalBegin||life::Window::wall()>=approvalEnd))throw error(Expired);}
 // Source current is Root-only. Main/slot producers may AND this original
 // source during their own current without recursively re-entering themselves.
 void current(){if(!same())throw error(Actor);if(first.present)throw first;if(!root)throw error(Missing);local();F f{};ynx_original_android_pending_root_current_v1(root,&f);if(bad(f))throw f;Review now;now.read(root);if(!review.same(now))throw error(Malformed);local();}
 void approvalCurrent(){if(!approval)throw error(Missing);F f{};ynx_original_android_pending_approval_current_v1(approval,reinterpret_cast<ynx_auth_android_pending_source_v1*>(this),&f);if(bad(f))throw f;local();}
 void captureApproval(){current();if(!approvalSelected){approvalSelected=true;F f{};ynx_original_android_pending_approval_capture_v1(reinterpret_cast<ynx_auth_android_pending_source_v1*>(this),&approval,&f);if(bad(f))throw f;if(!approval)throw error(Missing);approvalStorage.resize(1048576);ynx_original_android_pending_approval_copy_v1(approval,approvalStorage.data(),approvalStorage.size(),&approvalData,&f);if(bad(f))throw f;
   if(approvalData.version!=1||approvalData.size!=sizeof(approvalData)||!inside(approvalData.approval_original,approvalStorage)||!inside(approvalData.policy_original,approvalStorage)||!inside(approvalData.request_original,approvalStorage)||!approvalData.approval_original.length||approvalData.approval_original.length>196608||!approvalData.policy_original.length||approvalData.policy_original.length>524288||text(approvalData.request_original)!=text(review.v.request_original)||hexBytes(approvalData.approval_digest,32)!=text(review.v.approval_digest)||(review.v.request_digest.length&&hexBytes(approvalData.request_digest,32)!=text(review.v.request_digest)))throw error(Malformed);
   if(approvalData.not_before_ms<review.v.not_before_ms||approvalData.expires_at_ms>review.v.expires_at_ms||approvalData.expires_at_ms<=approvalData.not_before_ms)throw error(Expired);approvalBegin=approvalData.not_before_ms;approvalEnd=approvalData.expires_at_ms;
  }approvalCurrent();current();}
};
struct Proof {
 Source*source=nullptr;ynx_original_android_abort_context_v1*context=nullptr;unsigned kind=0,active=0;bool entered=false,math=false,retired=false,closed=false,released=false,recovered=false,closing=false,pairUnknown=false,dirUnknown=false;
 ynx_original_android_pending_device_pair_v1*pair=nullptr;ynx_original_android_pending_directory_v1*directory=nullptr;ap::PendingJournal journal;
 std::vector<uint8_t>member;size_t reported=0;int32_t rc=-1;uint32_t cleanup=0;F first{};
 void retain(F f){keep(first,f);}
 void current(){if(!source||!source->same())throw error(Actor);if(first.present)throw first;if(retired||closed||released)throw error(Retired);source->current();source->approvalCurrent();F f{};ynx_original_android_pending_abort_current_v1(context,&f);if(bad(f))throw f;if(pair){ynx_original_android_pending_pair_current_v1(pair,reinterpret_cast<ynx_auth_android_pending_source_v1*>(source),&f);if(bad(f))throw f;}source->current();source->local();}
};
Source*source(void*p,bool anyThread=false){std::lock_guard<std::mutex>lock(inventoryMutex);auto it=sources.find(p);return it!=sources.end()&&(anyThread||it->second->same())?it->second.get():nullptr;}
Proof*proof(void*p){std::lock_guard<std::mutex>lock(inventoryMutex);auto it=proofs.find(p);return it!=proofs.end()&&it->second->source&&it->second->source->same()?it->second.get():nullptr;}
template<class Fn>void boundary(F*f,Fn fn){if(!f)return;*f={};try{fn();}catch(F e){*f=checked(e);}catch(...){*f=error(Internal);}}
template<class T,class Fn>F work(T&t,Fn fn){try{fn();}catch(F f){t.retain(f);}catch(...){t.retain(error(Internal));}return t.first;}
struct SourceCall{Source&s;explicit SourceCall(Source&v):s(v){++s.active;}~SourceCall(){--s.active;}};
struct ProofCall{Proof&p;SourceCall parent;explicit ProofCall(Proof&v):p(v),parent(*v.source){++p.active;}~ProofCall(){--p.active;}};
void abortCurrent(Proof&p){F f{};ynx_original_android_pending_abort_current_v1(p.context,&f);if(bad(f))throw f;p.source->local();}
void produce(Source&s,unsigned kind,ynx_original_android_abort_context_v1*context,ynx_auth_android_pending_proof_v1**out,F*f){
 if(!out||!context||s.selected||s.children||kind!=s.review.v.kind)throw error(Once);
 s.current();auto owner=std::make_unique<Proof>();auto*p=owner.get();p->source=&s;p->context=context;p->kind=kind;
 {std::lock_guard<std::mutex>lock(inventoryMutex);if(proofs.size()>=16384)throw error(Pending);proofs.emplace(p,std::move(owner));}
 *out=reinterpret_cast<ynx_auth_android_pending_proof_v1*>(p);s.selected=true;++s.children; // adopt before every foreign call or failure
 ProofCall call(*p);
 *f=work(*p,[&]{s.captureApproval();abortCurrent(*p);F fail{};ynx_original_android_pending_directory_open_v1(reinterpret_cast<ynx_auth_android_pending_source_v1*>(&s),&p->directory,&fail);if(bad(fail))throw fail;if(!p->directory)throw error(Missing);int fd=-1;ynx_original_android_pending_directory_borrow_v1(p->directory,&fd,&fail);if(bad(fail))throw fail;
  auto&v=s.review.v;p->journal.openBorrowed(fd,kind,hexBytes(v.network,32),text(v.registration_digest),text(v.pending_id),text(v.scope_original));p->journal.reserve();s.current();abortCurrent(*p);
  ynx_original_android_pending_pair_open_v1(reinterpret_cast<ynx_auth_android_pending_source_v1*>(&s),&p->pair,&fail);if(bad(fail))throw fail;if(!p->pair)throw error(Missing);p->current();ynx_original_android_pending_pair_borrow_v1 borrow{};ynx_original_android_pending_pair_borrow_once_v1(p->pair,reinterpret_cast<ynx_auth_android_pending_source_v1*>(&s),&borrow,&fail);if(bad(fail))throw fail;
  if(borrow.version!=1||borrow.size!=sizeof(borrow)||borrow.der_a.length!=54||borrow.der_b.length!=150||!borrow.der_a.bytes||!borrow.der_b.bytes||borrow.pk_a.length!=2592||borrow.pk_b.length!=64||!borrow.pk_a.bytes||!borrow.pk_b.bytes||std::memcmp(v.device_pk_a,borrow.pk_a.bytes,2592)||std::memcmp(v.device_pk_b,borrow.pk_b.bytes,64))throw error(Malformed);
  std::array<uint8_t,98304>buffer{};p->member.reserve(buffer.size());YNXProductDeviceExpectedV4 expected{{v.network,32},{v.canonical_owner,42},{v.device_pk_a,2592},{v.device_pk_b,64}};
  p->current();ynx_original_android_pending_directory_current_v1(p->directory,&fail);if(bad(fail))throw fail;s.local();p->journal.enter();p->entered=true;
  try{if(kind==1){YNXProductSessionDeviceRegistrationRequestV4 req{};req.version=4;req.struct_size=sizeof(req);req.registration_original={v.registration_original.bytes,v.registration_original.length};req.expected=expected;req.pkcs8_a=borrow.der_a;req.pkcs8_b=borrow.der_b;req.pk_a=borrow.pk_a;req.pk_b=borrow.pk_b;p->rc=YNXProductSessionDeviceRegistrationSignV4(&req,buffer.data(),buffer.size(),&p->reported,&p->cleanup);}else{YNXProductSessionDeviceChallengeRequestV4 req{};req.version=4;req.struct_size=sizeof(req);req.registration_original={v.registration_original.bytes,v.registration_original.length};req.challenge_original={v.challenge_original.bytes,v.challenge_original.length};req.expected=expected;req.pkcs8_a=borrow.der_a;req.pkcs8_b=borrow.der_b;req.pk_a=borrow.pk_a;req.pk_b=borrow.pk_b;p->rc=YNXProductSessionDeviceChallengeSignV4(&req,buffer.data(),buffer.size(),&p->reported,&p->cleanup);}}
  catch(...){p->retain(error(Internal));}
  // Preserve exact public output BEFORE status/cleanup/time/current/persistence.
  if(p->reported<=buffer.size())p->member.assign(buffer.begin(),buffer.begin()+p->reported);else p->retain(error(Malformed));
  p->journal.capture(p->rc,p->cleanup,p->reported,p->member);
  if(p->rc!=0||p->cleanup!=2||p->reported!=p->member.size()||p->member.empty()){p->retain(F{1,p->rc,0x434f5245,int64_t(p->cleanup)});throw p->first;}
  p->current();s.local();p->math=true;
 });
 if(p->journal.recovered()){p->recovered=true;p->member=p->journal.member();p->rc=p->journal.rc();p->cleanup=p->journal.cleanup();p->reported=p->journal.reported();} // DATA only, never re-entry
}
D closeProof(Proof&p,bool close){if(p.closed)return {p.first,0,1};p.retired=true;if(p.active||p.closing)return {p.first,0,0};if(!close)return {p.first,0,1};if((p.entered&&(p.cleanup==0||p.cleanup==3))||p.journal.cleanupUnknown())return {p.first.present?p.first:error(Internal),1,0};
 if(p.pairUnknown||p.dirUnknown)return {p.first.present?p.first:error(Internal),1,0};
 p.closing=true;struct End{bool&v;~End(){v=false;}}end{p.closing};
 if(p.pair){D d{};ynx_original_android_pending_pair_retire_v1(p.pair);ynx_original_android_pending_pair_close_v1(&p.pair,&d);p.retain(d.failure);if(!d.physical_done||p.pair){p.pairUnknown=d.unknown!=0;return {p.first,d.unknown,0};}}
 if(p.directory){D d{};ynx_original_android_pending_directory_close_v1(&p.directory,&d);p.retain(d.failure);if(!d.physical_done||p.directory){p.dirUnknown=d.unknown!=0;return {p.first,d.unknown,0};}}
 p.closed=true;if(p.source->children)--p.source->children;return {p.first,0,1};}
D closeSource(Source&s,bool close){if(s.closed)return{s.first,0,1};s.cancelled.store(true,std::memory_order_release);s.retired=true;if(s.children||s.active||s.closing)return{s.first,0,0};if(!close)return{s.first,0,1};if(s.approvalCloseUnknown||s.rootCloseUnknown)return{s.first.present?s.first:error(Internal),1,0};
 s.closing=true;struct End{bool&v;~End(){v=false;}}end{s.closing};
 if(s.approval){D d{};ynx_original_android_pending_approval_retire_v1(s.approval);ynx_original_android_pending_approval_close_v1(&s.approval,&d);s.retain(d.failure);if(!d.physical_done||s.approval){s.approvalCloseUnknown=d.unknown!=0;return{s.first,d.unknown,0};}}
 if(s.root){D d{};ynx_original_android_pending_root_retire_v1(s.root);ynx_original_android_pending_root_join_v1(s.root,&d);s.retain(d.failure);if(!d.physical_done)return{s.first,d.unknown,0};ynx_original_android_pending_root_close_v1(&s.root,&d);s.retain(d.failure);if(!d.physical_done||s.root){s.rootCloseUnknown=d.unknown!=0;return{s.first,d.unknown,0};}}
 s.approvalStorage.clear();s.review.storage.clear();s.review.v={};s.closed=true;return{s.first,0,1};}
}
extern "C" void ynx_auth_android_pending_source_open_original_v1(ynx_auth_android_pending_source_v1**out,F*f){boundary(f,[&]{if(!out)throw error(Malformed);*out=nullptr;auto owner=std::make_unique<Source>();auto*s=owner.get();{std::lock_guard<std::mutex>lock(inventoryMutex);if(sources.size()>=16384)throw error(Pending);sources.emplace(s,std::move(owner));}*out=reinterpret_cast<ynx_auth_android_pending_source_v1*>(s);SourceCall call(*s);*f=work(*s,[&]{ynx_original_android_pending_root_open_v1(&s->root,f);if(bad(*f))throw *f;if(!s->root)throw error(Missing);s->review.read(s->root);s->haveReview=true;s->current();});});}
extern "C" void ynx_auth_android_pending_source_current_v1(ynx_auth_android_pending_source_v1*p,F*f){boundary(f,[&]{auto*s=source(p);if(!s)throw error(Actor);SourceCall call(*s);*f=work(*s,[&]{s->current();});});}
extern "C" void ynx_auth_android_pending_source_copy_journal_constraints_v1(ynx_auth_android_pending_source_v1*p,ynx_auth_android_pending_journal_constraints_v1*out,F*f){if(out)*out={};boundary(f,[&]{auto*s=source(p);if(!s||!out)throw error(Malformed);SourceCall call(*s);*f=work(*s,[&]{s->current();ynx_auth_android_pending_journal_constraints_v1 value{};F original{};ynx_original_android_pending_root_copy_journal_constraints_v1(s->root,&value,&original);if(bad(original))throw original;if(value.version!=1||value.size!=sizeof(value)||value.parent.reserved||value.directory.reserved||!value.parent.device||!value.parent.inode||!value.directory.device||!value.directory.inode||value.parent.mode!=0700||value.directory.mode!=0700||value.parent.uid!=value.directory.uid||value.parent.gid!=value.directory.gid||(value.parent.device==value.directory.device&&value.parent.inode==value.directory.inode)||std::memcmp(value.leaf,"ynx-product-device-v4",sizeof("ynx-product-device-v4")))throw error(Malformed);for(size_t i=sizeof("ynx-product-device-v4");i<sizeof(value.leaf);++i)if(value.leaf[i])throw error(Malformed);s->current();*out=value;});});}
extern "C" void ynx_auth_android_pending_source_copy_review_v1(ynx_auth_android_pending_source_v1*p,uint8_t*b,size_t n,V*out,F*f){boundary(f,[&]{auto*s=source(p);if(!s)throw error(Actor);SourceCall call(*s);*f=work(*s,[&]{s->current();s->review.copy(b,n,out);s->current();});});}
extern "C" void ynx_auth_android_pending_source_copy_user_approval_v1(ynx_auth_android_pending_source_v1*p,uint8_t*b,size_t cap,B*a,B*policy,F*f){boundary(f,[&]{auto*s=source(p);if(!s||!b||!a||!policy)throw error(Malformed);*a={};*policy={};SourceCall call(*s);*f=work(*s,[&]{s->captureApproval();auto av=s->approvalData.approval_original,pv=s->approvalData.policy_original;if(av.length>cap||pv.length>cap-av.length)throw error(Malformed);std::memcpy(b,av.bytes,av.length);std::memcpy(b+av.length,pv.bytes,pv.length);*a={b,av.length};*policy={b+av.length,pv.length};s->current();});});}
#define PRODUCE(NAME,KIND) extern "C" void NAME(ynx_auth_android_pending_source_v1*p,ynx_original_android_abort_context_v1*c,ynx_auth_android_pending_proof_v1**out,F*f){boundary(f,[&]{auto*s=source(p);if(!s)throw error(Actor);SourceCall call(*s);produce(*s,KIND,c,out,f);});}
PRODUCE(ynx_auth_android_pending_produce_registration_proof_v1,1)
PRODUCE(ynx_auth_android_pending_produce_challenge_proof_v1,2)
#undef PRODUCE
extern "C" void ynx_auth_android_pending_proof_copy_member_v1(ynx_auth_android_pending_proof_v1*p,uint8_t*b,size_t cap,size_t*used,F*f){if(used)*used=0;boundary(f,[&]{auto*q=proof(p);if(!q||!used||(!b&&cap)||q->member.size()>cap)throw error(Malformed);if(!q->member.empty())std::memcpy(b,q->member.data(),q->member.size());*used=q->member.size();});}
extern "C" void ynx_auth_android_pending_proof_copy_status_v1(ynx_auth_android_pending_proof_v1*p,ynx_auth_android_pending_status_v1*out,F*f){boundary(f,[&]{auto*q=proof(p);if(!q||!out)throw error(Malformed);*out={1,sizeof(*out),uint32_t(q->entered),uint32_t(q->math),uint32_t(q->recovered),uint32_t(!q->member.empty()),q->rc,q->cleanup,q->reported,q->member.size(),uint32_t(q->journal.ack()),uint32_t(q->first.present||!q->math),q->first};});}
extern "C" void ynx_auth_android_pending_proof_current_v1(ynx_auth_android_pending_proof_v1*p,F*f){boundary(f,[&]{auto*q=proof(p);if(!q)throw error(Actor);ProofCall call(*q);*f=work(*q,[&]{if(!q->math||q->recovered)throw error(Once);q->current();});});}
extern "C" void ynx_auth_android_pending_request_cancel_v1(ynx_auth_android_pending_source_v1*p){if(auto*s=source(p,true))s->cancelled.store(true,std::memory_order_release);}
extern "C" void ynx_auth_android_pending_source_retire_v1(ynx_auth_android_pending_source_v1*p){if(auto*s=source(p)){s->cancelled.store(true,std::memory_order_release);s->retired=true;}}
extern "C" void ynx_auth_android_pending_proof_retire_v1(ynx_auth_android_pending_proof_v1*p){if(auto*q=proof(p))q->retired=true;}
extern "C" void ynx_auth_android_pending_source_join_v1(ynx_auth_android_pending_source_v1*p,D*d){if(d){auto*s=source(p);*d=s?closeSource(*s,false):D{error(Actor),0,0};}}
extern "C" void ynx_auth_android_pending_source_close_v1(ynx_auth_android_pending_source_v1*p,D*d){if(d){auto*s=source(p);*d=s?closeSource(*s,true):D{error(Actor),0,0};}}
extern "C" void ynx_auth_android_pending_source_release_closed_v1(ynx_auth_android_pending_source_v1**p,D*d){if(!p||!d)return;auto*s=source(*p);if(!s||!s->closed){*d={s?s->first:error(Actor),0,0};return;}s->released=true;*p=nullptr;*d={s->first,0,1};}
extern "C" void ynx_auth_android_pending_proof_join_v1(ynx_auth_android_pending_proof_v1*p,D*d){if(d){auto*q=proof(p);*d=q?closeProof(*q,false):D{error(Actor),0,0};}}
extern "C" void ynx_auth_android_pending_proof_close_v1(ynx_auth_android_pending_proof_v1*p,D*d){if(d){auto*q=proof(p);*d=q?closeProof(*q,true):D{error(Actor),0,0};}}
extern "C" void ynx_auth_android_pending_proof_release_closed_v1(ynx_auth_android_pending_proof_v1**p,D*d){if(!p||!d)return;auto*q=proof(*p);if(!q||!q->closed){*d={q?q->first:error(Actor),0,0};return;}q->released=true;*p=nullptr;*d={q->first,0,1};}
