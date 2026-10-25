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

// Private, independently acquired SDK19 project-authority Source owner.
// Snapshot DATA is not release consent, a workspace FD owner or a signer.
// Adopt returned cleanup partial BEFORE inspecting NSError; never reacquire
// to repair a failed/changed selection. The effect still needs its own fixed
// request/approval window, artifact binding, once entry and result durability.
@interface YNXOriginalArtifactPublisherCurrent : NSObject
+ (instancetype)acquireForOriginalManifest:(NSData *)manifest error:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
- (NSDictionary *)copyOriginalPublisherSnapshot:(NSError **)error;
- (void)retire;
- (BOOL)close:(NSError **)error;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

// Wallet-owned protected append-only operation storage. Two create-only slots
// per exact original request: intent before private read, public outcome after
// the sole attempt. Stored DATA never grants approval, signing or handoff.
// Duplicate intent is ALWAYS a refusal; matching result reconciliation only
// confirms storage, never authorizes another key read/signature/send.
@interface YNXOriginalArtifactReleaseJournal : NSObject
- (BOOL)createOriginalIntent:(NSDictionary *)record error:(NSError **)error;
- (BOOL)createOriginalResult:(NSDictionary *)record error:(NSError **)error;
- (NSDictionary *)copyOriginalIntentForRequest:(NSData *)request error:(NSError **)error;
- (NSDictionary *)copyOriginalResultForRequest:(NSData *)request error:(NSError **)error;
@end

@class YNXOriginalIDEWalletIdentitySource,YNXOriginalIDEWalletPeerLaunch;
// Main-only bounded review/approval owner for the existing admitted Wallet
// channel. The fixed Native binding supplies actual same-env source/transport,
// never a JS provider or approval boolean. Public IDs alone grant nothing.
// Approve must be called only by Main's explicit visible decision handler;
// this class does not itself attest a GUI click or produce a signature.
@interface YNXOriginalArtifactReleaseApproval : NSObject
+ (instancetype)captureWalletSource:(YNXOriginalIDEWalletIdentitySource *)source
                          transport:(YNXOriginalIDEWalletPeerLaunch *)transport error:(NSError **)error;
- (NSDictionary *)copyOriginalReview:(NSError **)error;
- (BOOL)approveOriginalReview:(NSString *)reviewId error:(NSError **)error;
- (BOOL)assertOriginalApprovalCurrent:(NSString *)approvalRef error:(NSError **)error;
// Once-selection before custody/crypto. A failure after this selection is not
// permission to enter again, including when no memberOriginal was returned.
- (NSDictionary *)selectOriginalSigning:(NSString *)approvalRef error:(NSError **)error;
// Fixed Native-only effect; unavailable without the explicit matched CABI
// build role. Neither the private record nor a signer/provider crosses NAPI.
- (NSDictionary *)signOriginalRelease:(NSString *)approvalRef error:(NSError **)error;
// Read/save an already held public outcome even after retirement. Storage
// confirmation is never a new signing, send, callback or approval permission.
- (NSDictionary *)copyOriginalSigningOutcome:(NSError **)error;
- (BOOL)saveOriginalSigningOutcome:(NSError **)error;
- (void)retire;
- (BOOL)close:(NSError **)error;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

// Private native storage ONLY. No Node exports, authority factory, generic
// signing callback, asset vault or secret-export UI. Actual Source/current
// publisher registry and independent approval must gate the owning effect.
// This class does not create keys or establish historical key-purpose trust.
@interface YNXOriginalArtifactPublisherStore : NSObject
// Native provisioning checkpoints, NOT Source/approval or key-generation
// authority. Reserve the exact original request before the one crypto entry.
// A duplicate/uncertain intent must only be queried, never generated again.
- (BOOL)beginOriginalGenerationForRequest:(NSData *)request error:(NSError **)error;
- (NSData *)copyOriginalGenerationIntentForRequest:(NSData *)request error:(NSError **)error;
// Retain the FIRST generated private record under its original request before
// registration/any late current callback. Identical result storage may be
// confirmed; another key/R for that request is always refused. Native only:
// these methods must never be exported to JS/NAPI/IPC/helper or a file.
- (BOOL)saveOriginalGeneratedRecord:(NSData *)record forPublicOriginal:(NSData *)publicOriginal
                   requestOriginal:(NSData *)request error:(NSError **)error;
- (NSData *)copyOriginalGeneratedPublicOriginalForRequest:(NSData *)request error:(NSError **)error;
- (NSMutableData *)copyOriginalGeneratedRecordForRequest:(NSData *)request
                                     forPublicOriginal:(NSData *)publicOriginal error:(NSError **)error;
// One Data Protection Keychain item encrypts the full R + KEY7 custody record
// together. Create-only; duplicate/uncertain results never cause replacement.
- (BOOL)createOriginalRecord:(NSData *)record
         forPublicOriginal:(NSData *)publicOriginal
                     error:(NSError **)error;
// Protected-process plaintext only. Caller must wipe the returned mutable
// bytes after purpose-specific SDK import. Never expose through IPC or logs.
- (NSMutableData *)copyOriginalRecordForPublicOriginal:(NSData *)publicOriginal
                                                error:(NSError **)error;
// Private storage body only: performs independent current checks around the
// read and wipes a late-refused copy. It does NOT supply release approval.
- (NSMutableData *)copyOriginalRecordForCurrentPublisher:(YNXOriginalArtifactPublisherCurrent *)current
                                                  error:(NSError **)error;
@end
