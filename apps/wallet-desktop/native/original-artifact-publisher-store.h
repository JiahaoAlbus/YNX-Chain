#pragma once
#import <Foundation/Foundation.h>
#ifdef __cplusplus
#include <cstddef>
#include <cstdint>
#include <cstring>
namespace ynx_wallet_private {
struct PublisherBytes {const uint8_t *bytes=nullptr;size_t length=0;};
struct PublisherMaterialBorrow {
 PublisherBytes registration,pkcs8A,pkcs8B,pkA,pkB;
};
// Storage layout only, NOT R13/DER mathematics, Source or approval. All spans
// borrow the caller-owned private mutable record until its final wipe. Never
// retain them or expose them via NAPI/JS/IPC/helper. No allocation/private copy.
// Failure clears EVERY output even when the caller reuses an earlier borrow.
inline bool borrowPublisherRecord(const void *record,size_t length,const void *expectedR,size_t expectedLength,PublisherMaterialBorrow&output) noexcept {
 output={};static const char magic[]="YNX-PUBLISHER-CUSTODY/v1\n";
 if(!record||!expectedR||!expectedLength||expectedLength>8192||length>16384||length<sizeof(magic)-1+4)return false;
 const auto *bytes=static_cast<const uint8_t*>(record);size_t at=sizeof(magic)-1;
 if(std::memcmp(bytes,magic,at)!=0)return false;
 auto take=[&](size_t maximum,size_t exact,PublisherBytes&part){
  if(length-at<4)return false;uint32_t n=0;for(unsigned i=0;i<4;i++)n=(n<<8)|bytes[at++];
  if(!n||n>maximum||(exact&&n!=exact)||n>length-at)return false;
  part={bytes+at,n};at+=n;return true;
 };
 PublisherMaterialBorrow captured;
 if(!take(8192,expectedLength,captured.registration)||std::memcmp(captured.registration.bytes,expectedR,expectedLength)!=0||
    !take(54,54,captured.pkcs8A)||!take(150,150,captured.pkcs8B)||!take(2592,2592,captured.pkA)||!take(64,64,captured.pkB)||at!=length)return false;
 output=captured;return true;
}
}
#endif

// Private native storage ONLY. No Node exports, authority factory, generic
// signing callback, asset vault or secret-export UI. Actual Source/current
// publisher registry and independent approval must gate the owning effect.
// This class does not create keys or establish historical key-purpose trust.
@interface YNXOriginalArtifactPublisherStore : NSObject
// One Data Protection Keychain item encrypts the full R + KEY7 custody record
// together. Create-only; duplicate/uncertain results never cause replacement.
- (BOOL)createOriginalRecord:(NSData *)record
         forPublicOriginal:(NSData *)publicOriginal
                     error:(NSError **)error;
// Protected-process plaintext only. Caller must wipe the returned mutable
// bytes after purpose-specific SDK import. Never expose through IPC or logs.
- (NSMutableData *)copyOriginalRecordForPublicOriginal:(NSData *)publicOriginal
                                                error:(NSError **)error;
@end
