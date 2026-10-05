#import <Foundation/Foundation.h>
#import <fcntl.h>
#import <sys/stat.h>
#import <unistd.h>
#import <stdio.h>

// Native-owned, one-request approval snapshot. No page/extension supplies a
// descriptor, staging location, absolute path, or replacement authorization.
static NSError *YNXTrashError(NSInteger code,NSString *message){return [NSError errorWithDomain:@"YNXNativeTrash" code:code userInfo:@{NSLocalizedDescriptionKey:message}];}
static BOOL YNXTrashWithin(NSString *path,NSString *root){return [path isEqual:root]||[path hasPrefix:[root stringByAppendingString:@"/"]];}
static BOOL YNXTrashSame(struct stat a,struct stat b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_mode==b.st_mode;}
static NSString *YNXTrashFDPath(int fd){char path[PATH_MAX];return fcntl(fd,F_GETPATH,path)==0?[NSString stringWithUTF8String:path]:nil;}
static BOOL YNXTrashRelative(id value){if(![value isKindOfClass:NSString.class]||![value length]||[value length]>4096||[value hasPrefix:@"/"]||[value rangeOfCharacterFromSet:[NSCharacterSet controlCharacterSet]].location!=NSNotFound)return NO;for(NSString *part in [value componentsSeparatedByString:@"/"])if(!part.length||[part isEqual:@"."]||[part isEqual:@".."]||[part lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>NAME_MAX)return NO;return YES;}
static BOOL YNXTrashPayload(id body){return [body isKindOfClass:NSDictionary.class]&&[body count]==3&&[body[@"action"] isEqual:@"trash"]&&[body[@"requestId"] isKindOfClass:NSString.class]&&[body[@"requestId"] length]==36&&[[NSUUID alloc]initWithUUIDString:body[@"requestId"]]&&YNXTrashRelative(body[@"relativePath"]);}

@interface YNXNativeTrashRequest:NSObject {
    NSMutableArray<NSDictionary *> *_chain;
    NSMutableArray<NSDictionary *> *_aliases;
    int _rootFD,_parentFD,_stageParentFD;
    struct stat _target;
    NSString *_root,*_name,*_stageParent;
    BOOL _consumed;
}
@property(nonatomic,readonly,copy) NSString *relativePath;
@property(nonatomic,readonly,copy) NSString *recoveryPath;
@property(nonatomic,readonly,strong) NSURL *trashedURL;
#ifdef YNX_NATIVE_TRASH_TESTING
@property(nonatomic,copy) void(^beforeCapture)(void);
@property(nonatomic,copy) void(^afterCapture)(void);
@property(nonatomic) BOOL forceFailure;
#endif
+ (instancetype)bindRoot:(NSString *)root excluded:(NSArray<NSString *> *)excluded error:(NSError **)error;
+ (instancetype)prepareBoundary:(YNXNativeTrashRequest *)boundary relative:(NSString *)relative error:(NSError **)error;
+ (instancetype)prepareRoot:(NSString *)root relative:(NSString *)relative excluded:(NSArray<NSString *> *)excluded error:(NSError **)error;
- (BOOL)commitApproved:(BOOL)approved error:(NSError **)error;
@end
@implementation YNXNativeTrashRequest
- (instancetype)init {if((self=[super init])){_chain=[NSMutableArray new];_aliases=[NSMutableArray new];_rootFD=_parentFD=_stageParentFD=-1;}return self;}
- (void)dealloc {for(NSDictionary *entry in _chain)close([entry[@"fd"] intValue]);}
- (BOOL)retainDirectory:(int)fd path:(NSString *)path error:(NSError **)error {
    struct stat st;if(fd<0||fstat(fd,&st)||!S_ISDIR(st.st_mode)||((st.st_mode&0022)&&!(st.st_uid==0&&(st.st_mode&S_ISVTX)))){if(fd>=0)close(fd);if(error)*error=YNXTrashError(2,@"The selected project has an unsafe or replaced directory boundary.");return NO;}
    NSString *kernel=YNXTrashFDPath(fd);struct stat literal;if(!kernel||lstat(path.fileSystemRepresentation,&literal)||!YNXTrashSame(st,literal)){close(fd);if(error)*error=YNXTrashError(2,@"The directory path is not the retained vnode.");return NO;}
    for(NSString *alias=kernel;;alias=alias.stringByDeletingLastPathComponent){struct stat a;if(lstat(alias.fileSystemRepresentation,&a)||S_ISLNK(a.st_mode)||!S_ISDIR(a.st_mode)||((a.st_mode&0022)&&!(a.st_uid==0&&(a.st_mode&S_ISVTX)))){close(fd);if(error)*error=YNXTrashError(2,@"The native path alias has an unsafe ancestor.");return NO;}[_aliases addObject:@{@"path":alias,@"stat":[NSData dataWithBytes:&a length:sizeof(a)]}];if([alias isEqual:@"/"])break;}
    [_chain addObject:@{@"fd":@(fd),@"path":path,@"kernel":kernel,@"stat":[NSData dataWithBytes:&st length:sizeof(st)]}];return YES;
}
- (BOOL)validateDirectories {
    for(NSDictionary *entry in _chain){struct stat expected,current;[entry[@"stat"] getBytes:&expected length:sizeof(expected)];int fd=[entry[@"fd"] intValue];if(fstat(fd,&current)||!YNXTrashSame(expected,current)||![YNXTrashFDPath(fd) isEqual:entry[@"kernel"]])return NO;struct stat byPath;if(lstat([entry[@"path"] fileSystemRepresentation],&byPath)||!YNXTrashSame(expected,byPath))return NO;}
    for(NSDictionary *entry in _aliases){struct stat old,current;[entry[@"stat"] getBytes:&old length:sizeof(old)];if(lstat([entry[@"path"] fileSystemRepresentation],&current)||!YNXTrashSame(old,current))return NO;}return YES;
}
+ (instancetype)bindRoot:(NSString *)root excluded:(NSArray<NSString *> *)excluded error:(NSError **)error {
    if(![root isKindOfClass:NSString.class]||![root hasPrefix:@"/"]||[root isEqual:@"/"]||!YNXTrashRelative([root substringFromIndex:1])){if(error)*error=YNXTrashError(1,@"Select an existing item inside the current project.");return nil;}
    YNXNativeTrashRequest *request=[self new];request->_root=[root copy];
    int fd=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(![request retainDirectory:fd path:@"/" error:error])return nil;NSString *path=@"/";
    for(NSString *part in [root componentsSeparatedByString:@"/"]){if(!part.length)continue;int next=openat(fd,part.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);path=[path stringByAppendingPathComponent:part];if(![request retainDirectory:next path:path error:error])return nil;fd=next;}
    request->_rootFD=fd;request->_stageParent=root.stringByDeletingLastPathComponent;
    NSDictionary *parentEntry=request->_chain[request->_chain.count-2];request->_stageParentFD=[parentEntry[@"fd"] intValue];struct stat rootStat,parentStat;
    if(fstat(fd,&rootStat)||fstat(request->_stageParentFD,&parentStat)||rootStat.st_uid!=getuid()||parentStat.st_uid!=getuid()||(parentStat.st_mode&0022)||rootStat.st_dev!=parentStat.st_dev){if(error)*error=YNXTrashError(3,@"A private staging directory on this project's volume is unavailable. The file was retained.");return nil;}
    // Exclude every sandbox-writable alias, profile, temporary and special root.
    // Stage is a sibling, never an entry beneath the project granted to children.
    NSMutableArray *grants=[[excluded arrayByAddingObject:root] mutableCopy];for(NSString *grant in [grants copy]){int aliasFD=open(grant.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(aliasFD>=0){struct stat granted;if(!fstat(aliasFD,&granted)){for(NSUInteger index=0;index+1<request->_chain.count;index++){struct stat ancestor;[request->_chain[index][@"stat"] getBytes:&ancestor length:sizeof(ancestor)];if(granted.st_dev==ancestor.st_dev&&granted.st_ino==ancestor.st_ino){close(aliasFD);if(error)*error=YNXTrashError(3,@"The staging parent belongs to a sandbox-accessible directory alias. The item was retained.");return nil;}}}NSString *alias=YNXTrashFDPath(aliasFD);if(alias)[grants addObject:alias];close(aliasFD);}}
    NSString *kernelParent=YNXTrashFDPath(request->_stageParentFD);
    for(NSString *grant in grants)if(![grant isKindOfClass:NSString.class]||![grant hasPrefix:@"/"]||(YNXTrashWithin(request->_stageParent,grant)||YNXTrashWithin(kernelParent,grant))){if(error)*error=YNXTrashError(3,@"This project cannot safely stage a recoverable Trash operation. The file was retained.");return nil;}
    return request;
}
+ (instancetype)prepareRoot:(NSString *)root relative:(NSString *)relative excluded:(NSArray<NSString *> *)excluded error:(NSError **)error {
    YNXNativeTrashRequest *boundary=[self bindRoot:root excluded:excluded error:error];return boundary?[self prepareBoundary:boundary relative:relative error:error]:nil;
}
+ (instancetype)prepareBoundary:(YNXNativeTrashRequest *)boundary relative:(NSString *)relative error:(NSError **)error {
    if(![boundary isKindOfClass:self]||!YNXTrashRelative(relative)||![boundary validateDirectories]){if(error)*error=YNXTrashError(6,@"The admitted project boundary or requested item changed.");return nil;}
    YNXNativeTrashRequest *request=[self new];request->_root=boundary->_root;request->_relativePath=[relative copy];request->_name=relative.lastPathComponent;request->_stageParent=boundary->_stageParent;
    for(NSDictionary *entry in boundary->_chain){int original=[entry[@"fd"] intValue],copy=fcntl(original,F_DUPFD_CLOEXEC,0);if(copy<0){if(error)*error=YNXTrashError(2,@"The project boundary could not be retained.");return nil;}NSMutableDictionary *retained=[entry mutableCopy];retained[@"fd"]=@(copy);[request->_chain addObject:retained];if(original==boundary->_rootFD)request->_rootFD=copy;if(original==boundary->_stageParentFD)request->_stageParentFD=copy;}
    int fd=request->_rootFD;NSString *path=request->_root;struct stat rootStat;if(fstat(fd,&rootStat)){if(error)*error=YNXTrashError(2,@"The project boundary was lost.");return nil;}
    request->_aliases=[boundary->_aliases mutableCopy];
    NSArray *parts=[relative componentsSeparatedByString:@"/"];for(NSUInteger i=0;i+1<parts.count;i++){NSString *part=parts[i];int next=openat(fd,part.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);path=[path stringByAppendingPathComponent:part];if(![request retainDirectory:next path:path error:error])return nil;fd=next;}
    request->_parentFD=fd;
    if(fstatat(fd,request->_name.fileSystemRepresentation,&request->_target,AT_SYMLINK_NOFOLLOW)||(!S_ISREG(request->_target.st_mode)&&!S_ISDIR(request->_target.st_mode)&&!S_ISLNK(request->_target.st_mode))||request->_target.st_uid!=getuid()||request->_target.st_dev!=rootStat.st_dev||request->_target.st_ino==rootStat.st_ino){if(error)*error=YNXTrashError(4,@"The item is missing, linked, outside the selected volume, or unsupported. It was retained.");return nil;}
    if(![request validateDirectories]){if(error)*error=YNXTrashError(2,@"The selected project changed while preparing Trash.");return nil;}return request;
}
- (BOOL)commitApproved:(BOOL)approved error:(NSError **)error {
    if(_consumed){if(error)*error=YNXTrashError(6,@"This native approval was already used.");return NO;}_consumed=YES;
    if(!approved){if(error)*error=YNXTrashError(5,@"Move to Trash was cancelled.");return NO;}
    struct stat before;if(![self validateDirectories]||fstatat(_parentFD,_name.fileSystemRepresentation,&before,AT_SYMLINK_NOFOLLOW)||!YNXTrashSame(before,_target)){if(error)*error=YNXTrashError(6,@"The approved item or project changed. Nothing was moved to Trash.");return NO;}
    NSString *stageName=[@".ynx-native-trash-" stringByAppendingString:NSUUID.UUID.UUIDString.lowercaseString];
    if(mkdirat(_stageParentFD,stageName.fileSystemRepresentation,0700)){if(error)*error=YNXTrashError(3,@"Private same-volume Trash staging could not be created. The item was retained.");return NO;}
    int stage=openat(_stageParentFD,stageName.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);NSString *stagePath=[_stageParent stringByAppendingPathComponent:stageName];struct stat st;BOOL valid=stage>=0&&!fstat(stage,&st)&&S_ISDIR(st.st_mode)&&st.st_uid==getuid()&&(st.st_mode&0777)==0700&&st.st_dev==_target.st_dev&&[self validateDirectories];
    if(!valid){if(stage>=0)close(stage);if(error)*error=YNXTrashError(3,@"Private Trash staging changed. The item was retained.");return NO;}
#ifdef YNX_NATIVE_TRASH_TESTING
    if(self.beforeCapture)self.beforeCapture();
#endif
    if(renameatx_np(_parentFD,_name.fileSystemRepresentation,stage,_name.fileSystemRepresentation,RENAME_EXCL)){close(stage);if(error)*error=YNXTrashError(6,@"The item could not be captured safely. It was retained.");return NO;}
    NSString *kernelStage=YNXTrashFDPath(stage);_recoveryPath=[stagePath stringByAppendingPathComponent:_name];
#ifdef YNX_NATIVE_TRASH_TESTING
    if(self.afterCapture)self.afterCapture();
#endif
    struct stat captured,stageNow;BOOL same=!fstatat(stage,_name.fileSystemRepresentation,&captured,AT_SYMLINK_NOFOLLOW)&&YNXTrashSame(captured,_target)&&[self validateDirectories]&&[YNXTrashFDPath(stage) isEqual:kernelStage]&&!fstatat(_stageParentFD,stageName.fileSystemRepresentation,&stageNow,AT_SYMLINK_NOFOLLOW)&&YNXTrashSame(st,stageNow);
    NSError *failure=nil;BOOL moved=NO;NSURL *destination=nil;
    if(same){
#ifdef YNX_NATIVE_TRASH_TESTING
        if(self.forceFailure)failure=YNXTrashError(7,@"Test-only injected system failure after actual capture.");else
#endif
        moved=[NSFileManager.defaultManager trashItemAtURL:[NSURL fileURLWithPath:_recoveryPath] resultingItemURL:&destination error:&failure];
    }else failure=YNXTrashError(6,@"The captured item did not match the native approval. It was not trashed.");
    struct stat destinationStat;BOOL verifiedDestination=moved&&destination.isFileURL&&!lstat(destination.path.fileSystemRepresentation,&destinationStat)&&YNXTrashSame(destinationStat,_target);
    if(verifiedDestination){_trashedURL=destination;_recoveryPath=nil;if([self validateDirectories]&&!fstatat(_stageParentFD,stageName.fileSystemRepresentation,&stageNow,AT_SYMLINK_NOFOLLOW)&&YNXTrashSame(st,stageNow))unlinkat(_stageParentFD,stageName.fileSystemRepresentation,AT_REMOVEDIR);close(stage);return YES;}
    struct stat remaining;if(fstatat(stage,_name.fileSystemRepresentation,&remaining,AT_SYMLINK_NOFOLLOW)){_recoveryPath=nil;close(stage);if(error)*error=YNXTrashError(9,@"The staged item is no longer present, and no exact Trash destination or restored copy was verified. Its recovery location is unknown.");return NO;}
    // Only restore into a vacant original entry. Never overwrite a new file and
    // never unlink either item. Failed restoration leaves a recoverable staging URL.
    if(renameatx_np(stage,_name.fileSystemRepresentation,_parentFD,_name.fileSystemRepresentation,RENAME_EXCL)==0)_recoveryPath=nil;
    if(!_recoveryPath&&[self validateDirectories]&&!fstatat(_stageParentFD,stageName.fileSystemRepresentation,&stageNow,AT_SYMLINK_NOFOLLOW)&&YNXTrashSame(st,stageNow)){if(unlinkat(_stageParentFD,stageName.fileSystemRepresentation,AT_REMOVEDIR)&&errno==ENOTEMPTY)_recoveryPath=stagePath;}
    close(stage);if(error)*error=_recoveryPath?YNXTrashError(8,[NSString stringWithFormat:@"Trash failed and the original location changed. The recoverable item remains at %@",_recoveryPath]):YNXTrashError(7,failure.localizedDescription?:@"Trash failed. The original item was restored.");return NO;
}
@end
