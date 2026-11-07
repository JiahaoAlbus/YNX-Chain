#import "WPRPublicReceiverPrivate.h"
#include "original-source-provisioning-fence.h"
#include "WPRPublicationWindowPrivate.hpp"
#include <chrono>
#include <thread>
#include <sys/stat.h>
using namespace ynx::wallet::product::publication;
namespace {
NSMapTable*receivers(){static NSMapTable*table;static dispatch_once_t once;dispatch_once(&once,^{table=[NSMapTable strongToStrongObjectsMapTable];});return table;}
uint64_t wall(){return uint64_t(NSDate.date.timeIntervalSince1970*1000.0);}
uint64_t mono(){return uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());}
NSData*raw(id v){return[v isKindOfClass:NSData.class]?v:nil;}
ynx_auth_private::ProvisioningPublicIdentity identity(NSDictionary*s){
 auto text=[](id v){if(![v isKindOfClass:NSString.class])throw std::runtime_error("WPR_SNAPSHOT_STRING_REQUIRED");return std::string([v UTF8String]);};
 auto hash=[](NSData*d){if(!d.length)throw std::runtime_error("WPR_SNAPSHOT_ORIGINAL_REQUIRED");unsigned char h[32];CC_SHA256(d.bytes,(CC_LONG)d.length,h);std::string out;constexpr char hex[]="0123456789abcdef";for(auto c:h){out+=hex[c>>4];out+=hex[c&15];}return out;};
 return{{hash(raw(s[@"rootOriginal"])),hash(raw(s[@"enrollmentOriginal"])),hash(raw(s[@"profileOriginal"]))},text(s[@"sourceId"]),text(s[@"head"]),[s[@"sequence"]unsignedLongLongValue],[s[@"floor"]unsignedLongLongValue]};
}
}
@implementation YNXWPRPublicReceiver {
 std::thread::id _worker;YNXWPRPublicationPeer*_peer;YNXAuthIdentitySourceAuthority*_source;
 const InstallationRelease*_row;InstallationRelease _same;NSDictionary*_snapshot,*_receipt;
 std::unique_ptr<ynx_auth_private::SourcePublicInstallation>_installation;
 ynx_auth_private::SourcePublicInstallation::Bundle _bundle;
 ynx_auth_private::ProvisioningPublicFence _terminalFence;
 PublicationWindow _window;
 uint64_t _wall0,_mono0,_expires,_monoEnd,_lastWall;
 BOOL _entered,_retired,_closed,_busy,_windowReady;NSError*_first,*_closeFirst;
}
- (BOOL)fail:(NSString*)code error:(NSError**)error {if(!_first)_first=[NSError errorWithDomain:@"YNXWPRPublicReceiver" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];_retired=YES;if(error)*error=_first;return NO;}
- (BOOL)adoptFailure:(NSError*)cause fallback:(NSString*)code error:(NSError**)error {if(!_first&&cause)_first=cause;return[self fail:code error:error];}
- (BOOL)recognized{@synchronized(receivers()){return[self class]==YNXWPRPublicReceiver.class&&[receivers()objectForKey:self]==self;}}
- (BOOL)clockCurrent:(NSError**)error{uint64_t w=wall(),m=mono();if(!_windowReady||!_window.current(w,m))return[self fail:@"WPR_PUBLICATION_ORIGINAL_WINDOW_EXPIRED" error:error];_lastWall=w;return YES;}
- (NSDictionary*)currentOriginal:(NSError**)error {
 if(![self recognized]||_worker!=std::this_thread::get_id()||_retired||_closed||_first){if(error)*error=_first;return nil;}
 if(!registered(_row)||!same_installation_release(*_row,_same))return[self fail:@"WPR_REGISTERED_INSTALLATION_CHANGED" error:error],nil;
 if(![self clockCurrent:error])return nil;NSError*cause=nil;if(![_peer assertCurrentMessage:&cause])return[self adoptFailure:cause fallback:@"WPR_ORIGINAL_PEER_NOT_CURRENT" error:error],nil;
 NSDictionary*next=[_source copyOriginalWPRPublicationOriginals:&cause];if(!next||cause)return[self adoptFailure:cause fallback:@"WPR_ORIGINAL_SOURCE_NOT_CURRENT" error:error],nil;
 for(NSString*k in @[@"rootOriginal",@"enrollmentOriginal",@"profileOriginal",@"acquisitionHeadOriginal",@"sourceId",@"profileDigest",@"head"]){if(![next[k]isEqual:_snapshot[k]])return[self fail:@"WPR_PUBLICATION_ORIGINAL_CHANGED" error:error],nil;}
 if([next[@"floor"]unsignedLongLongValue]!=[_snapshot[@"floor"]unsignedLongLongValue]||[next[@"sequence"]unsignedLongLongValue]<[_snapshot[@"sequence"]unsignedLongLongValue])return[self fail:@"WPR_PUBLICATION_CURRENT_CHANGED" error:error],nil;
 if(![self clockCurrent:error])return nil;cause=nil;if(![_peer assertCurrentMessage:&cause])return[self adoptFailure:cause fallback:@"WPR_POST_SOURCE_PEER_CHANGED" error:error],nil;if(![self clockCurrent:error])return nil;return next;
}
+ (instancetype)acquireForOriginalPeer:(YNXWPRPublicationPeer*)peer error:(NSError**)error {
 YNXWPRPublicReceiver*owner=[YNXWPRPublicReceiver new];owner->_worker=std::this_thread::get_id();@synchronized(receivers()){if(receivers().count>=32){[owner fail:@"WPR_RECEIVER_CUSTODY_CAPACITY" error:error];return owner;}[receivers()setObject:owner forKey:owner];}
 @try{try{
 if(original_installation_releases().empty()){[owner fail:@"WPR_INSTALL_RELEASE_NOT_SUPPLIED" error:error];return owner;}
 if(![YNXWPRPublicationPeer isOriginalPeer:peer]||![peer assertCurrentMessage:error]){[owner fail:@"WPR_ORIGINAL_PEER_REQUIRED" error:error];return owner;}owner->_peer=peer;
 owner->_row=[peer originalRegisteredRelease:error];if(!registered(owner->_row)){[owner fail:@"WPR_INSTALL_RELEASE_NOT_SUPPLIED" error:error];return owner;}owner->_same=*owner->_row;
 NSError*cause=nil;owner->_source=[YNXAuthIdentitySourceAuthority acquireOriginalWPRPublicationForPeer:peer error:&cause]; // adopt before error
 if(cause||!owner->_source){[owner adoptFailure:cause fallback:@"WPR_PUBLICATION_SOURCE_REQUIRED" error:error];return owner;}
 owner->_snapshot=[owner->_source copyOriginalWPRPublicationOriginals:&cause];if(cause||!owner->_snapshot){[owner adoptFailure:cause fallback:@"WPR_PUBLICATION_SNAPSHOT_REQUIRED" error:error];return owner;}
 NSArray*parts=@[owner->_snapshot[@"rootOriginal"],owner->_snapshot[@"enrollmentOriginal"],owner->_snapshot[@"profileOriginal"],owner->_snapshot[@"acquisitionHeadOriginal"]];
 for(NSUInteger n=0;n<4;n++){NSData*d=raw(parts[n]);const auto cap=n==0?ynx_auth_private::OriginalAuthPublicRootMax:ynx_auth_private::OriginalAuthPublicOriginalMax;if(!d.length||d.length>cap){[owner fail:@"WPR_PUBLICATION_ORIGINAL_CAPACITY" error:error];return owner;}const auto*bytes=(const unsigned char*)d.bytes;owner->_bundle[n].assign(bytes,bytes+d.length);}
 owner->_wall0=owner->_lastWall=wall();owner->_mono0=mono();owner->_expires=std::min([owner->_snapshot[@"expiresAtMs"]unsignedLongLongValue],owner->_row->expires_ms);if(owner->_expires<=owner->_wall0||owner->_expires-owner->_wall0>30000){[owner fail:@"WPR_PUBLICATION_CURRENT_WINDOW_REQUIRED" error:error];return owner;}owner->_monoEnd=owner->_mono0+(owner->_expires-owner->_wall0);
 if(!owner->_terminalFence.capture(identity(owner->_snapshot),[owner->_snapshot[@"issuedAtMs"]unsignedLongLongValue],owner->_expires,owner->_wall0,owner->_mono0)||!owner->_window.capture([owner->_snapshot[@"issuedAtMs"]unsignedLongLongValue],owner->_expires,owner->_wall0,owner->_mono0)){[owner fail:@"WPR_PUBLICATION_SNAPSHOT_WINDOW_REQUIRED" error:error];return owner;}owner->_windowReady=YES;
 if(![owner currentOriginal:error])return owner;return owner;
 }catch(...){[owner fail:@"WPR_RECEIVER_CAPTURE_CPP_UNKNOWN" error:error];return owner;}}@catch(NSException*){[owner fail:@"WPR_RECEIVER_CAPTURE_UNKNOWN" error:error];return owner;}
}
- (BOOL)captureTarget:(NSError**)error {
 if(_installation)return YES;struct stat target{};
 if(!ynx_auth_private::SourcePublicInstallation::protectedRootAncestors(_row->product.resource_directory)||lstat(_row->product.resource_directory.c_str(),&target)||!S_ISDIR(target.st_mode)||target.st_uid!=0||uint64_t(target.st_dev)!=_row->target_device||uint64_t(target.st_ino)!=_row->target_inode)return[self fail:@"WPR_TARGET_REGISTERED_DIRECTORY_REQUIRED" error:error];
 _installation=std::make_unique<ynx_auth_private::SourcePublicInstallation>(); // adopt before open
 if(!_installation->captureParent(_row->product.resource_directory,0))return[self fail:@"WPR_TARGET_CAPTURE_UNKNOWN" error:error];return YES;
}
- (NSDictionary*)finishReadBack:(BOOL)cold error:(NSError**)error {
 std::array<ynx_auth_private::SourcePublicInstallation::Receipt,4>receipts{};
 if(!_installation||!_installation->readBack(receipts))return[self fail:@"WPR_PUBLICATION_READBACK_UNKNOWN" error:error],nil;
 NSMutableArray*files=[NSMutableArray array];for(const auto&r:receipts)[files addObject:@{@"name":[NSString stringWithUTF8String:r.name.c_str()],@"sha256":[NSString stringWithUTF8String:r.sha256.c_str()],@"bytes":@((uint64_t)r.identity.st_size),@"device":@((uint64_t)r.identity.st_dev),@"inode":@((uint64_t)r.identity.st_ino),@"uid":@((uint64_t)r.identity.st_uid),@"gid":@((uint64_t)r.identity.st_gid),@"mode":@((uint64_t)r.identity.st_mode),@"nlink":@((uint64_t)r.identity.st_nlink)}];
 // Actual PUBLIC receipt is retained BEFORE any late Source/current failure.
 _receipt=@{@"files":[files copy],@"operationId":[NSString stringWithUTF8String:_row->operation_id.c_str()],@"applicationId":[NSString stringWithUTF8String:_row->product.application_id.c_str()],@"kernelUID":@(_row->product.uid),@"coldReadback":@(cold),@"dataOnly":@YES,@"nativeAdmission":@NO,@"executionGranted":@NO,@"operationVerified":@NO};
 if(!cold&&!_installation->retainPublishedData())return[self fail:@"WPR_PUBLICATION_RETAIN_UNKNOWN" error:error],nil;
 NSDictionary*late=[self currentOriginal:error];if(!late)return nil;
 if(!_terminalFence.complete(identity(late),wall(),mono()))return[self fail:@"WPR_PUBLICATION_FINAL_CURRENT_REFUSED" error:error],nil;
 if(!_installation->readBack(receipts)||![self clockCurrent:error])return[self fail:@"WPR_PUBLICATION_FINAL_INODE_REFUSED" error:error],nil;
 NSError*peerError=nil;if(![_peer assertCurrentMessage:&peerError])return[self adoptFailure:peerError fallback:@"WPR_FINAL_PEER_CHANGED" error:error],nil;if(![self clockCurrent:error])return nil;
 NSMutableDictionary*complete=[_receipt mutableCopy];complete[@"sourceCurrentOriginal"]=[late[@"currentOriginal"]copy];complete[@"sequence"]=late[@"sequence"];complete[@"floor"]=late[@"floor"];complete[@"head"]=late[@"head"];_receipt=[complete copy];return _receipt;
}
- (NSDictionary*)publishOriginal:(NSError**)error{@synchronized(self){
 if(_busy||_entered)return[self fail:@"WPR_ORIGINAL_OPERATION_ALREADY_ENTERED" error:error],nil;_busy=YES;
 @try{try{if(![self currentOriginal:error]||![self captureTarget:error])return nil;_entered=YES;
 // Root-reviewed op selects the SAME deterministic exclusive pending slot.
 // A prior UNKNOWN/pending or final target never gets a replacement op/name.
 if(!_installation->stageOriginalWPR(_bundle,_row->operation_id))return[self fail:@"WPR_ORIGINAL_STAGE_UNKNOWN" error:error],nil;
 if(![self currentOriginal:error])return nil;if(!_installation->publish())return[self fail:@"WPR_ORIGINAL_PUBLICATION_UNKNOWN" error:error],nil;return[self finishReadBack:NO error:error];
 }catch(...){return[self fail:@"WPR_PUBLICATION_CPP_UNKNOWN" error:error],nil;}}@catch(NSException*){return[self fail:@"WPR_PUBLICATION_EXCEPTION_UNKNOWN" error:error],nil;}@finally{_busy=NO;}
}}
- (NSDictionary*)copyOriginalReadBack:(NSError**)error{@synchronized(self){
 if(_busy||_entered)return[self fail:@"WPR_ORIGINAL_OPERATION_ALREADY_SELECTED" error:error],nil;_busy=YES;
 @try{try{if(![self currentOriginal:error]||![self captureTarget:error])return nil;_entered=YES;if(!_installation->captureExisting(_bundle))return[self fail:@"WPR_ORIGINAL_READBACK_NOT_SUPPLIED" error:error],nil;return[self finishReadBack:YES error:error];
 }catch(...){return[self fail:@"WPR_READBACK_CPP_UNKNOWN" error:error],nil;}}@catch(NSException*){return[self fail:@"WPR_READBACK_EXCEPTION_UNKNOWN" error:error],nil;}@finally{_busy=NO;}
}}
- (NSDictionary*)copyRetainedReceiptDATA{@synchronized(self){return[self recognized]?[_receipt copy]:nil;}}
- (void)retire{@synchronized(self){_retired=YES;[_source retire];}}
- (BOOL)join:(NSError**)error{@synchronized(self){if(_worker!=std::this_thread::get_id()||_busy){if(error)*error=_first;return NO;}return!_source||[_source join:error];}}
- (BOOL)close:(NSError**)error{@synchronized(self){
 if(_worker!=std::this_thread::get_id()||_busy)return NO;if(_closed){if(error)*error=_closeFirst?:_first;return YES;}[self retire];
 if(_installation&&!_installation->closeRetainingOriginalWPRData()){if(!_closeFirst)_closeFirst=[NSError errorWithDomain:@"WPRPublication" code:1 userInfo:@{NSLocalizedDescriptionKey:@"WPR_PUBLIC_FILES_CLOSE_UNKNOWN"}];if(error)*error=_closeFirst;return NO;}
 NSError*cause=nil;if(_source&&(![_source closeOriginalWPRPublicationSource:&cause]||![_source originalWPRPublicationPhysicallyClosed])){if(!_closeFirst)_closeFirst=cause;if(error)*error=_closeFirst;return NO;}
 _closed=YES;_source=nil;_peer=nil;@synchronized(receivers()){[receivers()removeObjectForKey:self];}if(error)*error=_closeFirst?:_first;return YES;
}}
- (BOOL)physicallyClosed{@synchronized(self){return _closed;}}
@end
