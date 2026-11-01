#include "OS43Private.h"
#include <algorithm>
#include <cstring>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>
using namespace ynx::mobilepq::os43;
namespace ynx::mobilepq::os43 {
void wipe(void* p,size_t n)noexcept{auto b=static_cast<volatile uint8_t*>(p);while(n--)*b++=0;}
bool canonical(const Credential& c){
 static const std::string alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
 for(auto b:c)if(alphabet.find(char(b))==std::string::npos)return false;
 return (alphabet.find(char(c.back()))&3)==0;
}
bool valid(const YNXMobileOS43Descriptor& d){
 return d.version==1&&d.size==sizeof(d)&&d.vault_revision&&d.minimum_protection>=1&&d.minimum_protection<=3&&
  d.ui_timeout_ms>=1000&&d.ui_timeout_ms<=120000&&d.original_binding.bytes&&d.original_binding.length>0&&d.original_binding.length<=8192;
}
std::string itemID(const YNXMobileOS43Descriptor& d){std::string s;const char* h="0123456789abcdef";for(auto c:d.item_id){s+=h[c>>4];s+=h[c&15];}return s;}
Metadata metadata(const YNXMobileOS43Descriptor& d){
 Metadata out{};const char tag[8]={'Y','P','Q','4','3','v','1',0};std::copy(tag,tag+8,out.begin());
 for(int i=0;i<8;++i)out[8+i]=uint8_t(d.vault_revision>>(56-8*i));
 std::copy(d.item_id,d.item_id+32,out.begin()+16);std::copy(d.binding_digest,d.binding_digest+32,out.begin()+48);
 out[83]=uint8_t(d.minimum_protection);out[87]=1;return out;
}
int32_t validateIdentity(const YNXMobileOS43Descriptor& d){
 if(!valid(d))return invalid;
 static const char domain[]="YNX-MOBILE-PQ-OS43/v1";
 std::vector<uint8_t> frame(domain,domain+sizeof(domain)); // includes NUL
 uint32_t n=uint32_t(d.original_binding.length);for(int i=0;i<4;++i)frame.push_back(uint8_t(n>>(24-8*i)));
 frame.insert(frame.end(),d.original_binding.bytes,d.original_binding.bytes+d.original_binding.length);
 for(int i=0;i<8;++i)frame.push_back(uint8_t(d.vault_revision>>(56-8*i)));
 uint8_t digest[32],binding[32];auto e=platformSHA256(frame.data(),frame.size(),digest);if(e)return e;
 e=platformSHA256(d.original_binding.bytes,d.original_binding.length,binding);if(e)return e;
 return std::memcmp(digest,d.item_id,32)||std::memcmp(binding,d.binding_digest,32)?changed:ok;
}
}
namespace {
struct Loan {
 std::thread::id actor=std::this_thread::get_id();
 YNXMobileOS43Descriptor descriptor{};std::vector<uint8_t> binding;
 YNXMobileOS43Permit* permit=nullptr;Credential credential{};YNXMobileOS43Protection protection{};
 uint32_t action=0;bool ready=false,closed=false;int32_t first=0,cleanup=0;
 ~Loan(){wipe(credential.data(),credential.size());}
};
std::mutex inventoryMutex;std::map<uintptr_t,std::shared_ptr<Loan>> inventory;uintptr_t nextLoan=1;
// Monotonic opaque tokens are NEVER dereferenced or exposed through JS. Erased
// entries cannot ABA into a newly allocated loan at the same heap address.
std::shared_ptr<Loan> get(YNXMobileOS43Loan* token){std::lock_guard<std::mutex> lock(inventoryMutex);auto it=inventory.find(reinterpret_cast<uintptr_t>(token));return it==inventory.end()?nullptr:it->second;}
int32_t fail(const std::shared_ptr<Loan>& l,int32_t e){if(e&&!l->first)l->first=e;return e;}
int32_t actor(const std::shared_ptr<Loan>& l){return !l?invalid:l->actor!=std::this_thread::get_id()?wrongThread:0;}
int32_t acquire(YNXMobilePQCapture* capture,const YNXMobileOS43Descriptor* d,uint32_t action,YNXMobileOS43Loan** out,std::shared_ptr<Loan>& l){
 if(!capture||!d||!out||*out||!valid(*d))return invalid;
 if(auto e=validateIdentity(*d))return e;
 {std::lock_guard<std::mutex> lock(inventoryMutex);if(inventory.size()>=256||nextLoan==std::numeric_limits<uintptr_t>::max())return bounds;
  l=std::make_shared<Loan>();l->descriptor=*d;l->binding.assign(d->original_binding.bytes,d->original_binding.bytes+d->original_binding.length);l->descriptor.original_binding={l->binding.data(),l->binding.size()};l->action=action;
  auto token=nextLoan++;inventory.emplace(token,l);*out=reinterpret_cast<YNXMobileOS43Loan*>(token);}
 // Partial permit adopted before checking status, never an OS read on Source0.
 auto e=ynx_auth_mobile_pq_os_acquire_permit_v1(capture,&l->descriptor,action,&l->permit);if(e)return fail(l,e);
 if(!l->permit)return fail(l,denied);
 return fail(l,ynx_auth_mobile_pq_os_permit_current_v1(l->permit));
}
int32_t finish(const std::shared_ptr<Loan>& l,Effect effect){
 auto ack=ynx_auth_mobile_pq_os_finish_v1(l->permit,effect.code,effect.possible?1:0);
 fail(l,effect.code);fail(l,ack);
 if(!l->first)fail(l,ynx_auth_mobile_pq_os_permit_current_v1(l->permit));
 return l->first;
}
}
extern "C" int32_t ynx_mobile_pq_os_borrow43_v1(YNXMobilePQCapture*c,const YNXMobileOS43Descriptor*d,YNXMobileOS43Loan**out){
 std::shared_ptr<Loan> l;auto e=acquire(c,d,YNX_PQ_OS43_BORROW,out,l);if(e)return e;
 l->protection.version=1;l->protection.size=sizeof(l->protection);
 e=platformRead(l->descriptor,l->credential,l->protection);
 if(e){wipe(l->credential.data(),43);return fail(l,e);}
 if(!canonical(l->credential)||l->protection.version!=1||l->protection.size!=sizeof(l->protection)||!l->protection.user_presence||
   l->protection.protection<d->minimum_protection){wipe(l->credential.data(),43);return fail(l,denied);}
 e=ynx_auth_mobile_pq_os_permit_current_v1(l->permit);if(e){wipe(l->credential.data(),43);return fail(l,e);}
 l->ready=true;return 0;
}
extern "C" int32_t ynx_mobile_pq_os_loan_current_v1(YNXMobileOS43Loan* token){
 auto l=get(token);if(auto e=actor(l))return e;if(l->closed||!l->ready||l->first)return closed;
 auto e=ynx_auth_mobile_pq_os_permit_current_v1(l->permit);if(e)return fail(l,e);
 return fail(l,platformCurrent(l->descriptor,l->protection));
}
extern "C" int32_t ynx_mobile_pq_os_loan_bytes_v1(YNXMobileOS43Loan*t,const uint8_t**bytes,size_t*n){
 if(!bytes||!n)return invalid;*bytes=nullptr;*n=0;auto e=ynx_mobile_pq_os_loan_current_v1(t);if(e)return e;
 auto l=get(t);if(l->action!=YNX_PQ_OS43_BORROW)return denied;*bytes=l->credential.data();*n=43;return 0;
}
extern "C" int32_t ynx_mobile_pq_os_loan_protection_v1(YNXMobileOS43Loan*t,YNXMobileOS43Protection*out){
 auto l=get(t);if(auto e=actor(l))return e;if(!out||out->version!=1||out->size!=sizeof(*out))return invalid;*out=l->protection;return 0;
}
extern "C" int32_t ynx_mobile_pq_os_loan_close_v1(YNXMobileOS43Loan*t){
 auto l=get(t);if(auto e=actor(l))return e;if(l->closed)return l->cleanup;
 l->ready=false;wipe(l->credential.data(),43);
 if(l->permit){auto e=ynx_auth_mobile_pq_os_close_permit_v1(l->permit);if(e&&!l->cleanup)l->cleanup=e;
  e=ynx_auth_mobile_pq_os_release_closed_permit_v1(l->permit);if(e){if(!l->cleanup)l->cleanup=e;return e;}l->permit=nullptr;}
 l->closed=true;return l->cleanup;
}
extern "C" int32_t ynx_mobile_pq_os_loan_release_closed_v1(YNXMobileOS43Loan*t){
 auto l=get(t);if(auto e=actor(l))return e;if(!l->closed||l->permit)return closed;
 std::lock_guard<std::mutex> lock(inventoryMutex);inventory.erase(reinterpret_cast<uintptr_t>(t));return 0;
}
extern "C" int32_t ynx_mobile_pq_os_import_original43_v1(YNXMobilePQCapture*c,const YNXMobileOS43Descriptor*d,YNXMobileOS43Loan**out){
 std::shared_ptr<Loan> l;auto e=acquire(c,d,YNX_PQ_OS43_IMPORT_ABSENT,out,l);if(e)return e;
 e=platformInput(l->descriptor,l->credential);if(e){wipe(l->credential.data(),43);return finish(l,{e,false});}
 if(!canonical(l->credential)){wipe(l->credential.data(),43);return finish(l,{invalid,false});}
 e=ynx_auth_mobile_pq_os_permit_current_v1(l->permit);if(!e)e=ynx_auth_mobile_pq_os_validate_original43_v1(l->permit,l->credential.data(),43);
 if(e){wipe(l->credential.data(),43);return finish(l,{e,false});}
 auto result=platformImportAbsent(l->descriptor,l->credential);wipe(l->credential.data(),43);return finish(l,result);
}
extern "C" int32_t ynx_mobile_pq_os_remove_exact43_v1(YNXMobilePQCapture*c,const YNXMobileOS43Descriptor*d,YNXMobileOS43Loan**out){
 std::shared_ptr<Loan> l;auto e=acquire(c,d,YNX_PQ_OS43_REMOVE_EXACT,out,l);if(e)return e;
 return finish(l,platformRemoveExact(l->descriptor));
}
