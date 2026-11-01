#include "product_pay_resource_private.hpp"
#include "archive_read_contract.hpp"
#import <Foundation/Foundation.h>
#include <mutex>
#include <unordered_set>
#include <limits>
#include <atomic>
namespace ynx::wallet::product {
namespace {
using namespace ynx::wallet::pay::root_physical;
uint64_t wall(){return(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);}
bool exact(NSDictionary*v,NSArray*k){return[v isKindOfClass:NSDictionary.class]&&v.count==k.count&&[[NSSet setWithArray:v.allKeys]isEqual:[NSSet setWithArray:k]];}
std::string text(id v,size_t max=512){if(![v isKindOfClass:NSString.class])throw 1;NSData*b=[v dataUsingEncoding:NSUTF8StringEncoding];if(!b.length||b.length>max||memchr(b.bytes,0,b.length))throw 1;return{(const char*)b.bytes,b.length};}
uint64_t number(id v,uint64_t min,uint64_t max){if(![v isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)v)==CFBooleanGetTypeID())throw 1;double d=[v doubleValue];uint64_t n=[v unsignedLongLongValue];if(d!=double(n)||n<min||n>max)throw 1;return n;}
bool decimal(const std::string&s){if(s.empty()||s.size()>20||s[0]=='0')return false;uint64_t n=0;for(char c:s){if(c<'0'||c>'9'||n>(UINT64_MAX-uint64_t(c-'0'))/10)return false;n=n*10+uint64_t(c-'0');}return n>0;}
ProductPayResourceProfileDATA decode(const std::vector<unsigned char>&bytes,const ProductScopeDATA&scope){
 NSData*raw=[NSData dataWithBytes:bytes.data() length:bytes.size()];NSDictionary*v=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
 if(!exact(v,@[@"version",@"protectedResourceRef",@"networkId",@"account",@"epoch",@"origin",@"socket",@"service",@"peerUID",@"peerPID",@"timeoutMs",@"maxHeaderBytes",@"maxResponseBytes",@"operations"])||number(v[@"version"],1,1)!=1)throw 1;
 NSData*again=[NSJSONSerialization dataWithJSONObject:v options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(![again isEqualToData:raw])throw 1; // closed canonical DATA, duplicate/noncanonical denied
 ProductPayResourceProfileDATA p;p.resource_ref=text(v[@"protectedResourceRef"],128);p.network_id=text(v[@"networkId"],64);p.account=text(v[@"account"],42);p.epoch=text(v[@"epoch"],20);
 if(p.resource_ref!=scope.protected_resource_ref||p.network_id!=scope.network_id||p.account!=scope.account||!decimal(p.epoch))throw 1;
 p.origin=text(v[@"origin"],2048);NSURLComponents*u=[NSURLComponents componentsWithString:v[@"origin"]];
 BOOL local=[@[@"localhost",@"127.0.0.1",@"[::1]",@"::1"]containsObject:u.host];
 if(!u.host.length||u.user||u.password||u.path.length||u.query||u.fragment||!([u.scheme isEqual:@"https"]||([u.scheme isEqual:@"http"]&&local))||![u.URL.absoluteString isEqual:v[@"origin"]])throw 1;
 p.socket=text(v[@"socket"],103);p.service=text(v[@"service"],128);if(p.socket[0]!='/'||p.socket.find("/../")!=std::string::npos||!archive_data::identifier(p.service))throw 1;
 p.peer_uid=uint32_t(number(v[@"peerUID"],1,UINT32_MAX));p.peer_pid=int32_t(number(v[@"peerPID"],2,INT32_MAX));
 p.timeout_ms=number(v[@"timeoutMs"],1,30000);p.max_header_bytes=number(v[@"maxHeaderBytes"],1,65536);p.max_response_bytes=number(v[@"maxResponseBytes"],1,1<<20);
 NSArray*ops=v[@"operations"];if(![ops isKindOfClass:NSArray.class]||!ops.count||ops.count>14)throw 1;std::unordered_set<std::string>seen;
 for(id x in ops){auto op=text(x,128);if(!archive_data::known_operation(op)||!seen.insert(op).second)throw 1;
  // Root registration can be broader than this particular signed scope, but
  // only the explicit intersection becomes usable for this actual owner.
  if(archive_data::declared_operation_DATA(scope.operations,op))p.operations.push_back(op);
 }if(p.operations.empty())throw 1;return p;
}
}
struct ProductPayResourceRoot::Impl {
 std::mutex mutex;std::shared_ptr<OriginalProductRoot>root;ProductScopeDATA scope;
 std::unique_ptr<PublicOriginalHold>record;ProductPayResourceProfileDATA profile;
 bool retired=false,closed=false;int32_t first=0,close_error=0;
 std::atomic<bool>local_retired{false},initialized{false};
 int32_t fail(int32_t c){if(!first)first=c;retired=true;local_retired.store(true,std::memory_order_release);return first;}
 int32_t current(){if(first||retired||closed)return first?first:1;
  if(!root||recheck_original_product_root(root)!=0||!record||record->current_code_only()!=Code::ok)return fail(1);
  ProductScopeDATA now;if(read_original_product_scope(root,now)!=0||now.network_id!=scope.network_id||now.account!=scope.account||now.protected_resource_ref!=scope.protected_resource_ref||now.operations!=scope.operations||now.products!=scope.products)return fail(1);
  return 0;
 }
};
ProductPayResourceRoot::ProductPayResourceRoot(std::unique_ptr<Impl>s):impl_(std::move(s)){}
ProductPayResourceRoot::~ProductPayResourceRoot(){if(impl_&&!impl_->closed){
 // Actual original partial is kept, never implicit close/reopen on GC.
 static auto*debt=new std::vector<std::unique_ptr<Impl>>;static auto*lock=new std::mutex;
 std::lock_guard<std::mutex>l(*lock);debt->push_back(std::move(impl_));}}
ProductPayResourceRoot::Acquisition ProductPayResourceRoot::capture(const std::shared_ptr<OriginalProductRoot>&root)noexcept{
 Acquisition out{{},1};try{@autoreleasepool{@try{auto s=std::make_unique<Impl>();s->root=root;out.owner=std::unique_ptr<ProductPayResourceRoot>(new ProductPayResourceRoot(std::move(s)));auto&p=*out.owner->impl_;
  if(!root||read_original_product_scope(root,p.scope)!=0)return out;
  const ProductPayResourceRelease*selected=nullptr;for(const auto&r:original_product_pay_resource_releases())if(r.protected_resource_ref==p.scope.protected_resource_ref){if(selected)return out;selected=&r;}
  if(!selected)return out;
  auto locator=selected->locator;const uint64_t now=wall();locator.not_before_ms=now;locator.expires_ms=now+5000;locator.maximum_bytes=32768;
  // Fixed locator/Root0 parent supplied ONLY by the independent reviewed row;
  // tuple/hash capture is fresh per owner, not compiled ephemeral checkpoint.
  auto captured=capture_root_public_original(locator);p.record=std::move(captured.owner);
  if(captured.error!=Code::ok||!p.record)return out;
  std::vector<unsigned char>raw;if(p.record->read_original(raw)!=Code::ok)return out;p.profile=decode(raw,p.scope);
  out.error=p.current();if(out.error==0)p.initialized.store(true,std::memory_order_release);return out;
 }@catch(NSException*){return out;}}}catch(...){return out;}
}
int32_t ProductPayResourceRoot::current()noexcept{try{std::lock_guard<std::mutex>l(impl_->mutex);return impl_->current();}catch(...){return impl_->fail(1);}}
int32_t ProductPayResourceRoot::current_no_io()const noexcept{return !impl_||!impl_->initialized.load(std::memory_order_acquire)||impl_->local_retired.load(std::memory_order_acquire)?1:0;}
int32_t ProductPayResourceRoot::copy_profile_DATA(ProductPayResourceProfileDATA&out)noexcept{
 try{std::lock_guard<std::mutex>l(impl_->mutex);if(impl_->current())return 1;auto copy=impl_->profile;if(impl_->current())return 1;out=std::move(copy);return 0;}catch(...){return impl_->fail(1);}
}
void ProductPayResourceRoot::retire()noexcept{impl_->local_retired.store(true,std::memory_order_release);std::lock_guard<std::mutex>l(impl_->mutex);impl_->retired=true;if(impl_->record)impl_->record->retire();}
int32_t ProductPayResourceRoot::close()noexcept{impl_->local_retired.store(true,std::memory_order_release);std::lock_guard<std::mutex>l(impl_->mutex);impl_->retired=true;
 if(impl_->closed)return impl_->close_error;if(impl_->record){auto c=impl_->record->close();if(!impl_->record->closed()){if(!impl_->close_error)impl_->close_error=1;return impl_->close_error;}if(c!=Code::ok&&!impl_->close_error)impl_->close_error=1;impl_->record.reset();}
 impl_->root.reset();impl_->closed=true;return impl_->close_error;
}
bool ProductPayResourceRoot::closed()const noexcept{std::lock_guard<std::mutex>l(impl_->mutex);return impl_->closed;}
}
