#include "NativePQCustody.h"
#include "NativeBackupFormat.h"
#include "tx_batch.h"
#include <algorithm>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <limits>
using namespace ynx::auth::android_ordinary;
namespace {
struct Owner{
 OpenedBackup backup;std::thread::id thread=std::this_thread::get_id();
 bool retired=false,selected=false,primitiveEntered=false,closed=false;
 int32_t first=0,closeResult=0,status=-1;uint32_t cleanup=0;size_t length=0;
 std::vector<uint8_t> member;
 explicit Owner(OpenedBackup b):backup(std::move(b)){}
 void sameThread(){if(thread!=std::this_thread::get_id())throw Failure(6);}
 void current(){sameThread();if(closed||retired)throw Failure(6);if(first)throw Failure(first);}
 int32_t close(){sameThread();if(closed)return closeResult;retired=true;wipe(backup.keys.bytes.data(),backup.keys.bytes.size());closed=true;closeResult=first;return closeResult;}
};
std::mutex ownersLock;std::map<uint64_t,std::shared_ptr<Owner>> owners;uint64_t nextID=1;
std::shared_ptr<Owner> owned(uint64_t id){std::lock_guard<std::mutex>l(ownersLock);auto it=owners.find(id);if(!id||it==owners.end())throw Failure(6);auto result=it->second;result->sameThread();return result;}
bool overlap(const void*a,size_t n,const void*b,size_t m){auto x=reinterpret_cast<uintptr_t>(a),y=reinterpret_cast<uintptr_t>(b);if(n>UINTPTR_MAX-x||m>UINTPTR_MAX-y)return true;return n&&m&&x<y+m&&y<x+n;}
bool aligned(const void*p,size_t n){return p&&reinterpret_cast<uintptr_t>(p)%n==0;}
void decimal(const uint8_t*p,size_t n){if(!p||!n||n>20||p[0]=='0')throw Failure(3);uint64_t v=0;for(size_t i=0;i<n;++i){if(p[i]<'0'||p[i]>'9'||v>(UINT64_MAX-(p[i]-'0'))/10)throw Failure(3);v=v*10+p[i]-'0';}if(!v)throw Failure(3);}
YNXTransactionBytesV1 span(const std::vector<uint8_t>&b){return{b.data(),b.size()};}
template<class F>int32_t boundary(F call){try{return call();}catch(const Failure&e){return e.code;}catch(...){return 1;}}
}
extern "C" int32_t ynx_auth_pq_native_open_v1(const uint8_t*w,size_t wn,const uint8_t*c,size_t cn,const uint8_t*b,size_t bn,uint32_t purpose,uint64_t*out){return boundary([&]()->int32_t{
 if(!aligned(out,alignof(uint64_t))||*out||!w||!wn||wn>196608||!c||cn!=43||!b||!bn||bn>8192||overlap(out,8,w,wn)||overlap(out,8,c,cn)||overlap(out,8,b,bn))return 1;
 if(purpose!=1)return 7;
 auto owner=std::make_shared<Owner>(decodeOriginalBackup(w,wn,c,cn,b,bn));
 std::lock_guard<std::mutex>l(ownersLock);if(owners.size()>=256||nextID==UINT64_MAX)return 2;auto id=nextID++;owners.emplace(id,owner);*out=id;return 0;
});}
extern "C" int32_t ynx_auth_pq_native_current_v1(uint64_t id){return boundary([&]{owned(id)->current();return 0;});}
extern "C" int32_t ynx_auth_pq_native_retire_v1(uint64_t id){return boundary([&]{owned(id)->retired=true;return 0;});}
extern "C" int32_t ynx_auth_pq_native_assert_binding_v1(uint64_t id,const uint8_t*b,size_t n){return boundary([&]{auto o=owned(id);o->current();if(!b||!n||n>8192)return 2;if(o->backup.binding.canonical.size()!=n||!std::equal(b,b+n,o->backup.binding.canonical.begin()))return 4;o->current();return 0;});}
extern "C" int32_t ynx_auth_pq_native_closed_witness_v1(uint64_t id,uint32_t*out){return boundary([&]{if(!aligned(out,4))return 1;auto o=owned(id);*out=o->closed?1:0;return 0;});}
extern "C" int32_t ynx_auth_pq_native_close_v1(uint64_t id){return boundary([&]{return owned(id)->close();});}
extern "C" int32_t ynx_auth_pq_native_release_closed_v1(uint64_t id){return boundary([&]{auto o=owned(id);if(!o->closed||(o->primitiveEntered&&o->cleanup!=1&&o->cleanup!=2))return 6;std::lock_guard<std::mutex>l(ownersLock);auto it=owners.find(id);if(it==owners.end()||it->second!=o)return 6;owners.erase(it);return 0;});}
extern "C" uint32_t ynx_auth_pq_native_capabilities_v1(){return 1;}
extern "C" int32_t ynx_auth_pq_native_transaction_once_v1(uint64_t id,const uint8_t*m,size_t mn,const uint8_t*p,size_t pn,uint64_t chain,const uint8_t*v,size_t vn,const uint8_t*h,size_t hn){return boundary([&]()->int32_t{
 auto o=owned(id);o->current();if(o->selected)return 8;if(!m||!mn||mn>8192||!p||!pn||pn>8388608||!chain)return 2;decimal(v,vn);decimal(h,hn);o->selected=true;
 try{
  o->member.resize(98304);auto&b=o->backup.binding;YNXTransactionBatchRequestV1 request{};
  request.abi_version=1;request.struct_size=sizeof(request);request.message_original={m,mn};request.policy_original={p,pn};
  request.expected={span(b.network),span(b.owner),chain,{v,vn},{h,hn},span(b.pkA),span(b.pkB)};
  request.pkcs8_a={o->backup.keys.bytes.data(),54};request.pkcs8_b={o->backup.keys.bytes.data()+54,150};request.pk_a=span(b.pkA);request.pk_b=span(b.pkB);
  o->primitiveEntered=true;
  const auto rc=YNXTransactionBatchSignV1(&request,o->member.data(),o->member.size(),&o->length,&o->cleanup);
  o->status=rc;wipe(o->backup.keys.bytes.data(),o->backup.keys.bytes.size());
  if(rc||o->cleanup!=2||!o->length||o->length>o->member.size())throw Failure(100+std::max(0,std::min(rc,10)));
  o->current();return 0;
 }catch(const Failure&e){wipe(o->backup.keys.bytes.data(),o->backup.keys.bytes.size());if(!o->first)o->first=e.code;throw;}
 catch(...){wipe(o->backup.keys.bytes.data(),o->backup.keys.bytes.size());if(!o->first)o->first=1;throw;}
});}
extern "C" int32_t ynx_auth_pq_native_copy_outcome_v1(uint64_t id,uint8_t*out,size_t capacity,size_t*length,int32_t*status,uint32_t*cleanup,uint32_t*selected){return boundary([&]{
 if(capacity>98304||!aligned(length,alignof(size_t))||!aligned(status,4)||!aligned(cleanup,4)||!aligned(selected,4)||((out==nullptr)!=(capacity==0)))return 1;
 const void*ptrs[]={length,status,cleanup,selected,out};size_t sizes[]={sizeof(size_t),4,4,4,capacity};
 for(size_t i=0;i<5;++i)for(size_t j=i+1;j<5;++j)if(overlap(ptrs[i],sizes[i],ptrs[j],sizes[j]))return 1;
 auto o=owned(id);const size_t n=o->status==0&&o->cleanup==2&&o->length&&o->length<=o->member.size()?o->length:0;
 if(out&&capacity<n)return 2;if(out&&n)std::copy_n(o->member.data(),n,out);*length=n;*status=o->status;*cleanup=o->cleanup;*selected=o->selected?1:0;return 0;
});}
// Android ordinary build has no account-birth role. Refuse BEFORE any secret IO.
extern "C" int32_t ynx_auth_pq_native_open_initial_v1(const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t,uint64_t,const uint8_t*,size_t,uint64_t*){return 7;}
extern "C" int32_t ynx_auth_pq_native_account_initial_once_v1(uint64_t){return 7;}
