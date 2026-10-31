#include "original-product-device-v5-unsigned.h"
#include <algorithm>
#include <cstring>

namespace ynx_auth_private {
static bool v5Exact(NSDictionary *value, NSArray *keys) {
    return [value isKindOfClass:NSDictionary.class] && value.count == keys.count &&
        [[NSSet setWithArray:value.allKeys] isEqual:[NSSet setWithArray:keys]];
}
static bool v5Text(id value, NSUInteger maximum) {
    if (![value isKindOfClass:NSString.class]) return false;
    NSData *raw = [value dataUsingEncoding:NSUTF8StringEncoding];
    return raw && raw.length && raw.length <= maximum &&
        [value rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location == NSNotFound;
}
static bool v5ASCII(id value, const char *alphabet, NSUInteger minimum, NSUInteger maximum) {
    if (![value isKindOfClass:NSString.class] || [value length] < minimum || [value length] > maximum) return false;
    for (NSUInteger i = 0; i < [value length]; ++i) {
        const unichar c = [value characterAtIndex:i];
        if (!c || c > 127 || !std::strchr(alphabet, (char)c)) return false;
    }
    return true;
}
static NSString *v5Instant(uint64_t ms) {
    NSISO8601DateFormatter *format = [NSISO8601DateFormatter new];
    format.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
    return [format stringFromDate:[NSDate dateWithTimeIntervalSince1970:(double)ms / 1000.0]];
}
NSData *composeProductDeviceV5UnsignedDATA(NSDictionary *identity, NSDictionary *body,
    NSUInteger length, NSString *type, NSString *nonce, uint64_t issued, uint64_t expires, std::string &error) {
    error.clear();
    const auto refuse = [&](const char *code) -> NSData * { error = code; return nil; };
    @try {
        NSArray *keys = @[@"sessionBinding",@"productId",@"clientId",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"account",@"canonicalOwner",@"deviceId",@"deviceRegistrationId",@"deviceRegistrationRevision",@"deviceRegistrationDigest"];
        if (!v5Exact(identity, keys)) return refuse("DEVICE_V5_UNSIGNED_IDENTITY14_REQUIRED");
        for (NSString *key in keys) {
            id value = identity[key];
            if (value == NSNull.null && ([key isEqual:@"bundleId"] || [key isEqual:@"packageId"])) continue;
            if (!v5Text(value, 4096)) return refuse("DEVICE_V5_UNSIGNED_IDENTITY_VALUE");
        }
        if (!v5Exact(body, @[@"contentType",@"bodyDigest",@"bodyBinding"]) || !length || length > 68288512 || ![body[@"contentType"] isEqual:type])
            return refuse("DEVICE_V5_UNSIGNED_SAME_BODY_REQUIRED");
        NSString *prefix = @"multipart/form-data; boundary=";
        if (![type isKindOfClass:NSString.class] || ![type hasPrefix:prefix] ||
            !v5ASCII([type substringFromIndex:prefix.length], "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-", 1, 70))
            return refuse("DEVICE_V5_UNSIGNED_CONTENT_TYPE");
        NSDictionary *binding = body[@"bodyBinding"];
        const char *hex = "0123456789abcdef";
        const auto lengthText = std::to_string(length);
        if (!v5ASCII(body[@"bodyDigest"], hex, 64, 64) || !v5Exact(binding, @[@"bytes",@"sha3_512",@"sha512"]) ||
            ![binding[@"bytes"] isEqual:[NSString stringWithUTF8String:lengthText.c_str()]] ||
            !v5ASCII(binding[@"sha3_512"], hex, 128, 128) || !v5ASCII(binding[@"sha512"], hex, 128, 128))
            return refuse("DEVICE_V5_UNSIGNED_BODY_DATA");
        if (!v5ASCII(nonce, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-", 32, 64) ||
            issued > 253402300799999ULL || expires > 253402300799999ULL || expires <= issued || expires - issued > 30000)
            return refuse("DEVICE_V5_UNSIGNED_ORIGINAL_WINDOW");
        NSMutableDictionary *value = [identity mutableCopy];
        value[@"version"] = @"5"; value[@"method"] = @"POST"; value[@"path"] = @"/api/v1/ide/deployments";
        value[@"nonce"] = nonce; value[@"issuedAt"] = v5Instant(issued); value[@"expiresAt"] = v5Instant(expires);
        value[@"contentType"] = type; value[@"bodyDigest"] = body[@"bodyDigest"]; value[@"bodyBinding"] = [binding copy];
        NSData *raw = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys | NSJSONWritingWithoutEscapingSlashes error:nil];
        if (!raw.length || raw.length > 16384) return refuse("DEVICE_V5_UNSIGNED_CANONICAL_BOUND");
        return [NSData dataWithBytes:raw.bytes length:raw.length];
    } @catch (id exception) { return refuse("DEVICE_V5_UNSIGNED_DATA_EXCEPTION"); }
}
}
