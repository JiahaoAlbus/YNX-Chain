#include "original-product-device-v4-slot.h"
#include "original-auth-identity-source-authority.h"
#import <Security/Security.h>
#include <CommonCrypto/CommonDigest.h>
#include <thread>
#include <vector>
#include <iostream>
using namespace ynx_auth_private;
// Explicit PUBLIC Source and OS boundaries. This invokes the real slot code,
// not a model. No actual Keychain, private key, RNG or crypto is used.
static NSDictionary*publicScope=nil;static std::string mode;
static unsigned metadataReads=0,privateReads=0,sourceCloses=0;static bool swapRef=false;
@implementation YNXAuthIdentitySourceAuthority
-(BOOL)assertOriginalProductSessionDeviceV4SourceCurrent:(NSError**)error{if(mode=="source-refused"||(mode=="late-source"&&privateReads)){if(error)*error=[NSError errorWithDomain:@"PUBLIC" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PUBLIC_SOURCE_REFUSED"}];return NO;}return YES;}
-(NSDictionary*)copyOriginalProductSessionDeviceV4Scope:(NSError**)error{return[self assertOriginalProductSessionDeviceV4SourceCurrent:error]?publicScope:nil;}
-(BOOL)close:(NSError**)error{(void)error;sourceCloses++;return YES;}
@end
static void check(bool v,const char*code){if(!v)throw std::runtime_error(code);}
static NSString*hex(const void*bytes,size_t n){static const char digits[]="0123456789abcdef";std::string s;for(size_t i=0;i<n;i++){auto b=((const uint8_t*)bytes)[i];s+=digits[b>>4];s+=digits[b&15];}return[NSString stringWithUTF8String:s.c_str()];}
static std::vector<uint8_t>frame(){
 NSData*reg=[publicScope[@"registrationOriginal"]dataUsingEncoding:NSUTF8StringEncoding];std::string magic="YNX-PRODUCT-DEVICE-PRIVATE/v4\n";std::vector<uint8_t>b(magic.begin(),magic.end());
 auto put=[&](const void*p,size_t n){for(int shift=24;shift>=0;shift-=8)b.push_back((uint8_t)(n>>shift));b.insert(b.end(),(const uint8_t*)p,(const uint8_t*)p+n);};
 put(reg.bytes,reg.length);for(const auto&part:{std::pair<size_t,uint8_t>{54,1},{150,2},{2592,0x11},{64,0x22}}){std::vector<uint8_t>v(part.first,part.second);put(v.data(),v.size());}return b;
}
extern "C" OSStatus YNXProductDeviceV4SlotPublicCopy(CFDictionaryRef value,CFTypeRef*out){
 NSDictionary*q=(__bridge NSDictionary*)value;const bool priv=[q[(__bridge id)kSecReturnData]isEqual:@YES];if(priv)privateReads++;else metadataReads++;
 check([q[(__bridge id)kSecAttrService]isEqual:@"com.ynx.wallet.product-device.v4"],"ordinary namespace used");
 check([q[(__bridge id)kSecAttrSynchronizable]isEqual:@NO]&&[q[(__bridge id)kSecUseDataProtectionKeychain]isEqual:@YES]&&[q[(__bridge id)kSecUseAuthenticationUI]isEqual:(__bridge id)kSecUseAuthenticationUIFail]&&[q[(__bridge id)kSecMatchLimit]isEqual:(__bridge id)kSecMatchLimitAll]&&[q[(__bridge id)kSecReturnAttributes]isEqual:@YES]&&[q[(__bridge id)kSecReturnPersistentRef]isEqual:@YES],"OS protections weakened");
 check([q[(__bridge id)kSecAttrAccount]hasPrefix:[NSString stringWithFormat:@"uid:%u:network:",getuid()]],"kernel UID not used");
 if(mode=="missing")return errSecItemNotFound;if(mode=="cpp-exception")throw std::runtime_error("PUBLIC OS exception");
 uint8_t ref=swapRef?9:7;NSMutableDictionary*entry=[@{(__bridge id)kSecAttrService:q[(__bridge id)kSecAttrService],(__bridge id)kSecAttrAccount:q[(__bridge id)kSecAttrAccount],(__bridge id)kSecAttrSynchronizable:mode=="synchronizable"?@YES:@NO,(__bridge id)kSecAttrAccessible:mode=="wrong-access"?(__bridge id)kSecAttrAccessibleAfterFirstUnlock:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly,(__bridge id)kSecValuePersistentRef:[NSData dataWithBytes:&ref length:1],(__bridge id)kSecAttrCreationDate:[NSDate dateWithTimeIntervalSince1970:1],(__bridge id)kSecAttrModificationDate:[NSDate dateWithTimeIntervalSince1970:2]}mutableCopy];
 if(mode=="wrong-namespace")entry[(__bridge id)kSecAttrAccount]=@"account/TX/BIRTH-not-device";
 if(priv){auto bytes=frame();if(mode=="wrong-pair")bytes.back()^=1;if(mode=="truncated")bytes.pop_back();entry[(__bridge id)kSecValueData]=[NSData dataWithBytes:bytes.data() length:bytes.size()];}
 *out=CFBridgingRetain(mode=="duplicate"?@[entry,entry]:@[entry]);return mode=="partial-status"&&priv?errSecAuthFailed:errSecSuccess;
}
namespace ynx_auth_private {
// Explicit PUBLIC original-factory boundary stub. Production has no such
// exported borrower; only the future fixed Native factory is a friend.
class ProductDeviceV4Factory{public:static bool testBorrow(ProductDeviceV4Slot&s,ProductDeviceV4SlotBorrow&b,std::string&e){return s.selectOriginalPrivateBorrow(b,e);}};
}
static void reset(){mode="live";swapRef=false;metadataReads=privateReads=0;NSString*reg=[NSString stringWithFormat:@"{\"pkA\":\"%@\",\"pkB\":\"%@\"}",hex(std::vector<uint8_t>(2592,0x11).data(),2592),hex(std::vector<uint8_t>(64,0x22).data(),64)];NSData*raw=[reg dataUsingEncoding:NSUTF8StringEncoding];uint8_t digest[32];CC_SHA256(raw.bytes,(CC_LONG)raw.length,digest);publicScope=@{@"version":@"4",@"expected":@{@"networkId":hex(std::vector<uint8_t>(32,0xaa).data(),32),@"registrationDigest":hex(digest,32)},@"context":@{},@"registrationOriginal":reg,@"sessionOriginal":@"PUBLIC"};}
static void closeSlot(ProductDeviceV4Slot&s){std::string e;check(s.close(e)&&e.empty()&&s.close(e)&&e.empty(),"close first-result contract");}
int main(){@autoreleasepool{try{unsigned cases=0;std::string error;
 {reset();auto source=[YNXAuthIdentitySourceAuthority new];auto s=ProductDeviceV4Slot::acquire(source,error);check(s&&error.empty()&&privateReads==0,"acquire read private data");check(s->assertCurrent(error)&&privateReads==0,"current read private data");ProductDeviceV4SlotBorrow b;check(ProductDeviceV4Factory::testBorrow(*s,b,error)&&b.derA.length==54&&b.derB.length==150&&b.pkA.length==2592&&b.pkB.length==64&&privateReads==1,"bounded KEY7 borrow");check(!ProductDeviceV4Factory::testBorrow(*s,b,error)&&!b.derA.bytes&&privateReads==1,"private borrow repeated or stale out");closeSlot(*s);cases++;}
 for(const auto&m:{"missing","duplicate","wrong-access","synchronizable","wrong-namespace","source-refused","cpp-exception"}){reset();mode=m;auto s=ProductDeviceV4Slot::acquire([YNXAuthIdentitySourceAuthority new],error);check(s&&!error.empty()&&privateReads==0,"failed acquire lost cleanup partial");auto before=metadataReads;check(!s->assertCurrent(error)&&metadataReads==before,"failed slot reacquired");closeSlot(*s);cases++;}
 for(const auto&m:{"wrong-pair","truncated","late-source","partial-status"}){reset();auto s=ProductDeviceV4Slot::acquire([YNXAuthIdentitySourceAuthority new],error);check(s&&error.empty(),"valid acquire");mode=m;ProductDeviceV4SlotBorrow b;check(!ProductDeviceV4Factory::testBorrow(*s,b,error)&&!b.derA.bytes&&!b.derB.bytes&&!b.pkA.bytes&&!b.pkB.bytes&&privateReads==1,"private late refusal exposed spans");auto before=metadataReads;check(!ProductDeviceV4Factory::testBorrow(*s,b,error)&&privateReads==1&&metadataReads==before,"private UNKNOWN retried");closeSlot(*s);cases++;}
 {reset();auto s=ProductDeviceV4Slot::acquire([YNXAuthIdentitySourceAuthority new],error);swapRef=true;check(!s->assertCurrent(error)&&privateReads==0,"persistent identity changed");closeSlot(*s);cases++;}
 {reset();auto s=ProductDeviceV4Slot::acquire([YNXAuthIdentitySourceAuthority new],error);bool refused=false;std::thread foreign([&]{std::string e;refused=!s->assertCurrent(e)&&!s->close(e);});foreign.join();check(refused&&s->assertCurrent(error)&&privateReads==0,"foreign actor or owner corrupted");closeSlot(*s);cases++;}
 {reset();auto bytes=frame();NSData*reg=[publicScope[@"registrationOriginal"]dataUsingEncoding:NSUTF8StringEncoding];std::vector<uint8_t>a(2592,0x11),b(64,0x22);ProductDeviceV4SlotBorrow out;check(borrowOriginalProductDeviceV4SlotRecord(bytes.data(),bytes.size(),reg.bytes,reg.length,a.data(),b.data(),out),"record parse");for(size_t n=0;n<bytes.size();n++){out.derA={(const uint8_t*)1,54};check(!borrowOriginalProductDeviceV4SlotRecord(bytes.data(),n,reg.bytes,reg.length,a.data(),b.data(),out)&&!out.derA.bytes&&!out.registration.bytes,"truncation accepted or stale out");}bytes.push_back(0);check(!borrowOriginalProductDeviceV4SlotRecord(bytes.data(),bytes.size(),reg.bytes,reg.length,a.data(),b.data(),out),"trailing record accepted");cases++;}
 check(sourceCloses==0,"borrowed Source was closed");std::cout<<"PASS"<<cases<<" actual device slot/metadata/private-once/custody controls; explicit PUBLIC Source+Keychain/factory boundaries only\n";return 0;
}catch(const std::exception&e){std::cerr<<"FAIL "<<e.what()<<"\n";return 1;}}}
