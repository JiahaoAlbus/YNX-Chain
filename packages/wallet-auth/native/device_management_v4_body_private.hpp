#pragma once
#import <Foundation/Foundation.h>
#include "device_management_v4_routes.hpp"
namespace ynx::device::management {
// DATA-only view of originals already verified and retained by the independent
// management Source. Passing this struct does not mint that Source or a slot.
struct OriginalBindingDATA {
 Operation operation;SessionProvenance provenance;
 std::string session_binding,registration_original,request_original,source_account;
 std::string original_operation,challenge_id;
};
struct CapturedBodyDATA {
 Operation operation;NSData*__strong original=nil;
 NSDictionary*__strong value=nil;
 std::string digest;
};
// Closed canonical4/5 body + raw SHA256 + immutable Root-original equality.
// No signing, registration, key access, Source factory, JSON-approved or HTTP.
CapturedBodyDATA capture_original_management_body_data(NSData*,const OriginalBindingDATA&);
// Validate existing canonical unsigned21 against body + retained binding. This
// does NOT replace sole SDK parsing/math or Native Source/current/approval.
NSDictionary*validate_original_management_unsigned_data(NSData*,const CapturedBodyDATA&,const OriginalBindingDATA&);
}
