#pragma once
#import <Foundation/Foundation.h>
#include <cstdint>
#include <string>

namespace ynx_auth_private {
// DATA construction only, never Source/current, key-use or HTTP permission.
// The private producer supplies its independently qualified Source identity,
// SAME held body's length/type and fixed SDK private-peer body DATA. Core must
// recompute all three hashes from the actual held bytes before private signing.
NSData *composeProductDeviceV5UnsignedDATA(NSDictionary *identity14,
    NSDictionary *originalBodyDATA, NSUInteger actualBodyLength,
    NSString *actualContentType, NSString *originalNonce,
    uint64_t issuedAtMs, uint64_t expiresAtMs, std::string &error);
}
