#include "original-product-device-v4-provisioning.h"
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <CommonCrypto/CommonDigest.h>
#include <thread>
#include <unistd.h>
#include <pthread.h>
#ifdef YNX_DEVICE_PROVISION_PUBLIC_OS_TEST
extern "C" OSStatus YNXDeviceAssociationPublicAdd(CFDictionaryRef,CFTypeRef*);
extern "C" OSStatus YNXDeviceAssociationPublicCopy(CFDictionaryRef,CFTypeRef*);
extern "C" OSStatus YNXDeviceAssociationPublicUpdate(CFDictionaryRef,CFDictionaryRef);
#define AssocAdd YNXDeviceAssociationPublicAdd
#define AssocCopy YNXDeviceAssociationPublicCopy
#define AssocUpdate YNXDeviceAssociationPublicUpdate
#else
#define AssocAdd SecItemAdd
#define AssocCopy SecItemCopyMatching
#define AssocUpdate SecItemUpdate
#endif
namespace ynx_auth_private {
static NSString*const service=@"com.ynx.wallet.product-device.v4";
static void fail(const char*c){throw std::runtime_error(c);}
static bool hex64(const std::string&s){return s.size()==64&&std::all_of(s.begin(),s.end(),[](char c){return(c>='0'&&c<='9')||(c>='a'&&c<='f');});}
static NSString*ns(const std::string&s){NSString*n=[[NSString alloc]initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding];if(!n)fail("DEVICE_ASSOCIATION_UTF8");return n;}
static std::string text(NSData*d){return std::string((const char*)d.bytes,d.length);}
static NSData*bytes(const std::string&s){return[NSData dataWithBytes:s.data() length:s.size()];}
static std::string hash(const std::string&s){unsigned char h[32];CC_SHA256(s.data(),(CC_LONG)s.size(),h);const char*x="0123456789abcdef";std::string out;for(auto b:h){out+=x[b>>4];out+=x[b&15];}return out;}
static void field(NSMutableData*d,const void*p,size_t n){if(n>65536)fail("DEVICE_ASSOCIATION_BOUND");uint8_t b[4]={(uint8_t)(n>>24),(uint8_t)(n>>16),(uint8_t)(n>>8),(uint8_t)n};[d appendBytes:b length:4];[d appendBytes:p length:n];}
struct SecretDataGuard{NSMutableData*__strong data;explicit SecretDataGuard(NSMutableData*d):data(d){}~SecretDataGuard(){@try{if(data.length)[data resetBytesInRange:NSMakeRange(0,data.length)];}@catch(id){}data=nil;}};
static NSMutableDictionary*query(){LAContext*c=[LAContext new];c.interactionNotAllowed=YES;return[@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:service,(__bridge id)kSecAttrSynchronizable:@NO,(__bridge id)kSecUseDataProtectionKeychain:@YES,(__bridge id)kSecUseAuthenticationContext:c}mutableCopy];}
class KeychainDeviceAssociation final:public OriginalDeviceAssociationStore {
 std::thread::id actor_=std::this_thread::get_id();uid_t uid_=getuid();
 void actor(){if(uid_==0||getuid()!=uid_||geteuid()!=uid_||getgid()!=getegid()||std::this_thread::get_id()!=actor_||!pthread_main_np())fail("DEVICE_ASSOCIATION_ACTOR");}
 DeviceAssociationIdentity observe(NSDictionary*entry,const std::string&network){
  if(![entry isKindOfClass:NSDictionary.class]||![entry[(__bridge id)kSecAttrService]isEqual:service]||![entry[(__bridge id)kSecAttrSynchronizable]isEqual:@NO]||![entry[(__bridge id)kSecAttrAccessible]isEqual:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly])fail("DEVICE_ASSOCIATION_PROTECTION");
  NSData*r=entry[(__bridge id)kSecValuePersistentRef],*g=entry[(__bridge id)kSecAttrGeneric];NSString*a=entry[(__bridge id)kSecAttrAccount];NSDate*c=entry[(__bridge id)kSecAttrCreationDate],*m=entry[(__bridge id)kSecAttrModificationDate];if(![r isKindOfClass:NSData.class]||!r.length||r.length>4096||![g isKindOfClass:NSData.class]||g.length<4||g.length>66000||![a isKindOfClass:NSString.class]||![c isKindOfClass:NSDate.class]||![m isKindOfClass:NSDate.class])fail("DEVICE_ASSOCIATION_METADATA");
  // Generic contains PUBLIC operation+association only. No returnData query.
  const auto raw=text(g);size_t at=0;auto take=[&](){if(raw.size()-at<4)fail("DEVICE_ASSOCIATION_FRAME");uint32_t n=0;for(unsigned i=0;i<4;i++)n=(n<<8)|(uint8_t)raw[at++];if(n>65536||n>raw.size()-at)fail("DEVICE_ASSOCIATION_FRAME");auto s=raw.substr(at,n);at+=n;return s;};const auto state=take(),op=take(),association=take(),pa=take(),pb=take();if(at!=raw.size()||!hex64(op)||pa.size()!=2592||pb.size()!=64||(state!="PENDING"&&state!="REGISTERED")||(state=="PENDING"&&!association.empty())||(state=="REGISTERED"&&association.empty()))fail("DEVICE_ASSOCIATION_FRAME");DevicePairPublicView publicPair;memcpy(publicPair.pa.data(),pa.data(),pa.size());memcpy(publicPair.pb.data(),pb.data(),pb.size());
  NSData*dates=[NSPropertyListSerialization dataWithPropertyList:@[c,m] format:NSPropertyListBinaryFormat_v1_0 options:0 error:nil];if(!dates)fail("DEVICE_ASSOCIATION_DATES");return{a.UTF8String,network,[r base64EncodedStringWithOptions:0].UTF8String,association,op,[dates base64EncodedStringWithOptions:0].UTF8String,publicPair};
 }
 DeviceAssociationIdentity read(NSMutableDictionary*q,const std::string&network){actor();q[(__bridge id)kSecReturnAttributes]=@YES;q[(__bridge id)kSecReturnPersistentRef]=@YES;q[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitAll;CFTypeRef raw=nullptr;const auto rc=AssocCopy((__bridge CFDictionaryRef)q,&raw);id result=CFBridgingRelease(raw);if(rc!=errSecSuccess||![result isKindOfClass:NSArray.class]||[result count]!=1)fail("DEVICE_ASSOCIATION_READ_REFUSED");return observe([result firstObject],network);}
 static NSData*metadata(const std::string&state,const std::string&op,const std::string&association,const DeviceCreatedPair&p){NSMutableData*d=[NSMutableData data];for(const auto&s:{state,op,association})field(d,s.data(),s.size());field(d,p.pa.data(),p.pa.size());field(d,p.pb.data(),p.pb.size());return d;}
public:
 DeviceAssociationIdentity stage(const std::string&network,const std::string&op,const DeviceCreatedPair&p)override{
  actor();if(!hex64(network)||!hex64(op))fail("DEVICE_ASSOCIATION_SCOPE");const auto account="uid:"+std::to_string(uid_)+":device-provision:"+op;
  static const char magic[]="YNX-DEVICE-PROVISION-PRIVATE/v4\n";NSMutableData*secret=[NSMutableData dataWithBytes:magic length:sizeof(magic)-1];SecretDataGuard wipe(secret);for(const auto&part:{std::pair<const uint8_t*,size_t>{p.a.data(),p.a.size()},{p.b.data(),p.b.size()},{p.pa.data(),p.pa.size()},{p.pb.data(),p.pb.size()}})field(secret,part.first,part.second);
  NSMutableDictionary*q=query();q[(__bridge id)kSecAttrAccount]=ns(account);q[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;q[(__bridge id)kSecAttrGeneric]=metadata("PENDING",op,"",p);q[(__bridge id)kSecValueData]=secret;q[(__bridge id)kSecReturnPersistentRef]=@YES;CFTypeRef raw=nullptr;OSStatus rc;@try{rc=AssocAdd((__bridge CFDictionaryRef)q,&raw);}@finally{[secret resetBytesInRange:NSMakeRange(0,secret.length)];}id result=CFBridgingRelease(raw);if(rc!=errSecSuccess||![result isKindOfClass:NSData.class])fail("DEVICE_ASSOCIATION_STAGE_UNKNOWN");NSMutableDictionary*r=query();r[(__bridge id)kSecAttrAccount]=ns(account);return read(r,network);
 }
 DeviceAssociationIdentity publish(const DeviceAssociationIdentity&i,const DeviceCreatedPair&p,const RegisteredDeviceAssociation&r)override{
  actor();assertIdentity(i);if(!i.metadata.empty()||r.registrationOriginal.empty()||r.registrationOriginal.size()>16384||r.associationOriginal.empty()||r.associationOriginal.size()>65536)fail("DEVICE_ASSOCIATION_PUBLISH_INPUT");const auto account="uid:"+std::to_string(uid_)+":network:"+i.network+":registration:"+hash(r.registrationOriginal);
  static const char magic[]="YNX-PRODUCT-DEVICE-PRIVATE/v4\n";NSMutableData*secret=[NSMutableData dataWithBytes:magic length:sizeof(magic)-1];SecretDataGuard wipe(secret);field(secret,r.registrationOriginal.data(),r.registrationOriginal.size());for(const auto&part:{std::pair<const uint8_t*,size_t>{p.a.data(),p.a.size()},{p.b.data(),p.b.size()},{p.pa.data(),p.pa.size()},{p.pb.data(),p.pb.size()}})field(secret,part.first,part.second);
  NSMutableDictionary*q=query();q[(__bridge id)kSecValuePersistentRef]=[[NSData alloc]initWithBase64EncodedString:ns(i.persistentRef) options:0];q[(__bridge id)kSecAttrAccount]=ns(i.account);NSDictionary*update=@{(__bridge id)kSecAttrAccount:ns(account),(__bridge id)kSecAttrGeneric:metadata("REGISTERED",i.operation,r.associationOriginal,p),(__bridge id)kSecValueData:secret};OSStatus rc;@try{rc=AssocUpdate((__bridge CFDictionaryRef)q,(__bridge CFDictionaryRef)update);}@finally{[secret resetBytesInRange:NSMakeRange(0,secret.length)];}if(rc!=errSecSuccess)fail("DEVICE_ASSOCIATION_PUBLISH_UNKNOWN");return readPublic(i.network,hash(r.registrationOriginal));
 }
 DeviceAssociationIdentity readPublic(const std::string&network,const std::string&digest)override{actor();if(!hex64(network)||!hex64(digest))fail("DEVICE_ASSOCIATION_SCOPE");NSMutableDictionary*q=query();q[(__bridge id)kSecAttrAccount]=ns("uid:"+std::to_string(uid_)+":network:"+network+":registration:"+digest);auto i=read(q,network);if(i.metadata.empty())fail("DEVICE_ASSOCIATION_NOT_REGISTERED");return i;}
 DeviceAssociationIdentity readPendingPublic(const std::string&network,const std::string&op)override{actor();if(!hex64(network)||!hex64(op))fail("DEVICE_ASSOCIATION_SCOPE");NSMutableDictionary*q=query();q[(__bridge id)kSecAttrAccount]=ns("uid:"+std::to_string(uid_)+":device-provision:"+op);auto i=read(q,network);if(i.operation!=op||!i.metadata.empty())fail("DEVICE_ASSOCIATION_NOT_PENDING");return i;}
 void assertIdentity(const DeviceAssociationIdentity&i)override{actor();NSMutableDictionary*q=query();q[(__bridge id)kSecAttrAccount]=ns(i.account);q[(__bridge id)kSecValuePersistentRef]=[[NSData alloc]initWithBase64EncodedString:ns(i.persistentRef) options:0];auto now=read(q,i.network);if(now.account!=i.account||now.persistentRef!=i.persistentRef||now.metadata!=i.metadata||now.operation!=i.operation||now.osIdentity!=i.osIdentity||now.publicPair.pa!=i.publicPair.pa||now.publicPair.pb!=i.publicPair.pb)fail("DEVICE_ASSOCIATION_IDENTITY_CHANGED");}
};
std::shared_ptr<OriginalDeviceAssociationStore>openOriginalDeviceAssociationKeychainStore(){return std::make_shared<KeychainDeviceAssociation>();}
}
