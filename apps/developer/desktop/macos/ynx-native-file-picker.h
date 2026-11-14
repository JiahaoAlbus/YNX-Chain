// Pure native picker boundary helpers. No caller-supplied path is an admission.
#import <Foundation/Foundation.h>
#import <sys/stat.h>
#import <stdlib.h>
#import <errno.h>
#import <fcntl.h>
#import <unistd.h>
#import <sys/param.h>
static BOOL YNXNativeFileName(id name) {
    return [name isKindOfClass:NSString.class]&&[name length]>0&&[name lengthOfBytesUsingEncoding:NSUTF8StringEncoding]<=255&&![name isEqual:@"."]&&![name isEqual:@".."]&&[name rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"/\\"]].location==NSNotFound&&[name rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location==NSNotFound;
}
static BOOL YNXNativePickerPayload(id body) {
    return [body isKindOfClass:NSDictionary.class]&&[body count]==3&&[body[@"action"] isEqual:@"pick-file"]&&[body[@"requestId"] isKindOfClass:NSString.class]&&[[NSUUID alloc]initWithUUIDString:body[@"requestId"]]&&[@[@"file",@"folder",@"workspace",@"any"] containsObject:body[@"kind"]];
}
static BOOL YNXNativeSavePickerPayload(id body) {
    if(![body isKindOfClass:NSDictionary.class]||([body count]!=4&&[body count]!=5)||![body[@"requestId"] isKindOfClass:NSString.class]||![[NSUUID alloc]initWithUUIDString:body[@"requestId"]])return NO;
    id kind=body[@"kind"]?:NSNull.null;
    if([body[@"action"] isEqual:@"prepare-create"]){
        if(![@[@"create",@"create-folder"] containsObject:kind])return NO;
    }else if(![body[@"action"] isEqual:@"pick-file"]||![@[@"save",@"create",@"create-folder"] containsObject:kind])return NO;
    id directory=body[@"directoryUri"];
    if([body count]!=(directory?5:4)||
       (directory&&(![directory isKindOfClass:NSString.class]||![directory length]||[directory lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>16384)))return NO;
    return YNXNativeFileName(body[@"name"]);
}
static NSString *YNXNativePickedPath(NSURL *url) {
    if(![url isKindOfClass:NSURL.class]||!url.isFileURL||!url.path.isAbsolutePath)return nil;
    char *resolved=realpath(url.path.fileSystemRepresentation,NULL);if(!resolved)return nil;
    NSString *path=[NSString stringWithUTF8String:resolved];free(resolved);struct stat st;
    return lstat(path.fileSystemRepresentation,&st)==0&&(S_ISREG(st.st_mode)||S_ISDIR(st.st_mode))?path:nil;
}
static BOOL YNXNativePathInside(NSString *path,NSString *root) {
    return path&&root&&([path isEqual:root]||[path hasPrefix:[root stringByAppendingString:@"/"]]);
}
// The Explorer hint can place the panel, but cannot admit a project or
// authorize a destination. Verify it against the already admitted root.
static NSString *YNXNativeSaveDirectory(id hint,NSString *root) {
    if(!hint)return root;
    if(![hint isKindOfClass:NSString.class])return nil;
    NSURLComponents *components=[NSURLComponents componentsWithString:hint];
    if(![components.scheme isEqual:@"file"]||components.host.length||components.user||components.password||components.port||components.query||components.fragment)return nil;
    NSURL *url=components.URL;
    NSString *path=url.path;
    if(!path.isAbsolutePath||[path rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound||
       !YNXNativePathInside(path,root))return nil;
    NSString *canonical=YNXNativePickedPath(url);struct stat st;
    if(![canonical isEqual:path]||lstat(canonical.fileSystemRepresentation,&st)!=0||!S_ISDIR(st.st_mode))return nil;
    return canonical;
}
static NSString *YNXNativeSavePath(NSURL *url,NSString *root) {
    if(![url isKindOfClass:NSURL.class]||!url.isFileURL||!url.path.isAbsolutePath)return nil;
    NSString *parent=YNXNativePickedPath(url.URLByDeletingLastPathComponent);struct stat st;
    if(!YNXNativePathInside(parent,root)||lstat(parent.fileSystemRepresentation,&st)!=0||!S_ISDIR(st.st_mode))return nil;
    NSString *name=url.lastPathComponent;if(!name.length||[name isEqual:@"."]||[name isEqual:@".."])return nil;
    NSString *path=[parent stringByAppendingPathComponent:name];
    if(lstat(path.fileSystemRepresentation,&st)==0)return S_ISREG(st.st_mode)?path:nil;
    return errno==ENOENT?path:nil;
}
// Apply creation once, against an opened canonical parent. In particular a
// file that appears while the panel is open must survive with its bytes intact.
static int YNXNativeOpenCreateParent(NSString *root,NSString *parent,const struct stat *identity,int *directory) {
    if(!identity||!YNXNativePathInside(parent,root))return EINVAL;
    int fd=open(root.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW_ANY|O_CLOEXEC);
    if(fd<0)return errno;
    struct stat current;
    if(fstat(fd,&current)||current.st_dev!=identity->st_dev||current.st_ino!=identity->st_ino){close(fd);return EINVAL;}
    if(![parent isEqual:root]){
        NSString *relative=[parent substringFromIndex:root.length+1];
        for(NSString *part in [relative componentsSeparatedByString:@"/"]){
            if(!YNXNativeFileName(part)){close(fd);return EINVAL;}
            int child=openat(fd,part.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
            int failure=errno;close(fd);
            if(child<0)return failure;
            fd=child;
        }
    }
    char actual[MAXPATHLEN];
    int result=0;
    if(fcntl(fd,F_GETPATH,actual)<0)result=errno;
    else if(![[NSString stringWithUTF8String:actual] isEqual:parent])result=EINVAL;
    if(result){close(fd);return result;}
    *directory=fd;
    return 0;
}
static int YNXNativeCommitCreate(NSString *root,NSString *parent,NSString *name,BOOL folder,const struct stat *rootIdentity,const struct stat *parentIdentity,NSDictionary **metadata) {
    if(!YNXNativeFileName(name))return EINVAL;
    int fd;
    int result=YNXNativeOpenCreateParent(root,parent,rootIdentity,&fd);
    if(result)return result;
    struct stat current,createdStat;
    if(parentIdentity&&(fstat(fd,&current)||current.st_dev!=parentIdentity->st_dev||current.st_ino!=parentIdentity->st_ino)){close(fd);return EINVAL;}
    BOOL hasStat=NO;
    if(folder){
        if(mkdirat(fd,name.fileSystemRepresentation,0777)<0)result=errno;
        else if(metadata)hasStat=fstatat(fd,name.fileSystemRepresentation,&createdStat,AT_SYMLINK_NOFOLLOW)==0&&S_ISDIR(createdStat.st_mode);
    }
    else{
        int created=openat(fd,name.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0666);
        if(created<0)result=errno;
        else{if(metadata)hasStat=fstat(created,&createdStat)==0;close(created);}
    }
    close(fd);
    if(metadata&&hasStat)*metadata=@{@"type":@(folder?2:1),
        @"ctime":@(createdStat.st_ctimespec.tv_sec*1000.0+createdStat.st_ctimespec.tv_nsec/1000000.0),
        @"mtime":@(createdStat.st_mtimespec.tv_sec*1000.0+createdStat.st_mtimespec.tv_nsec/1000000.0),
        @"size":@(createdStat.st_size)};
    return result;
}
static int YNXNativeCreateEntry(NSString *root,NSString *parent,NSString *name,BOOL folder,const struct stat *identity) {
    return YNXNativeCommitCreate(root,parent,name,folder,identity,NULL,NULL);
}
static BOOL YNXNativeCreateTokenPayload(NSDictionary *body) {
    return body.count==3&&[@[@"commit-create",@"cancel-create"] containsObject:body[@"action"]?:NSNull.null]&&
        [body[@"requestId"] isKindOfClass:NSString.class]&&[[NSUUID alloc]initWithUUIDString:body[@"requestId"]]&&
        [body[@"token"] isKindOfClass:NSString.class]&&[[NSUUID alloc]initWithUUIDString:body[@"token"]];
}

@interface YNXNativeCreateLease : NSObject {
@public
    struct stat rootIdentity;
    struct stat parentIdentity;
}
@property(nonatomic,copy) NSString *token;
@property(nonatomic,copy) NSString *name;
@property(nonatomic,copy) NSString *parent;
@property(nonatomic,copy) NSString *uri;
@property(nonatomic,copy) NSString *document;
@property(nonatomic,copy) NSDictionary *binding;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) NSTimeInterval expires;
@property(nonatomic) BOOL folder;
@property(nonatomic) int parentFD;
@end
@implementation YNXNativeCreateLease
- (instancetype)init {
    if((self=[super init]))_parentFD=-1;
    return self;
}
- (void)dealloc { if(_parentFD>=0)close(_parentFD); }
@end
static YNXNativeCreateLease *YNXNativePrepareCreate(NSDictionary *binding,NSString *name,NSString *parent,const struct stat *identity,BOOL folder,NSUInteger generation,NSString *document) {
    if(!YNXNativeFileName(name)||!document.length)return nil;
    int fd;
    if(YNXNativeOpenCreateParent(binding[@"workspace"],parent,identity,&fd))return nil;
    YNXNativeCreateLease *lease=[YNXNativeCreateLease new];
    lease.parentFD=fd;
    if(fstat(fd,&lease->parentIdentity))return nil;
    lease->rootIdentity=*identity;
    lease.token=NSUUID.UUID.UUIDString.lowercaseString;
    lease.name=name;
    lease.parent=parent;
    lease.uri=[NSURL fileURLWithPath:[parent stringByAppendingPathComponent:name] isDirectory:folder].absoluteString;
    lease.binding=binding;
    lease.document=document;
    lease.generation=generation;
    lease.folder=folder;
    lease.expires=NSProcessInfo.processInfo.systemUptime+15;
    return lease;
}
static BOOL YNXNativeCreateLeaseCurrent(YNXNativeCreateLease *lease,NSUInteger generation,NSString *document,NSTimeInterval now) {
    return lease&&lease.generation==generation&&[lease.document isEqual:document]&&now<lease.expires;
}
static NSString *YNXNativeInitialFile(id input,NSString *root,id selection) {
    if(![selection isEqual:@"native-panel"]||![input isKindOfClass:NSString.class]||![input isAbsolutePath])return nil;
    NSString *canonical=YNXNativePickedPath([NSURL fileURLWithPath:input]);struct stat st;
    return canonical&&[canonical isEqual:input]&&[canonical.stringByDeletingLastPathComponent isEqual:root]&&lstat(canonical.fileSystemRepresentation,&st)==0&&S_ISREG(st.st_mode)?canonical:nil;
}
