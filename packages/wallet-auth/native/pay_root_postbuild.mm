#import <Foundation/Foundation.h>
#include "pay_root_postbuild_private.hpp"
#include <filesystem>
#include <set>
#include <map>
#include <mutex>
#include <sys/stat.h>
namespace ynx::wallet::pay::root_physical {
namespace {
bool shape(id x,NSArray*keys){return [x isKindOfClass:NSDictionary.class]&&[[NSSet setWithArray:[x allKeys]]isEqualToSet:[NSSet setWithArray:keys]];}
std::string text(id x){if(![x isKindOfClass:NSString.class])throw Code::content;NSData*b=[x dataUsingEncoding:NSUTF8StringEncoding];if(!b||!b.length||b.length>4096||memchr(b.bytes,0,b.length))throw Code::content;return {(const char*)b.bytes,b.length};}
uint64_t bytes(id x){if(![x isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)x)==CFBooleanGetTypeID())throw Code::content;double n=[x doubleValue];if(n<0||n>134217728||n!=double([x unsignedLongLongValue]))throw Code::content;return [x unsignedLongLongValue];}
Identity identity(const std::string&p){struct stat s{};if(lstat(p.c_str(),&s))throw Code::io;return {uint64_t(s.st_dev),uint64_t(s.st_ino),uint64_t(s.st_uid),uint64_t(s.st_gid),uint64_t(s.st_mode&07777),uint64_t(s.st_nlink),uint64_t(s.st_size)};}
bool relative(const std::string&p){if(p.empty()||p[0]=='/'||p.find('\\')!=p.npos||p.find('%')!=p.npos||std::filesystem::path(p).lexically_normal().string()!=p)return false;for(const auto&part:std::filesystem::path(p))if(part==".."||part==".")return false;return true;}
std::set<std::string> inventory(const std::string&prefix){std::set<std::string> found;size_t count=0;for(auto i=std::filesystem::recursive_directory_iterator(prefix);i!=std::filesystem::recursive_directory_iterator();++i){if(++count>32768)throw Code::content;auto s=i->symlink_status();if(std::filesystem::is_symlink(s)||(!std::filesystem::is_regular_file(s)&&!std::filesystem::is_directory(s)))throw Code::identity;if(std::filesystem::is_regular_file(s))found.insert(i->path().lexically_relative(prefix).generic_string());}return found;}
}
struct PayPostbuildOriginal::Impl {
 mutable std::mutex mutex;std::unique_ptr<PublicOriginalHold>record;std::vector<std::unique_ptr<PublicOriginalHold>>files;std::set<std::string>selected;
 std::string prefix,main_relative;RootMainLocator main,loader;const void*entry=nullptr,*marker=nullptr;size_t image_index=SIZE_MAX;Code first=Code::ok;bool closed=false;
 Code fail(Code e){if(first==Code::ok)first=e;return first;}
 Code current(bool code_only=false){if(closed)return fail(Code::retired);if(first!=Code::ok)return first;if(!record||(code_only?record->current_code_only():record->current())!=Code::ok)return fail(Code::identity);for(auto&f:files){auto c=code_only?f->current_code_only():f->current();if(c!=Code::ok)return fail(c);}if(image_index>=files.size())return fail(Code::identity);auto c=code_only?files[image_index]->current_native_image_code_only(entry,marker):files[image_index]->current_native_image(entry,marker);if(c!=Code::ok)return fail(c);if(inventory(prefix)!=selected)return fail(Code::identity);return code_only?record->current_code_only():record->current();}
};
PayPostbuildOriginal::PayPostbuildOriginal(std::unique_ptr<Impl>p):p_(std::move(p)){}
PayPostbuildOriginal::~PayPostbuildOriginal(){if(!closed())std::terminate();}
Code PayPostbuildOriginal::current()noexcept{try{std::lock_guard<std::mutex>l(p_->mutex);return p_->current();}catch(Code c){std::lock_guard<std::mutex>l(p_->mutex);return p_->fail(c);}catch(...){std::lock_guard<std::mutex>l(p_->mutex);return p_->fail(Code::io);}}
Code PayPostbuildOriginal::reobserve_code_only()noexcept{try{std::lock_guard<std::mutex>l(p_->mutex);return p_->current(true);}catch(...){std::lock_guard<std::mutex>l(p_->mutex);return p_->fail(Code::io);}}
Code PayPostbuildOriginal::copy_main_locator(RootMainLocator&out)noexcept{try{std::lock_guard<std::mutex>l(p_->mutex);auto c=p_->current();if(c!=Code::ok)return c;auto copy=p_->main;if(copy.main_uri.empty())return p_->fail(Code::content);c=p_->current();if(c==Code::ok)out=std::move(copy);return c;}catch(...){std::lock_guard<std::mutex>l(p_->mutex);return p_->fail(Code::io);}}
Code PayPostbuildOriginal::copy_main_code_locator(RootMainLocator&out)noexcept{try{std::lock_guard<std::mutex>l(p_->mutex);auto c=p_->current(true);if(c!=Code::ok)return c;auto copy=p_->main;c=p_->current(true);if(c==Code::ok)out=std::move(copy);return c;}catch(...){std::lock_guard<std::mutex>l(p_->mutex);return p_->fail(Code::io);}}
Code PayPostbuildOriginal::copy_node_loader_code_locator(RootMainLocator&out)noexcept{try{std::lock_guard<std::mutex>l(p_->mutex);auto c=p_->current(true);if(c!=Code::ok)return c;auto copy=p_->loader;if(copy.main_uri.empty())return p_->fail(Code::content);c=p_->current(true);if(c==Code::ok)out=std::move(copy);return c;}catch(...){std::lock_guard<std::mutex>l(p_->mutex);return p_->fail(Code::io);}}
Code PayPostbuildOriginal::close()noexcept{std::lock_guard<std::mutex>l(p_->mutex);if(p_->closed)return p_->first;for(auto it=p_->files.rbegin();it!=p_->files.rend();++it){if(!*it)continue;(*it)->close();if(!(*it)->closed())return p_->fail(Code::close_debt);}if(p_->record){p_->record->close();if(!p_->record->closed())return p_->fail(Code::close_debt);}p_->closed=true;return p_->first;}
bool PayPostbuildOriginal::closed()const noexcept{std::lock_guard<std::mutex>l(p_->mutex);return p_->closed;}
PostbuildAcquisition capture_pay_postbuild_impl(const RootPublicLocator&locator,const std::string&ref,const std::string&source,const void*entry,const void*marker){
 PostbuildAcquisition r{nullptr,Code::not_supplied};try{@autoreleasepool{@try{
  auto p=std::make_unique<PayPostbuildOriginal::Impl>();r.owner=std::unique_ptr<PayPostbuildOriginal>(new PayPostbuildOriginal(std::move(p)));auto&s=*r.owner->p_;s.entry=entry;s.marker=marker;
  auto rec=capture_root_public_original(locator);s.record=std::move(rec.owner);if(rec.error!=Code::ok){r.error=s.fail(rec.error);return r;}
  std::vector<unsigned char>b;auto c=s.record->read_original(b);if(c!=Code::ok)throw c;NSData*d=[NSData dataWithBytes:b.data() length:b.size()];id root=[NSJSONSerialization JSONObjectWithData:d options:0 error:nil];
  if(!shape(root,@[@"version",@"purpose",@"protectedResourceRef",@"sourceId",@"normalPrefix",@"implementingImage",@"mainModule",@"files"])||![root[@"version"]isEqual:@1]||CFGetTypeID((__bridge CFTypeRef)root[@"version"])==CFBooleanGetTypeID()||text(root[@"purpose"])!="WALLET_NATIVE_PAY_CLIENT_POSTBUILD_V1"||text(root[@"protectedResourceRef"])!=ref||text(root[@"sourceId"])!=source)throw Code::content;
  NSData*canonical=[NSJSONSerialization dataWithJSONObject:root options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(![canonical isEqual:d])throw Code::content;
  s.prefix=text(root[@"normalPrefix"]);if(s.prefix=="/"||!std::filesystem::path(s.prefix).is_absolute()||std::filesystem::canonical(s.prefix).string()!=s.prefix)throw Code::path;
  std::string image=text(root[@"implementingImage"]);if(!relative(image))throw Code::path;
  s.main_relative=text(root[@"mainModule"]);if(!relative(s.main_relative))throw Code::path;
  id files=root[@"files"];if(![files isKindOfClass:NSArray.class]||![files count]||[files count]>16384)throw Code::content;
  s.files.reserve([files count]);std::string previous;uint64_t total=0;
  for(id pin in files){if(!shape(pin,@[@"path",@"bytes",@"sha256"]))throw Code::content;auto rel=text(pin[@"path"]);if(!relative(rel)||(!previous.empty()&&rel<=previous))throw Code::path;previous=rel;auto n=bytes(pin[@"bytes"]);if(total>UINT64_C(4294967296)-n)throw Code::content;total+=n;
   auto full=s.prefix+"/"+rel;if(std::filesystem::canonical(full).string()!=full)throw Code::path;auto parent=std::filesystem::path(full).parent_path().string();auto f=hold_original({parent,std::filesystem::path(full).filename().string(),identity(parent),identity(full),text(pin[@"sha256"]),locator.not_before_ms,locator.expires_ms,std::max(n,UINT64_C(1))});
   // reserve/adopt before interpreting the first error; no dropped FD partial.
   s.files.push_back(std::move(f.owner));if(f.error!=Code::ok)throw f.error;if(!s.files.back())throw Code::io;
   if(rel==image)s.image_index=s.files.size()-1;s.selected.insert(rel);
   if(rel==s.main_relative){s.main.main_uri=[NSURL fileURLWithPath:[NSString stringWithUTF8String:full.c_str()]].absoluteString.UTF8String;s.main.module_bytes=n;s.main.module_sha256=text(pin[@"sha256"]);}
   if(rel=="packages/wallet-auth/src/original-wallet-main-namespace-node-loader-private.js"){
    if(n!=5498||text(pin[@"sha256"])!="1da77024874d10a94f5845a5eeea0a8a3042ce6e9b1005e8e345f009754c1f68")throw Code::content;
    s.loader.main_uri=[NSURL fileURLWithPath:[NSString stringWithUTF8String:full.c_str()]].absoluteString.UTF8String;s.loader.module_bytes=n;s.loader.module_sha256=text(pin[@"sha256"]);
   }
  }
  if(s.main.main_uri.empty()||s.loader.main_uri.empty())throw Code::content;
  r.error=s.current();return r;
 }@catch(NSException*){r.error=Code::content;if(r.owner)r.owner->p_->fail(r.error);return r;}}}catch(Code c){r.error=c;if(r.owner)r.owner->p_->fail(c);return r;}catch(...){r.error=Code::io;if(r.owner)r.owner->p_->fail(r.error);return r;}
}
PostbuildAcquisition capture_pay_postbuild_original(const RootPublicLocator&locator,const std::string&ref,const std::string&source,const void*entry,const void*marker)noexcept{
 try{return capture_pay_postbuild_impl(locator,ref,source,entry,marker);}catch(...){return{nullptr,Code::io};}
}
}
