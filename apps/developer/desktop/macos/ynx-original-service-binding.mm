#import "ynx-original-service-binding.h"
#import <node_api.h>
#include <string>

static NSError *YNXServiceInputError(NSString *code) {
    return [NSError errorWithDomain:@"YNXOriginalServiceBinding" code:1
        userInfo:@{NSLocalizedDescriptionKey:code}];
}
@implementation YNXOriginalServiceRequest {
    NSString *_raw,*_requestID,*_operation,*_phase;
}
+ (instancetype)captureCanonicalInput:(NSString *)raw error:(NSError **)error {
    // NSError out-parameters share the caller pool. An inner pool would
    // release an autoreleased error before the caller can retain it.
        NSData *bytes=[raw isKindOfClass:NSString.class]?[raw dataUsingEncoding:NSUTF8StringEncoding]:nil;
        if(!bytes||bytes.length>65536){if(error)*error=YNXServiceInputError(@"ORIGINAL_PRIVATE_CAPACITY");return nil;}
        id input=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
        NSSet *fields=[NSSet setWithArray:@[@"requestId",@"operation",@"phase",@"body",@"proofHeader"]];
        if(![input isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:[input allKeys]] isEqual:fields]){
            if(error)*error=YNXServiceInputError(@"ORIGINAL_PRIVATE_REQUEST_INVALID");return nil;
        }
        NSString *request=input[@"requestId"],*operation=input[@"operation"],*phase=input[@"phase"];
        NSRegularExpression *pattern=[NSRegularExpression regularExpressionWithPattern:@"^req_[A-Za-z0-9_-]{12,80}$" options:0 error:nil];
        if(![request isKindOfClass:NSString.class]||[pattern numberOfMatchesInString:request options:0 range:NSMakeRange(0,request.length)]!=1
            ||![@[@"beginYNX",@"handleReturn",@"restore",@"disconnect"] containsObject:operation]
            ||![@[@"time",@"effect"] containsObject:phase]){
            if(error)*error=YNXServiceInputError(@"ORIGINAL_PRIVATE_REQUEST_INVALID");return nil;
        }
        id body=input[@"body"],proof=input[@"proofHeader"];
        BOOL valid=[phase isEqual:@"time"]?(body==NSNull.null&&proof==NSNull.null):
            ([body isKindOfClass:NSString.class]&&[[body dataUsingEncoding:NSUTF8StringEncoding] length]<=49152
             &&(proof==NSNull.null||([proof isKindOfClass:NSString.class]&&[[proof dataUsingEncoding:NSUTF8StringEncoding] length]<=16384)));
        if(!valid){if(error)*error=YNXServiceInputError(@"ORIGINAL_PRIVATE_REQUEST_INVALID");return nil;}
        // This roundtrip checks canonical transport, not signatures or grants.
        NSData *canonical=[NSJSONSerialization dataWithJSONObject:input options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
        if(![canonical isEqual:bytes]){if(error)*error=YNXServiceInputError(@"ORIGINAL_PRIVATE_REQUEST_INVALID");return nil;}
        YNXOriginalServiceRequest *value=[self new];value->_raw=[raw copy];value->_requestID=[request copy];
        value->_operation=[operation copy];value->_phase=[phase copy];return value;
}
- (NSString *)raw{return _raw;}
- (NSString *)requestID{return _requestID;}
- (NSString *)operation{return _operation;}
- (NSString *)phase{return _phase;}
@end

// Internal fixed-module parser. Returning bytes does not qualify a Native
// resource; qualified acquisition and dispatch must enforce original custody.
static napi_value YNXCaptureCanonicalInput(napi_env env,napi_callback_info info) {
    @autoreleasepool {
        size_t argc=1; napi_value arg;
        if(napi_get_cb_info(env,info,&argc,&arg,nullptr,nullptr)!=napi_ok||argc!=1){napi_throw_type_error(env,"ORIGINAL_PRIVATE_REQUEST_INVALID","Expected the original canonical request");return nullptr;}
        napi_valuetype kind;
        if(napi_typeof(env,arg,&kind)!=napi_ok||kind!=napi_string){napi_throw_type_error(env,"ORIGINAL_PRIVATE_REQUEST_INVALID","Expected the original canonical request");return nullptr;}
        size_t length=0;
        if(napi_get_value_string_utf8(env,arg,nullptr,0,&length)!=napi_ok||length>65536){napi_throw_range_error(env,"ORIGINAL_PRIVATE_CAPACITY","Original request exceeds capacity");return nullptr;}
        std::string bytes(length+1,'\0');size_t copied=0;
        if(napi_get_value_string_utf8(env,arg,bytes.data(),bytes.size(),&copied)!=napi_ok||copied!=length){napi_throw_error(env,"ORIGINAL_PRIVATE_REQUEST_INVALID","Original request could not be captured");return nullptr;}
        NSString *raw=[[NSString alloc]initWithBytes:bytes.data() length:length encoding:NSUTF8StringEncoding];
        NSError *failure=nil;YNXOriginalServiceRequest *request=[YNXOriginalServiceRequest captureCanonicalInput:raw error:&failure];
        if(!request){napi_throw_error(env,failure.localizedDescription.UTF8String,"Original request was refused");return nullptr;}
        napi_value result;
        if(napi_create_string_utf8(env,bytes.data(),length,&result)!=napi_ok)return nullptr;
        return result;
    }
}
static napi_value YNXRegisterOriginalServiceBinding(napi_env env,napi_value exports) {
    napi_property_descriptor methods[]={{"captureCanonicalInput",nullptr,YNXCaptureCanonicalInput,nullptr,nullptr,nullptr,napi_default,nullptr}};
    if(napi_define_properties(env,exports,sizeof(methods)/sizeof(methods[0]),methods)!=napi_ok)return nullptr;
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,YNXRegisterOriginalServiceBinding)
