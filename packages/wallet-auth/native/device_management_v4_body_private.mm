#include "device_management_v4_body_private.hpp"
#include <CommonCrypto/CommonDigest.h>
#include <cstring>
namespace ynx::device::management {
static void fail(const char*c){throw std::runtime_error(c);}
static NSString*text(const std::string&s){NSString*v=[[NSString alloc]initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding];if(!v)fail("DEVICE_MANAGEMENT_V4_UTF8");return v;}
static NSData*canonical(id v){return[NSJSONSerialization dataWithJSONObject:v options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];}
static bool exact(NSDictionary*v,NSArray*keys){return[v isKindOfClass:NSDictionary.class]&&v.count==keys.count&&[[NSSet setWithArray:v.allKeys]isEqual:[NSSet setWithArray:keys]];}
static std::string digest(NSData*d){unsigned char h[32];CC_SHA256(d.bytes,(CC_LONG)d.length,h);const char*x="0123456789abcdef";std::string out;for(auto b:h){out+=x[b>>4];out+=x[b&15];}return out;}
static bool equal_original(id value,const std::string&raw){NSData*bytes=canonical(value);return bytes&&bytes.length==raw.size()&&!memcmp(bytes.bytes,raw.data(),raw.size());}
CapturedBodyDATA capture_original_management_body_data(NSData*input,const OriginalBindingDATA&b){
 assert_binding_role(b.operation,b.provenance,b.session_binding);
 if(![input isKindOfClass:NSData.class]||!input.length||input.length>body_max)fail("DEVICE_MANAGEMENT_V4_BODY_BOUND");
 NSData*owned=[NSData dataWithBytes:input.bytes length:input.length];NSDictionary*v=[NSJSONSerialization JSONObjectWithData:owned options:0 error:nil];
 NSArray*keys=nil;switch(b.operation){case Operation::active:keys=@[@"request",@"registrationOriginal",@"account",@"sessionBinding"];break;case Operation::recover:keys=@[@"request",@"registrationOriginal",@"account",@"operationId"];break;case Operation::revoke:keys=@[@"operationId",@"request",@"registrationOriginal",@"account",@"sessionBinding"];break;case Operation::cancel:keys=@[@"operationId",@"request",@"registrationOriginal",@"account",@"challengeId"];break;}
 if(!exact(v,keys)||![canonical(v)isEqual:owned]||!equal_original(v[@"request"],b.request_original)||![v[@"registrationOriginal"]isEqual:text(b.registration_original)])fail("DEVICE_MANAGEMENT_V4_BODY_ORIGINAL_BINDING");
 NSDictionary*registration=[NSJSONSerialization JSONObjectWithData:[text(b.registration_original)dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
 if(![registration isKindOfClass:NSDictionary.class]||b.source_account.empty()||![v[@"account"]isEqual:text(b.source_account)])fail("DEVICE_MANAGEMENT_V4_ACCOUNT_BINDING");
 if(b.operation==Operation::active||b.operation==Operation::revoke){if(![v[@"sessionBinding"]isEqual:text(b.session_binding)])fail("DEVICE_MANAGEMENT_V4_SESSION_BINDING");}
 if(b.operation==Operation::recover){if(b.original_operation.empty()||![v[@"operationId"]isEqual:text(b.original_operation)])fail("DEVICE_MANAGEMENT_V4_ORIGINAL_OPERATION_BINDING");}
 if(b.operation==Operation::cancel){if(b.challenge_id.empty()||![v[@"challengeId"]isEqual:text(b.challenge_id)])fail("DEVICE_MANAGEMENT_V4_ORIGINAL_CHALLENGE_BINDING");}
 if(b.operation!=Operation::active&&(![v[@"operationId"]isKindOfClass:NSString.class]||[v[@"operationId"]length]<8||[v[@"operationId"]length]>128))fail("DEVICE_MANAGEMENT_V4_OPERATION_ID");
 return{b.operation,owned,v,digest(owned)};
}
NSDictionary*validate_original_management_unsigned_data(NSData*input,const CapturedBodyDATA&body,const OriginalBindingDATA&b){
 assert_binding_role(b.operation,b.provenance,b.session_binding);
 if(body.operation!=b.operation||![input isKindOfClass:NSData.class]||!input.length||input.length>unsigned_max)fail("DEVICE_MANAGEMENT_V4_UNSIGNED_BOUND");
 NSDictionary*u=[NSJSONSerialization JSONObjectWithData:input options:0 error:nil];NSArray*keys=@[@"version",@"sessionBinding",@"productId",@"clientId",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"account",@"canonicalOwner",@"deviceId",@"deviceRegistrationId",@"deviceRegistrationRevision",@"deviceRegistrationDigest",@"method",@"path",@"bodyDigest",@"nonce",@"issuedAt",@"expiresAt"];
 if(!exact(u,keys)||![canonical(u)isEqual:input]||![u[@"version"]isEqual:@"4"]||![u[@"method"]isEqual:@"POST"]||![u[@"path"]isEqual:[NSString stringWithUTF8String:path(b.operation)]]||![u[@"sessionBinding"]isEqual:text(b.session_binding)]||![u[@"bodyDigest"]isEqual:text(body.digest)]||![u[@"account"]isEqual:body.value[@"account"]])fail("DEVICE_MANAGEMENT_V4_UNSIGNED_BODY_BINDING");
 NSDictionary*r=[NSJSONSerialization JSONObjectWithData:[text(b.registration_original)dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
 for(NSString*k in @[@"productId",@"clientId",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"canonicalOwner",@"deviceId"])if(![u[k]isEqual:r[k]])fail("DEVICE_MANAGEMENT_V4_REGISTERED_IDENTITY_BINDING");
 for(auto p:{std::pair<NSString*,NSString*>{@"deviceRegistrationId",@"registrationId"},{@"deviceRegistrationRevision",@"revision"}})if(![u[p.first]isEqual:r[p.second]])fail("DEVICE_MANAGEMENT_V4_REGISTERED_REVISION_BINDING");
 if(![u[@"deviceRegistrationDigest"]isEqual:text(digest([text(b.registration_original)dataUsingEncoding:NSUTF8StringEncoding]))])fail("DEVICE_MANAGEMENT_V4_REGISTRATION_DIGEST");
 return u;
}
}
