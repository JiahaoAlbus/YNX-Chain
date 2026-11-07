#import "ide-cloud-project-mapping-private.h"
#import "original-auth-identity-source-authority.h"
#import "original-ide-parent-node.h"
#include "ide-cloud-project-release-private.hpp"
#include <chrono>
#include <algorithm>
#include <utility>
#include <limits.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
using namespace ynx_auth_ide_cloud_private;
namespace physical=ynx::wallet::pay::root_physical;
#ifdef YNX_IDE_CLOUD_PUBLIC_CONTROLS
extern int PUBLICIDECloudCloseFD(int);
#endif
namespace {
int closeOwnedFD(int fd){
#ifdef YNX_IDE_CLOUD_PUBLIC_CONTROLS
 return PUBLICIDECloudCloseFD(fd);
#else
 return ::close(fd);
#endif
}
NSError*problem(NSString*s){return[NSError errorWithDomain:@"YNXIDECloudProject" code:1 userInfo:@{NSLocalizedDescriptionKey:s}];}
bool exact(id v,NSArray*k){return[v isKindOfClass:NSDictionary.class]&&[[NSSet setWithArray:[v allKeys]]isEqual:[NSSet setWithArray:k]];}
bool text(id v){return[v isKindOfClass:NSString.class]&&[v length]&&[v lengthOfBytesUsingEncoding:NSUTF8StringEncoding]<=256&&[v rangeOfCharacterFromSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].location==NSNotFound;}
bool LookupU64(id v,uint64_t&out){if(![v isKindOfClass:NSString.class]||![v length]||[v length]>20)return false;std::string s([v UTF8String]);out=0;for(auto c:s){if(c<'0'||c>'9'||out>(UINT64_MAX-uint64_t(c-'0'))/10)return false;out=out*10+c-'0';}return std::to_string(out)==s;}
bool ms(id v,uint64_t&out){if(![v isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)v)==CFBooleanGetTypeID()||[v doubleValue]<1||[v doubleValue]>9007199254740991.0)return false;out=[v unsignedLongLongValue];return[v doubleValue]==double(out);}
uint64_t wall(){return uint64_t(NSDate.date.timeIntervalSince1970*1000.0);}
bool fullref(id d){if(!exact(d,@[@"realm",@"tenant",@"kind",@"id",@"rev"]))return false;for(NSString*k in @[@"realm",@"tenant",@"kind",@"id"])if(!text(d[k]))return false;uint64_t r=0;return LookupU64(d[@"rev"],r);}
bool sameDirectory(int fd,NSString*path,const struct stat&expected){char actual[PATH_MAX];struct stat held{},named{};return fd>=0&&realpath(path.fileSystemRepresentation,actual)&&[path isEqual:[NSString stringWithUTF8String:actual]]&&!fstat(fd,&held)&&!lstat(path.fileSystemRepresentation,&named)&&S_ISDIR(named.st_mode)&&S_ISDIR(held.st_mode)&&held.st_dev==expected.st_dev&&held.st_ino==expected.st_ino&&held.st_uid==expected.st_uid&&held.st_gid==expected.st_gid&&held.st_mode==expected.st_mode&&named.st_dev==held.st_dev&&named.st_ino==held.st_ino&&named.st_uid==held.st_uid&&named.st_gid==held.st_gid&&named.st_mode==held.st_mode;}
}
@implementation YNXOriginalIDECloudProjectMapping{
 YNXOriginalIDENodeDelivery*_parent;
 YNXAuthIdentitySourceAuthority*_project,*_parentSource;
 NSDictionary*_originalView,*_mapping;
 std::unique_ptr<physical::PublicOriginalHold>_hold;
 int _workspace,_profile;struct stat _workspaceStat,_profileStat;
 BOOL _busy,_retired,_closed,_closeSelected,_workspaceCloseSelected,_profileCloseSelected;
 NSError*_first;uint64_t _floor,_expires;
 std::chrono::steady_clock::time_point _deadline;
}
-(instancetype)init{if((self=[super init])){_workspace=-1;_profile=-1;}return self;}
-(void)dealloc{if(!_closed)std::terminate();}
-(BOOL)fail:(NSError**)e code:(NSString*)code{_retired=YES;if(!_first)_first=(e&&*e)?*e:problem(code);if(e)*e=_first;return NO;}
+(instancetype)borrowOriginalParent:(YNXOriginalIDENodeDelivery*)parent projectSource:(YNXAuthIdentitySourceAuthority*)project error:(NSError**)error{
 auto*o=[self new];o->_parent=parent;o->_project=project;NSError*e=nil;
 @try{try{
  // Actual native objects come from original same-image NAPI inventories.
  // Do not replace these with public descriptor numbers or callable JS shapes.
  if(!parent||!project||![parent assertCurrentExpected:nil error:&e]){[o fail:&e code:@"IDE_CLOUD_SAME_PARENT_REQUIRED"];if(error)*error=e;return o;}
  o->_parentSource=[parent borrowOriginalPrivateClientSource:&e];
  if(!o->_parentSource||e||![project assertAuthenticatedNativePurpose:&e]){[o fail:&e code:@"IDE_CLOUD_PROJECT_SOURCE_REQUIRED"];if(error)*error=e;return o;}
  o->_originalView=[project copyOriginalIDEProjectSelectionLocal:&e];
  NSDictionary*v=o->_originalView,*selected=v[@"selection"],*a=v[@"authority"];
  NSDictionary*parentSelection=[parent copyOriginalPrivateClientSelection:&e];
  if(e||!v||!text(a[@"principal"][@"account"])||![a[@"principal"][@"account"]isEqual:parentSelection[@"association"][@"account"]]||![a[@"principal"][@"deviceId"]isEqual:parentSelection[@"association"][@"deviceId"]]||![selected[@"projectId"]isEqual:a[@"project"][@"projectId"]]){[o fail:&e code:@"IDE_CLOUD_PARENT_PROJECT_BINDING"];if(error)*error=e;return o;}
  const ProjectCloudLookupRelease*row=nullptr;
  for(const auto&r:originalProjectCloudLookupReleases())if([a[@"principal"][@"account"]isEqual:[NSString stringWithUTF8String:r.account.c_str()]]&&[selected[@"projectId"]isEqual:[NSString stringWithUTF8String:r.catalog_project_id.c_str()]]){if(row){[o fail:&e code:@"IDE_CLOUD_LOOKUP_AMBIGUOUS"];if(error)*error=e;return o;}row=&r;}
  if(!row){[o fail:&e code:@"IDE_CLOUD_PROTECTED_MAPPING_NOT_SUPPLIED"];if(error)*error=e;return o;}
  // Stable release eligibility and each original READ current are distinct.
  // Never compile ephemeral current bytes/hash/window into this same image.
  uint64_t actualParentEnd=0,actualSelectionEnd=0,readStart=wall();
  if(!ms(a[@"expiresMS"],actualParentEnd)||!ms(selected[@"expiresMS"],actualSelectionEnd)||readStart>=actualParentEnd||readStart>=actualSelectionEnd){[o fail:&e code:@"IDE_CLOUD_PROJECT_WINDOW_EXPIRED"];if(error)*error=e;return o;}
  auto locator=row->mapping;locator.not_before_ms=readStart;locator.expires_ms=std::min({readStart+5000,actualParentEnd,actualSelectionEnd});locator.maximum_bytes=std::min<uint64_t>(locator.maximum_bytes,16384);
  auto h=physical::capture_root_public_original(locator);o->_hold=std::move(h.owner); // nonnull partial adopted before status
  if(h.error!=physical::Code::ok||!o->_hold){[o fail:&e code:@"IDE_CLOUD_MAPPING_HOLD_FAILED"];if(error)*error=e;return o;}
  std::vector<unsigned char>raw;if(o->_hold->read_original(raw)!=physical::Code::ok||raw.empty()||raw.size()>16384){[o fail:&e code:@"IDE_CLOUD_MAPPING_ORIGINAL_REQUIRED"];if(error)*error=e;return o;}
  o->_mapping=[NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:raw.data()length:raw.size()]options:0 error:&e];
  NSData*canonical=o->_mapping?[NSJSONSerialization dataWithJSONObject:o->_mapping options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:&e]:nil;
  if(!canonical||canonical.length!=raw.size()||memcmp(canonical.bytes,raw.data(),raw.size())){[o fail:&e code:@"IDE_CLOUD_LOOKUP_CANONICAL_REQUIRED"];if(error)*error=e;return o;}
  // Closed PRIVATE lookup DATA, NOT a new Source/signature/GET proof codec.
  auto*m=o->_mapping;uint64_t issued=0,expires=0,projectEnd=0,selectionEnd=0;
  if(e||!exact(m,@[@"version",@"account",@"catalogProjectId",@"registeredCloudFullRef",@"resourceApprovalRef",@"projectRevision",@"catalogRevision",@"currentReference",@"issuedAtMs",@"expiresAtMs"])||![m[@"version"]isEqual:@"YNX-IDE-CLOUD-PROJECT-LOOKUP/v1"]||![m[@"account"]isEqual:a[@"principal"][@"account"]]||![m[@"catalogProjectId"]isEqual:selected[@"projectId"]]||!fullref(m[@"registeredCloudFullRef"])||!text(m[@"resourceApprovalRef"])||![m[@"projectRevision"]isEqual:selected[@"projectRevision"]]||![m[@"catalogRevision"]isEqual:selected[@"catalogRevision"]]||![m[@"currentReference"]isEqual:a[@"project"][@"currentReference"]]||!ms(m[@"issuedAtMs"],issued)||!ms(m[@"expiresAtMs"],expires)||!ms(a[@"expiresMS"],projectEnd)||!ms(selected[@"expiresMS"],selectionEnd)||expires<=issued||wall()<issued||wall()>=expires){[o fail:&e code:@"IDE_CLOUD_LOOKUP_BINDING_INVALID"];if(error)*error=e;return o;}
  o->_floor=wall();o->_expires=std::min({expires,projectEnd,selectionEnd,locator.expires_ms});
  if(o->_floor>=o->_expires){[o fail:&e code:@"IDE_CLOUD_MAPPING_EXPIRED"];if(error)*error=e;return o;}
  o->_deadline=std::chrono::steady_clock::now()+std::chrono::milliseconds(o->_expires-o->_floor);
  for(NSString*k in @[@"workspace",@"profile"]){auto&fd=[k isEqual:@"workspace"]?o->_workspace:o->_profile;auto&st=[k isEqual:@"workspace"]?o->_workspaceStat:o->_profileStat;NSDictionary*d=selected[k];uint64_t dev=0,ino=0;if(!exact(d,@[@"path",@"device",@"inode"])||![d[@"path"]isKindOfClass:NSString.class]||!LookupU64(d[@"device"],dev)||!LookupU64(d[@"inode"],ino)||!ino){[o fail:&e code:@"IDE_CLOUD_WORKSPACE_ORIGINAL_REQUIRED"];if(error)*error=e;return o;}
   fd=open([d[@"path"]fileSystemRepresentation],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(fd<0||fstat(fd,&st)||uint64_t(st.st_dev)!=dev||uint64_t(st.st_ino)!=ino||!sameDirectory(fd,d[@"path"],st)){[o fail:&e code:@"IDE_CLOUD_WORKSPACE_SUBSTITUTION"];if(error)*error=e;return o;}}
  if(![o assertCurrent:&e]){if(error)*error=e;return o;}return o;
 }catch(...){[o fail:&e code:@"IDE_CLOUD_CAPTURE_CPP_FAILURE"];}}@catch(id){[o fail:&e code:@"IDE_CLOUD_CAPTURE_EXCEPTION"];}
 if(error)*error=e;return o;
}
-(BOOL)assertCurrent:(NSError**)error{@synchronized(self){
 if(_busy||_retired||_closed||_closeSelected)return[self fail:error code:@"IDE_CLOUD_MAPPING_RETIRED"];
 _busy=YES;@try{try{NSError*e=nil;const uint64_t before=wall();
  if(before<_floor||before>=_expires||std::chrono::steady_clock::now()>=_deadline||![_parent assertCurrentExpected:nil error:&e]||[_parent borrowOriginalPrivateClientSource:&e]!=_parentSource||![_project assertAuthenticatedNativePurpose:&e]||_hold->current()!=physical::Code::ok){if(error)*error=e;return[self fail:error code:@"IDE_CLOUD_MAPPING_CURRENT_FAILED"];}
  NSDictionary*v=[_project copyOriginalIDEProjectSelectionLocal:&e];if(e||![v isEqual:_originalView]||!sameDirectory(_workspace,v[@"selection"][@"workspace"][@"path"],_workspaceStat)||!sameDirectory(_profile,v[@"selection"][@"profile"][@"path"],_profileStat)||![_parent assertCurrentExpected:nil error:&e]){if(error)*error=e;return[self fail:error code:@"IDE_CLOUD_MAPPING_SELECTION_CHANGED"];}
  const uint64_t after=wall();if(after<before||after>=_expires||std::chrono::steady_clock::now()>=_deadline||_retired||_hold->current()!=physical::Code::ok)return[self fail:error code:@"IDE_CLOUD_MAPPING_LATE_CURRENT"];_floor=after;return YES;
 }catch(...){return[self fail:error code:@"IDE_CLOUD_CURRENT_CPP_FAILURE"];}}@catch(id){return[self fail:error code:@"IDE_CLOUD_CURRENT_EXCEPTION"];}@finally{_busy=NO;}
}}
-(NSDictionary*)copyOriginalMappingDATA:(NSError**)e{@synchronized(self){if(![self assertCurrent:e])return nil;NSData*b=[NSJSONSerialization dataWithJSONObject:_mapping options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:e];NSDictionary*copy=b?[NSJSONSerialization JSONObjectWithData:b options:0 error:e]:nil;if(!copy||![self assertCurrent:e])return nil;return copy;}}
-(void)retire{@synchronized(self){_retired=YES;}}
-(BOOL)join:(NSError**)e{@synchronized(self){if(!_retired||_busy){if(e)*e=problem(@"IDE_CLOUD_MAPPING_JOIN_PENDING");return NO;}return YES;}}
-(BOOL)close:(NSError**)e{@synchronized(self){_retired=YES;if(_closed)return YES;if(_busy){if(e)*e=problem(@"IDE_CLOUD_MAPPING_CLOSE_PENDING");return NO;}if(_closeSelected){if(e)*e=_first?:problem(@"IDE_CLOUD_MAPPING_CLOSE_UNKNOWN");return NO;}_closeSelected=YES;
 // Borrower never closes or retires project/parent Source. Own physical children
 // only; ambiguous child close parks SAME owner and stops earlier parents.
 for(auto pair:{std::make_pair(&_profile,&_profileCloseSelected),std::make_pair(&_workspace,&_workspaceCloseSelected)})if(*pair.first>=0){if(*pair.second){if(e)*e=problem(@"IDE_CLOUD_MAPPING_CLOSE_UNKNOWN");return NO;}*pair.second=YES;if(closeOwnedFD(*pair.first)){if(!_first)_first=problem(@"IDE_CLOUD_MAPPING_FD_CLOSE_UNKNOWN");if(e)*e=_first;return NO;}*pair.first=-1;}
 if(_hold){_hold->retire();auto result=_hold->close();if(!_hold->closed()){if(!_first)_first=problem(@"IDE_CLOUD_MAPPING_ROOT_CHILD_CLOSE_UNKNOWN");if(e)*e=_first;return NO;}if(result!=physical::Code::ok&&!_first)_first=problem(@"IDE_CLOUD_MAPPING_ORIGINAL_CURRENT_FAILED");_hold.reset();}
 _project=nil;_parentSource=nil;_parent=nil;_closed=YES;return YES;
}}
-(BOOL)cleanupComplete{@synchronized(self){return _closed;}}
-(NSError*)firstCause{@synchronized(self){return _first;}}
@end
