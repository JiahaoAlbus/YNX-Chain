#include "original-product-device-v5-factory.h"
#include "original-product-device-v5-transport.h"
#include "original-product-device-v5-slot.h"
#include "original-product-device-v5-http-call.h"
#include "original-product-device-v5-unsigned.h"
#include "original-http-v5-registered-private.h"
#import <Security/Security.h>
#include <thread>
#include <pthread.h>
#include <chrono>
#include <cmath>
namespace ynx_auth_private {
static uint64_t v5FactoryClock(bool mono){return mono?(uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count():(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);}
static std::string v5FactoryText(id value,size_t maximum){if(![value isKindOfClass:NSString.class])throw std::runtime_error("DEVICE_V5_FACTORY_STRING");NSData*b=[value dataUsingEncoding:NSUTF8StringEncoding];if(!b.length||b.length>maximum)throw std::runtime_error("DEVICE_V5_FACTORY_STRING");return std::string((const char*)b.bytes,b.length);}
static uint64_t v5FactoryNumber(id value){if(![value isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)value)==CFBooleanGetTypeID())throw std::runtime_error("DEVICE_V5_FACTORY_NUMBER");double n=[value doubleValue];if(!std::isfinite(n)||n<1||n>9007199254740991.0||std::floor(n)!=n)throw std::runtime_error("DEVICE_V5_FACTORY_NUMBER");return(uint64_t)n;}
static uint64_t v5FactoryDecimal(id value){const auto text=v5FactoryText(value,8);if(text[0]=='0')throw std::runtime_error("DEVICE_V5_FACTORY_BODY_LIMIT");uint64_t n=0;for(char c:text){if(c<'0'||c>'9')throw std::runtime_error("DEVICE_V5_FACTORY_BODY_LIMIT");n=n*10+c-'0';}if(!n||n>68288512)throw std::runtime_error("DEVICE_V5_FACTORY_BODY_LIMIT");return n;}
template<size_t N>static std::array<uint8_t,N>v5FactoryHex(id value){const auto text=v5FactoryText(value,N*2);if(text.size()!=N*2)throw std::runtime_error("DEVICE_V5_FACTORY_HEX");std::array<uint8_t,N>out{};auto nibble=[](char c){if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;throw std::runtime_error("DEVICE_V5_FACTORY_HEX");};for(size_t i=0;i<N;i++)out[i]=(uint8_t)((nibble(text[2*i])<<4)|nibble(text[2*i+1]));return out;}
struct ProductDeviceV5ProofOperation::Impl {
    YNXAuthIdentitySourceAuthority *__strong source=nil;
    ProductDeviceV5Transport *transport=nullptr; // NAPI owner must retain it.
    NSDictionary *__strong scope=nil;NSData *__strong unsignedOriginal=nil;
    std::shared_ptr<OriginalHTTPV5RegisteredReadLease> lease;
    HTTPV5RegisteredOriginalView registered;
    std::unique_ptr<ProductDeviceV5Slot> slot;
    HostDirfdJournal journal;std::unique_ptr<ProductDeviceV5Once> once;
    ProductDeviceV5HTTPOutcomeDATA outcome;
    std::thread::id actor=std::this_thread::get_id();
    uint64_t sourceDeadline=0,issued=0,expires=0,wallFloor=0,monoAnchor=0,wallAnchor=0;
    bool registeredCaptured=false,done=false,retired=false,closeSelected=false,closed=false;
    std::string first,closeCause;
    bool fail(const char*code,std::string&error){if(first.empty())first=code;error=first;return false;}
    bool originalActor(std::string&error){if(actor!=std::this_thread::get_id()||!pthread_main_np()){error="DEVICE_V5_FACTORY_ORIGINAL_ACTOR_REQUIRED";return false;}return true;}
    bool current(std::string&error){
        if(!originalActor(error))return false;if(!first.empty()){error=first;return false;}
        if(retired||closeSelected||[source class]!=YNXAuthIdentitySourceAuthority.class)return fail("DEVICE_V5_FACTORY_ORIGINAL_SOURCE_REQUIRED",error);
        NSError*cause=nil;if(![source assertOriginalProductSessionHTTPProofV5SourceCurrent:&cause]||cause)return fail("DEVICE_V5_FACTORY_SOURCE_NOT_CURRENT",error);
        NSDictionary*next=[source copyOriginalProductSessionHTTPProofV5Scope:&cause];
        if(cause||![next isKindOfClass:NSDictionary.class]||next.count!=8||![next[@"version"]isEqual:@"5"])return fail("DEVICE_V5_FACTORY_SCOPE_REQUIRED",error);
        if(scope){for(NSString*key in @[@"version",@"targetURL",@"networkId",@"pkA",@"pkB",@"identity",@"maxBodyBytes"])if(![scope[key]isEqual:next[key]])return fail("DEVICE_V5_FACTORY_SCOPE_CHANGED",error);}else scope=[next copy];
        const auto end=v5FactoryNumber(next[@"expiresAtMs"]);sourceDeadline=sourceDeadline?std::min(sourceDeadline,end):end;
        if(expires&&expires>sourceDeadline)return fail("DEVICE_V5_FACTORY_ORIGINAL_WINDOW_SHRANK",error);
        if(lease){lease->assertCurrent();const auto&view=lease->readOriginalRegisteredView();if(registeredCaptured&&(view.registrationOriginal!=registered.registrationOriginal||view.sessionOriginal!=registered.sessionOriginal||view.sameItem.persistentRef!=registered.sameItem.persistentRef||view.sameItem.account!=registered.sameItem.account||view.sameItem.network!=registered.sameItem.network||view.sameItem.metadata!=registered.sameItem.metadata||view.sameItem.operation!=registered.sameItem.operation||view.sameItem.osIdentity!=registered.sameItem.osIdentity||view.sameItem.publicPair.pa!=registered.sameItem.publicPair.pa||view.sameItem.publicPair.pb!=registered.sameItem.publicPair.pb||![view.context isEqual:registered.context]))return fail("DEVICE_V5_FACTORY_REGISTERED_ORIGINAL_CHANGED",error);}
        return true;
    }
    bool time(std::string&error){const auto wall=v5FactoryClock(false),mono=v5FactoryClock(true);if(!issued||expires<=issued||wall<wallFloor||wall<issued||wall>=expires||mono<monoAnchor||UINT64_MAX-wallAnchor<mono-monoAnchor||wallAnchor+mono-monoAnchor>=expires)return fail("DEVICE_V5_FACTORY_ORIGINAL_WINDOW_EXPIRED",error);wallFloor=wall;return true;}
};
ProductDeviceV5ProofOperation::ProductDeviceV5ProofOperation():impl_(new Impl){}
bool ProductDeviceV5Factory::current(ProductDeviceV5ProofOperation&op,std::string&error){auto&p=*op.impl_;if(!p.current(error))return false;if(!p.transport||!p.transport->assertCurrentForFactory(p.source))return p.fail("DEVICE_V5_FACTORY_SAME_TRANSPORT_NOT_CURRENT",error);return true;}
std::unique_ptr<ProductDeviceV5ProofOperation>ProductDeviceV5Factory::produce(YNXAuthIdentitySourceAuthority*source,ProductDeviceV5Transport&transport,std::string&error){
    error.clear();std::unique_ptr<ProductDeviceV5ProofOperation>op;
    try{@try{
        op.reset(new ProductDeviceV5ProofOperation);auto&p=*op->impl_;p.source=source;p.transport=&transport;p.first.reserve(256);p.closeCause.reserve(256);
        if(!current(*op,error))return op;
        NSError*cause=nil;p.lease=[source borrowOriginalProductSessionHTTPProofV5RegisteredReadLease:&cause]; // adopt before NSError
        if(cause||!p.lease){p.fail("DEVICE_V5_FACTORY_REGISTERED_LEASE_UNAVAILABLE",error);return op;}
        p.registered=p.lease->readOriginalRegisteredView();p.registeredCaptured=true;if(!current(*op,error))return op;
        NSDictionary*metadata=transport.readonlyMetadataDATA(),*bodyDATA=transport.originalBodyBindingDATA();auto body=transport.borrowOriginalBodyForFactory(source);
        if(!body||!body->length()||body->length()>v5FactoryDecimal(p.scope[@"maxBodyBytes"])||![metadata[@"url"]isEqual:p.scope[@"targetURL"]]||![metadata[@"method"]isEqual:@"POST"]||![metadata[@"path"]isEqual:@"/api/v1/ide/deployments"]){p.fail("DEVICE_V5_FACTORY_ORIGINAL_TARGET_OR_BODY",error);return op;}
        NSDictionary*identity=p.scope[@"identity"];ProductDeviceV5OnceBindingDATA binding;
        binding.network=v5FactoryHex<32>(p.scope[@"networkId"]);binding.session=v5FactoryHex<32>(identity[@"sessionBinding"]);binding.registration=v5FactoryHex<32>(identity[@"deviceRegistrationDigest"]);binding.canonicalOwner=v5FactoryText(identity[@"canonicalOwner"],42);
        binding.pkA=v5FactoryHex<2592>(p.scope[@"pkA"]);binding.pkB=v5FactoryHex<64>(p.scope[@"pkB"]);
        if(p.registered.sameItem.publicPair.pa!=binding.pkA||p.registered.sameItem.publicPair.pb!=binding.pkB||p.registered.sameItem.network!=v5FactoryText(p.scope[@"networkId"],64)){p.fail("DEVICE_V5_FACTORY_SAME_REGISTERED_PAIR",error);return op;}
        std::array<uint8_t,32>nonce{};if(SecRandomCopyBytes(kSecRandomDefault,nonce.size(),nonce.data())!=errSecSuccess){p.fail("DEVICE_V5_FACTORY_ORIGINAL_NONCE_UNAVAILABLE",error);return op;}
        NSString*originalNonce=[[[[NSData dataWithBytes:nonce.data() length:nonce.size()]base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"];originalNonce=[originalNonce stringByReplacingOccurrencesOfString:@"=" withString:@""];binding.nonce=v5FactoryText(originalNonce,64);
        p.issued=p.wallFloor=p.wallAnchor=v5FactoryClock(false);p.monoAnchor=v5FactoryClock(true);if(p.issued>=p.sourceDeadline||UINT64_MAX-p.issued<30000){p.fail("DEVICE_V5_FACTORY_ORIGINAL_WINDOW_EXPIRED",error);return op;}p.expires=std::min(p.issued+30000,p.sourceDeadline);
        p.unsignedOriginal=composeProductDeviceV5UnsignedDATA(identity,bodyDATA,body->length(),metadata[@"contentType"],originalNonce,p.issued,p.expires,error);
        if(!p.unsignedOriginal){p.fail("DEVICE_V5_FACTORY_ORIGINAL_UNSIGNED_REFUSED",error);return op;}
        if(!current(*op,error)||!p.time(error))return op;NSDictionary*selection=[source copyOriginalSelection:&cause];
        if(cause||![selection[@"originalHostTerminalDirectory"]isKindOfClass:NSString.class]){p.fail("DEVICE_V5_FACTORY_SOURCE_JOURNAL_REQUIRED",error);return op;}
        const auto session=v5FactoryText(identity[@"sessionBinding"],64);p.journal.open([selection[@"originalHostTerminalDirectory"]UTF8String],"device-v5-http-"+session);
        NSData*type=[metadata[@"contentType"]dataUsingEncoding:NSUTF8StringEncoding];
        p.once=std::make_unique<ProductDeviceV5Once>(p.journal,binding,YNXProductSessionHTTPBytesV5{(const uint8_t*)p.registered.registrationOriginal.data(),p.registered.registrationOriginal.size()},YNXProductSessionHTTPBytesV5{(const uint8_t*)p.unsignedOriginal.bytes,p.unsignedOriginal.length},YNXProductSessionHTTPBytesV5{(const uint8_t*)body->bytes(),body->length()},YNXProductSessionHTTPBytesV5{(const uint8_t*)type.bytes,type.length});p.once->reserve();
        if(!current(*op,error)||!p.time(error))return op;
        p.slot=ProductDeviceV5Slot::acquire(source,error);if(!p.slot||!error.empty()){p.fail("DEVICE_V5_FACTORY_PRIVATE_SLOT_UNAVAILABLE",error);return op;}
        ProductDeviceV4SlotBorrow privateBorrow;if(!p.slot->selectOriginalPrivateBorrow(privateBorrow,error)){p.fail("DEVICE_V5_FACTORY_PRIVATE_BORROW_REFUSED",error);return op;}
        if(!current(*op,error)||!p.time(error)||!p.slot->assertCurrent(error)){p.fail("DEVICE_V5_FACTORY_PRE_ENTRY_CURRENT_REFUSED",error);return op;}
        YNXProductSessionHTTPRequestV5 request{};request.version=5;request.struct_size=sizeof(request);
        request.unsigned_original={(const uint8_t*)p.unsignedOriginal.bytes,p.unsignedOriginal.length};request.actual_body={(const uint8_t*)body->bytes(),body->length()};request.actual_content_type={(const uint8_t*)type.bytes,type.length};
        request.expected={{binding.network.data(),binding.network.size()},{(const uint8_t*)binding.canonicalOwner.data(),binding.canonicalOwner.size()},{binding.pkA.data(),binding.pkA.size()},{binding.pkB.data(),binding.pkB.size()}};
        request.pkcs8_a={privateBorrow.derA.bytes,privateBorrow.derA.length};request.pkcs8_b={privateBorrow.derB.bytes,privateBorrow.derB.length};request.pk_a={privateBorrow.pkA.bytes,privateBorrow.pkA.length};request.pk_b={privateBorrow.pkB.bytes,privateBorrow.pkB.length};
        p.outcome=invokeOriginalProductDeviceV5HTTPBorrow(*p.once,request); // retain before result/current/cleanup
        if(!p.outcome.mathCompleted){p.fail("DEVICE_V5_FACTORY_CORE_OR_PERSISTENCE_UNKNOWN",error);return op;}
        if(!current(*op,error)||!p.time(error)||!p.slot->assertCurrent(error)){p.fail("DEVICE_V5_FACTORY_POST_ENTRY_CURRENT_REFUSED",error);return op;}
        if(!p.slot->close(error)){p.fail("DEVICE_V5_FACTORY_PRIVATE_CLOSE_UNKNOWN",error);return op;}
        if(!current(*op,error)||!p.time(error))return op;p.done=true;return op;
    }@catch(id){if(op)op->impl_->fail("DEVICE_V5_FACTORY_NATIVE_EXCEPTION_UNKNOWN",error);else error="DEVICE_V5_FACTORY_NATIVE_EXCEPTION_UNKNOWN";return op;}}
    catch(...){if(op)op->impl_->fail("DEVICE_V5_FACTORY_CPP_EXCEPTION_UNKNOWN",error);else error="DEVICE_V5_FACTORY_CPP_EXCEPTION_UNKNOWN";return op;}
}
std::vector<unsigned char>ProductDeviceV5ProofOperation::copyOriginalMemberDATA()const{if(impl_->actor!=std::this_thread::get_id())throw std::runtime_error("DEVICE_V5_FACTORY_ORIGINAL_ACTOR_REQUIRED");return impl_->outcome.member;}
NSData*ProductDeviceV5ProofOperation::copyOriginalUnsignedDATA()const{if(impl_->actor!=std::this_thread::get_id())throw std::runtime_error("DEVICE_V5_FACTORY_ORIGINAL_ACTOR_REQUIRED");return[impl_->unsignedOriginal copy];}
ProductDeviceV5ProofStatusDATA ProductDeviceV5ProofOperation::copyOriginalStatusDATA()const{const auto&p=*impl_;if(p.actor!=std::this_thread::get_id())throw std::runtime_error("DEVICE_V5_FACTORY_ORIGINAL_ACTOR_REQUIRED");return{p.outcome.result,p.outcome.cleanup,p.outcome.reportedLength,p.outcome.primitiveCalled,p.outcome.terminalRecorded,p.outcome.mathCompleted,(bool)p.outcome.persistenceFailure};}
bool ProductDeviceV5ProofOperation::assertCurrent(std::string&error){try{@try{auto&p=*impl_;if(!p.done)return p.fail("DEVICE_V5_FACTORY_OUTCOME_UNKNOWN",error);return ProductDeviceV5Factory::current(*this,error)&&p.time(error);}@catch(id){return impl_->fail("DEVICE_V5_FACTORY_CURRENT_EXCEPTION",error);}}catch(...){return impl_->fail("DEVICE_V5_FACTORY_CURRENT_CPP_EXCEPTION",error);}}
void ProductDeviceV5ProofOperation::retire(){if(impl_->actor==std::this_thread::get_id())impl_->retired=true;}
bool ProductDeviceV5ProofOperation::join(std::string&error){if(!impl_->originalActor(error))return false;if(!impl_->retired){error="DEVICE_V5_FACTORY_RETIRE_BEFORE_JOIN";return false;}return true;}
bool ProductDeviceV5ProofOperation::close(std::string&error){auto&p=*impl_;if(p.closeSelected){error=p.closeCause;return p.closed;}if(!p.originalActor(error))return false;p.closeSelected=true;p.retired=true;
    try{@try{bool ok=true;std::string cause;if(p.slot&&!p.slot->close(cause))ok=false;if(p.lease){p.lease->retire();if(!p.lease->close())ok=false;}if(!p.journal.close())ok=false;if(!ok){p.closeCause="DEVICE_V5_FACTORY_CLOSE_UNKNOWN";error=p.closeCause;return false;}p.lease.reset();p.source=nil;p.scope=nil;p.transport=nullptr;p.closed=true;error.clear();return true;}@catch(id){p.closeCause="DEVICE_V5_FACTORY_CLOSE_EXCEPTION_UNKNOWN";}}
    catch(...){p.closeCause="DEVICE_V5_FACTORY_CLOSE_CPP_UNKNOWN";}error=p.closeCause;return false;
}
ProductDeviceV5ProofOperation::~ProductDeviceV5ProofOperation(){std::string error;if(!close(error)){static thread_local std::vector<Impl*>debt;debt.push_back(impl_.release());}}
}
