// PUBLIC DATA constructor controls only. No Source, key, proof or HTTP call.
#include "original-product-device-v5-unsigned.h"
int main() {
    @autoreleasepool {
        NSData *input = [NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile];
        NSDictionary *request = [NSJSONSerialization JSONObjectWithData:input options:0 error:nil];
        std::string error;
        NSData *raw = ynx_auth_private::composeProductDeviceV5UnsignedDATA(request[@"identity"], request[@"bodyDATA"],
            [request[@"actualBodyLength"] unsignedIntegerValue], request[@"actualContentType"], request[@"nonce"],
            [request[@"issuedAtMs"] unsignedLongLongValue], [request[@"expiresAtMs"] unsignedLongLongValue], error);
        NSDictionary *result = raw ? @{@"ok":@YES, @"canonicalOriginal":[[NSString alloc] initWithData:raw encoding:NSUTF8StringEncoding]} :
            @{@"ok":@NO, @"error":[NSString stringWithUTF8String:error.c_str()]};
        NSData *output = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingSortedKeys error:nil];
        [NSFileHandle.fileHandleWithStandardOutput writeData:output];
        return 0;
    }
}
