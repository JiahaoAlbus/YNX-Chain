#include "RootImageLease.hpp"
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <limits.h>
#include <unistd.h>

namespace ynx::auth::android_capture {
namespace {
constexpr std::uint64_t maximum_image=268435456;
bool bounded(const char*s,std::size_t cap){return s&&*s&&::strnlen(s,cap+1)<=cap;}
bool utf8(const std::string&s){for(std::size_t i=0;i<s.size();){auto a=static_cast<unsigned char>(s[i++]);if(a<128)continue;unsigned n;std::uint32_t x,min;if(a>=0xc2&&a<=0xdf){n=1;x=a&31;min=128;}else if(a>=0xe0&&a<=0xef){n=2;x=a&15;min=2048;}else if(a>=0xf0&&a<=0xf4){n=3;x=a&7;min=65536;}else return false;if(n>s.size()-i)return false;while(n--){auto b=static_cast<unsigned char>(s[i++]);if((b&0xc0)!=0x80)return false;x=(x<<6)|(b&63);}if(x<min||x>0x10ffff||(x>=0xd800&&x<=0xdfff))return false;}return true;}
std::string copy(ynx_native_android_code_image_bytes_v1 b,std::size_t cap){
 if(!b.bytes||!b.length||b.length>cap||reinterpret_cast<std::uintptr_t>(b.bytes)>UINTPTR_MAX-b.length)throw 2;
 std::string out(reinterpret_cast<const char*>(b.bytes),b.length);if(out.find('\0')!=std::string::npos||!utf8(out))throw 2;return out;
}
bool canonical_path(const std::string&p){
 if(p.size()<2||p.size()>=PATH_MAX||p.front()!='/'||p.back()=='/')return false;
 std::size_t at=1;while(at<p.size()){auto end=p.find('/',at);auto part=p.substr(at,end==std::string::npos?end:end-at);if(part.empty()||part=="."||part=="..")return false;for(unsigned char c:part)if(c<32||c==127||c=='\\')return false;if(end==std::string::npos)break;at=end+1;}
 char resolved[PATH_MAX];return ::realpath(p.c_str(),resolved)&&p==resolved;
}
}
RootImageLease::Failure RootImageLease::local(int code)noexcept{return{1,code,0x43494d47,0};}
RootImageLease::Failure RootImageLease::valid(Failure f)noexcept{if(f.present>1||(!f.present&&(f.code||f.origin||f.platform_code)))return local(2);return f;}
RootImageLease::Failure RootImageLease::keep(Failure f,bool cleanup)noexcept{
 f=valid(f);if(f.present){if(!first_.present)first_=f;if(cleanup&&!cleanup_first_.present)cleanup_first_=f;}return first_;
}
RootImageLease::Drain RootImageLease::result(bool done)const noexcept{return{first_,std::uint32_t(outcome_unknown_),std::uint32_t(done)};}
RootImageLease::~RootImageLease(){if(debt())std::abort();}
void RootImageLease::materialize(const ynx_native_android_code_image_data_v1&d,const Resource&r){
 if(d.version!=1||d.size!=sizeof(d)||d.reserved||d.application_uid!=r.application_uid||d.application_gid!=r.application_gid||d.application_uid!=::geteuid()||d.application_gid!=::getegid()||!d.image_device||!d.image_inode||!d.image_bytes||d.image_bytes>maximum_image||d.image_mode>07777||(d.image_mode&0022))throw 2;
 auto service=copy(d.service,64),process=copy(d.process_name,256),path=copy(d.image_path,PATH_MAX-1),hash=copy(d.image_sha256,64);
 if(service!="YNX_AUTH_ANDROID_DEVICE_V4"||process!=r.process_name||hash.size()!=64||!canonical_path(path))throw 4;
 for(char c:hash)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))throw 2;
 // No expectation is taken from r.module_image or this process's observed
 // image/hash. All pins are copied from the SAME independently acquired view.
 path_=std::move(path);sha_=std::move(hash);process_=std::move(process);
 expectation_={d.image_bytes,sha_.c_str()};
 resource_={path_.c_str(),d.image_device,d.image_inode,d.image_uid,d.image_gid,d.image_mode,static_cast<std::size_t>(d.image_bytes),true,&expectation_};
}
RootImageLease::Failure RootImageLease::acquire(const Resource&r)noexcept{
 if(entered_)return keep(local(8));entered_=true;
 try{
  if(!bounded(r.process_name,256)||r.application_uid!=::geteuid()||r.application_gid!=::getegid())return keep(local(4));
  const auto a=ynx_native_android_code_image_root_acquire_v1();root_=a.owner;keep(a.failure); // adopt BEFORE status
  if(first_.present)return first_;if(!root_)return keep(local(1));
  keep(ynx_native_android_code_image_root_current_v1(root_));if(first_.present)return first_;
  const auto v=ynx_native_android_code_image_root_view_open_v1(root_);view_=v.owner;keep(v.failure); // adopt BEFORE status
  if(first_.present)return first_;if(!view_)return keep(local(1));
  keep(ynx_native_android_code_image_view_current_v1(view_));if(first_.present)return first_;
  ynx_native_android_code_image_data_v1 data{};data.version=1;data.size=sizeof(data);
  keep(ynx_native_android_code_image_view_read_v1(view_,&data));if(first_.present)return first_;
  materialize(data,r);
  keep(ynx_native_android_code_image_view_current_v1(view_));if(first_.present)return first_;
  keep(ynx_native_android_code_image_root_current_v1(root_));if(first_.present)return first_;
  ready_=true;return{};
 }catch(int c){return keep(local(c));}catch(...){return keep(local(8));}
}
RootImageLease::Failure RootImageLease::current()noexcept{
 if(first_.present)return first_;if(!ready_||retired_||closed_||!root_||!view_)return local(7);
 try{keep(ynx_native_android_code_image_root_current_v1(root_));if(first_.present)return first_;keep(ynx_native_android_code_image_view_current_v1(view_));if(first_.present)return first_;keep(ynx_native_android_code_image_root_current_v1(root_));return first_;}catch(...){return keep(local(8));}
}
RootImageLease::Failure RootImageLease::read_resource(const FileResource**out)noexcept{
 if(!out)return keep(local(2));*out=nullptr;auto f=current();if(f.present)return f;
 // Stable owned storage. Caller retains this NONMOVABLE lease until its
 // RootFile/evaluator/children have physically drained, including after retire.
 f=current();if(f.present)return f;*out=&resource_;return{};
}
void RootImageLease::retire()noexcept{if(retired_)return;retired_=true;if(root_)try{ynx_native_android_code_image_root_retire_v1(root_);}catch(...){keep(local(8),true);}}
bool RootImageLease::accept_drain(Drain d,bool&done,bool&unknown,Drain&receipt)noexcept{
 const auto f=valid(d.failure);if(f.present&&!receipt.failure.present)receipt.failure=f;receipt.unknown=receipt.unknown||d.unknown!=0||d.physical_done>1;receipt.physical_done=receipt.physical_done||d.physical_done==1;
 keep(d.failure,true);if(d.unknown>1||d.physical_done>1){keep(local(2),true);unknown=true;outcome_unknown_=true;return false;}
 outcome_unknown_=outcome_unknown_||d.unknown;
 if(d.physical_done){done=true;return true;}
 if(d.unknown)unknown=true;return false;
}
RootImageLease::Drain RootImageLease::close()noexcept{
 retire();if(closed_)return result(true);
 try{
  if(view_&&!view_done_){if(view_unknown_)return result(false);if(!accept_drain(ynx_native_android_code_image_view_release_v1(view_),view_done_,view_unknown_,view_receipt_))return result(false);view_=nullptr;}
  if(root_&&!root_done_){if(root_unknown_)return result(false);if(!accept_drain(ynx_native_android_code_image_root_close_v1(root_),root_done_,root_unknown_,root_receipt_))return result(false);}
  if(root_){if(release_unknown_)return result(false);auto original=root_;bool done=false;const auto d=ynx_native_android_code_image_root_release_closed_v1(&root_);bool physical=accept_drain(d,done,release_unknown_,release_receipt_);if((root_&&root_!=original)||(!physical&&!root_)||(physical&&root_)){root_=original;keep(local(2),true);release_unknown_=true;outcome_unknown_=true;return result(false);}if(!physical)return result(false);}
  closed_=true;ready_=false;return result(true);
 }catch(...){keep(local(8),true);outcome_unknown_=true;if(view_&&!view_done_)view_unknown_=true;else if(root_&&!root_done_)root_unknown_=true;else release_unknown_=true;return result(false);}
}
}
