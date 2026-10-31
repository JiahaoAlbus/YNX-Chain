#import "proof_profile.h"
#import <CommonCrypto/CommonDigest.h>
#import <sys/file.h>
#import <sys/stat.h>
#import <fcntl.h>
#import <unistd.h>

static void fail(NSError **error, NSString *message) {
  if(error)*error=[NSError errorWithDomain:@"YNXNetworkQAProfile" code:2 userInfo:@{NSLocalizedDescriptionKey:message}];
}
static BOOL hex64(id value) {
  return [value isKindOfClass:NSString.class]&&[value length]==64&&[value rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"]invertedSet]].location==NSNotFound;
}
static NSString *sha(NSData *raw) {
  unsigned char result[CC_SHA256_DIGEST_LENGTH];CC_SHA256(raw.bytes,(CC_LONG)raw.length,result);NSMutableString *out=[NSMutableString string];for(unsigned i=0;i<sizeof(result);i++)[out appendFormat:@"%02x",result[i]];return out;
}
static BOOL same(struct stat a,struct stat b) {
  return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
}
static NSData *readBound(NSString *path,NSUInteger limit,BOOL owner,BOOL optional,NSError **error) {
  struct stat before,opened,after,named;if(lstat(path.fileSystemRepresentation,&before)!=0){if(optional&&errno==ENOENT)return nil;fail(error,@"Public context or local profile is unavailable; the original file was preserved.");return nil;}
  if(!S_ISREG(before.st_mode)||before.st_size<=0||(uint64_t)before.st_size>limit||(before.st_mode&0022)||(owner&&(before.st_uid!=geteuid()||(before.st_mode&0077)||before.st_nlink!=1))){fail(error,@"Unsafe file type, owner, permissions or size; no helper was started.");return nil;}
  int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0||fstat(fd,&opened)||!same(before,opened)){if(fd>=0)close(fd);fail(error,@"File was replaced while opening; no configuration was changed.");return nil;}
  NSMutableData *raw=[NSMutableData dataWithLength:(NSUInteger)opened.st_size];NSUInteger count=0;while(count<raw.length){ssize_t n=read(fd,(char*)raw.mutableBytes+count,raw.length-count);if(n<0&&errno==EINTR)continue;if(n<=0)break;count+=(NSUInteger)n;}
  BOOL valid=count==raw.length&&!fstat(fd,&after)&&!lstat(path.fileSystemRepresentation,&named)&&same(opened,after)&&same(after,named);close(fd);if(!valid){fail(error,@"File changed during capture; no configuration was changed.");return nil;}return raw;
}
int QAAcquireSession(NSString *directory,NSError **error) {
  NSString *path=[directory stringByAppendingPathComponent:@"qa-session.lock"];struct stat named,opened;
  int fd=open(path.fileSystemRepresentation,O_RDWR|O_CREAT|O_NOFOLLOW,0600);
  if(fd<0||fstat(fd,&opened)||lstat(path.fileSystemRepresentation,&named)||!S_ISREG(opened.st_mode)||opened.st_uid!=geteuid()||(opened.st_mode&0077)||opened.st_nlink!=1||opened.st_dev!=named.st_dev||opened.st_ino!=named.st_ino||flock(fd,LOCK_EX|LOCK_NB)){
    if(fd>=0)close(fd);fail(error,@"This QA version is already running, or its private session lock is unsafe. Quit that App before configuring from the CLI.");return -1;
  }return fd;
}
@interface QAProofProfile()
@property NSString *directory;@property NSString *buildID;@property NSString *sourceRevision;@property NSData *loadedBytes;@property BOOL observed;@property unsigned long long loadedDevice;@property unsigned long long loadedInode;
@end
@implementation QAProofProfile
-(instancetype)initWithDirectory:(NSString*)directory build:(NSDictionary*)build {
  if((self=[super init])){_directory=directory;_buildID=build[@"buildID"];_sourceRevision=build[@"sourceRevision"];}return self;
}
-(NSString*)path{return [self.directory stringByAppendingPathComponent:@"proof-profile.json"];}
-(BOOL)identity:(NSDictionary*)doc {
  NSSet *keys=[NSSet setWithArray:@[@"version",@"buildID",@"sourceRevision",@"ownerUID",@"contextPath",@"contextSHA256"]];
  if(![doc isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:doc.allKeys]isEqual:keys])return NO;
  for(id value in doc.allValues)if(![value isKindOfClass:NSString.class])return NO;
  return [doc[@"version"]isEqual:@"YNX-NETWORK-QA-PROOF-PROFILE/v1"]&&[doc[@"buildID"]isEqual:self.buildID]&&[doc[@"sourceRevision"]isEqual:self.sourceRevision]&&[doc[@"ownerUID"]isEqual:[NSString stringWithFormat:@"%u",geteuid()]];
}
-(NSDictionary*)candidateForPath:(NSString*)path independentSHA256:(NSString*)input error:(NSError**)error {
  // The digest is supplied by a person through an independent channel. It is
  // never generated, completed, fetched from RPC, or shown as an approval.
  // Preserve the chosen absolute spelling. Foundation standardization may
  // rewrite an existing /private/tmp path to /tmp; that is not a trust failure.
  NSString *pin=[input lowercaseString];if(![path isKindOfClass:NSString.class]||!path.isAbsolutePath||[path lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>4096||[path rangeOfString:[NSString stringWithFormat:@"%C",(unichar)0]].location!=NSNotFound||!hex64(pin)) {fail(error,@"Choose an absolute original public context file and enter its exact independent 64-hex SHA256. No digest is generated for you.");return nil;}
  NSData *raw=readBound(path,16<<20,NO,NO,error);if(!raw)return nil;if(![sha(raw)isEqual:pin]){fail(error,@"The selected file does not match the independently entered SHA256. The old configuration and session were preserved.");return nil;}
  return @{@"version":@"YNX-NETWORK-QA-PROOF-PROFILE/v1",@"buildID":self.buildID,@"sourceRevision":self.sourceRevision,@"ownerUID":[NSString stringWithFormat:@"%u",geteuid()],@"contextPath":path,@"contextSHA256":pin};
}
-(NSDictionary*)readRecord:(NSError**)error {
  NSData *raw=readBound(self.path,16384,YES,YES,error);if(!raw){if(error&&*error)return nil;if(self.observed&&self.loadedBytes){fail(error,@"The configured profile disappeared; the App will not silently remove proof configuration.");return nil;}self.observed=YES;return nil;}
  struct stat identity;if(lstat(self.path.fileSystemRepresentation,&identity)){fail(error,@"The profile disappeared after capture; no helper was started.");return nil;}
  if(self.observed&&(!self.loadedBytes||![self.loadedBytes isEqual:raw]||self.loadedDevice!=(unsigned long long)identity.st_dev||self.loadedInode!=(unsigned long long)identity.st_ino)){fail(error,@"The local profile was replaced during this session; no helper was started.");return nil;}
  NSDictionary *doc=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];NSData *canonical=[doc isKindOfClass:NSDictionary.class]?[NSJSONSerialization dataWithJSONObject:doc options:NSJSONWritingSortedKeys error:nil]:nil;
  if(![self identity:doc]||![canonical isEqual:raw]){fail(error,@"The private profile is damaged or belongs to another owner/build. It was preserved; no helper was started.");return nil;}
  self.loadedBytes=raw;self.loadedDevice=(unsigned long long)identity.st_dev;self.loadedInode=(unsigned long long)identity.st_ino;self.observed=YES;return doc;
}
-(BOOL)checkStoredRecord:(NSError**)error {
  NSError *local=nil;[self readRecord:&local];if(local){if(error)*error=local;return NO;}return YES;
}
-(NSDictionary*)load:(NSError**)error {
  NSDictionary *doc=[self readRecord:error];if(!doc)return nil;
  return [self candidateForPath:doc[@"contextPath"] independentSHA256:doc[@"contextSHA256"] error:error];
}
-(BOOL)save:(NSDictionary*)candidate error:(NSError**)error {
  if(![self identity:candidate]){fail(error,@"Profile identity does not match this QA owner/build.");return NO;}
  NSError *readError=nil;[self readRecord:&readError];if(readError){if(error)*error=readError;return NO;}
  if(![self candidateForPath:candidate[@"contextPath"] independentSHA256:candidate[@"contextSHA256"] error:error])return NO;
  NSData *raw=[NSJSONSerialization dataWithJSONObject:candidate options:NSJSONWritingSortedKeys error:error];if(!raw)return NO;
  // Preserve prior successful profiles, while never rewriting damaged input.
  if(self.loadedBytes){NSString *archive=[self.directory stringByAppendingPathComponent:[NSString stringWithFormat:@"proof-profile.previous-%@.json",sha(self.loadedBytes)]];int old=open(archive.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(old>=0){BOOL ok=write(old,self.loadedBytes.bytes,self.loadedBytes.length)==(ssize_t)self.loadedBytes.length&&fsync(old)==0;close(old);if(!ok){fail(error,@"Could not preserve the previous profile. No configuration was changed.");return NO;}}else if(errno!=EEXIST){fail(error,@"Could not preserve the previous profile. No configuration was changed.");return NO;}else{NSData *previous=readBound(archive,16384,YES,NO,error);if(![previous isEqual:self.loadedBytes]){fail(error,@"Previous profile archive changed. All files were preserved.");return NO;}}}
  NSString *temporary=[self.directory stringByAppendingPathComponent:[@".proof-profile-"stringByAppendingString:NSUUID.UUID.UUIDString]];int fd=open(temporary.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0){fail(error,@"Could not stage a private profile.");return NO;}BOOL ok=write(fd,raw.bytes,raw.length)==(ssize_t)raw.length&&fsync(fd)==0;close(fd);
  // Recheck the prior bytes just before replacing our own successful record.
  NSError *changed=nil;[self readRecord:&changed];if(changed)ok=NO;
  if(ok)ok=rename(temporary.fileSystemRepresentation,self.path.fileSystemRepresentation)==0;
  if(!ok){fail(error,changed.localizedDescription?:@"Profile save failed; staged and prior files were preserved.");return NO;}
  int dir=open(self.directory.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_CLOEXEC);BOOL synced=dir>=0&&fsync(dir)==0;if(dir>=0)close(dir);struct stat saved;if(lstat(self.path.fileSystemRepresentation,&saved)){fail(error,@"Saved profile disappeared; no helper was started.");return NO;}self.loadedBytes=raw;self.loadedDevice=(unsigned long long)saved.st_dev;self.loadedInode=(unsigned long long)saved.st_ino;self.observed=YES;
  if(!synced){fail(error,@"Profile rename completed but durable directory sync failed. Restart must read the preserved profile; no helper was started.");return NO;}return YES;
}
@end
