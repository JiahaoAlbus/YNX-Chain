#pragma once
#import <Foundation/Foundation.h>
#import "WPRPublicationSourcePrivate.h"
// Single private finite Native→NodeHost transport. Not a Root/signing protocol,
// listener activation, generic method dispatcher or renderer/public endpoint.
// The ORIGINAL executor supplies its already accepted genuine WPR peer.
// All methods are readonly/custody only and bind SAME NSXPC connection/lease.
@protocol YNXWPRMaterializationRPCPrivateV1
- (void)openOriginalMaterializationWithReply:(void(^)(NSDictionary*actualReply,NSError*actualError))reply;
- (void)readCapturedPublicOriginals:(NSString*)originalLease reply:(void(^)(NSDictionary*,NSError*))reply;
- (void)readIndependentMaterializationOriginal:(NSString*)originalLease reply:(void(^)(NSDictionary*,NSError*))reply;
- (void)assertOriginalMaterializationCurrent:(NSString*)originalLease reply:(void(^)(NSDictionary*,NSError*))reply;
- (void)recheckOriginalMaterialization:(NSString*)originalLease reply:(void(^)(NSDictionary*,NSError*))reply;
- (void)retireOriginalMaterialization:(NSString*)originalLease reply:(void(^)(NSDictionary*,NSError*))reply;
- (void)joinOriginalMaterialization:(NSString*)originalLease reply:(void(^)(NSDictionary*,NSError*))reply;
- (void)closeOriginalMaterialization:(NSString*)originalLease reply:(void(^)(NSDictionary*,NSError*))reply;
@end
// No free-form query/body/options. Open has ZERO request fields; later methods
// take ONLY the same opaque canonical-u64 lease string, never a ptr/UID/path.
// All reply dictionaries use this exact immutable envelope:
// version:'YNX-WPR-MATERIALIZATION-RPC/v1', lease:string|null,
// originals:dict4|null (root/enrollment/profile/acquisitionHead UTF8 strings),
// currentOriginal:NSData|null, registrationCaptureOriginal:NSData|null,
// expectedInputOriginal:NSData|null (same Native retained input BEFORE fetch),
// buildOriginals:dict6<NSData>|null; fixed already-held PUBLIC files only,
// root/enrollment/verifier/node/runtimeManifest/dispatch; aggregate<=146MiB.
// independentOriginal:NSData|null, errorPresent:bool, firstCausePresent:bool,
// firstCause:NSError|null, retired:bool, physicalDone:bool,
// dataOnly:true, RootAdmission:false, SourceAdmission:false, NativeAdmission:false.
// Raw registrationCaptureOriginal comes ONLY from the sole WPR rawcapture
// dispatch AFTER its original mathematical chain. It is NOT a serialized brand.
// NodeHost reparses actual raw records through the original SDK DATA parser
// with independently bound expected node/network/owners. No brand cloning.
@interface YNXWPRMaterializationServerPrivate:NSObject<YNXWPRMaterializationRPCPrivateV1>
+ (instancetype)forOriginalPeer:(YNXWPRPublicationPeer*)peer;
@end
FOUNDATION_EXPORT NSXPCInterface*YNXWPRMaterializationRPCInterfaceV1(void);
