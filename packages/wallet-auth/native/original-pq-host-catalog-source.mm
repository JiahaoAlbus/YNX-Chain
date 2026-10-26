#import "original-pq-host-catalog-source.h"
#import "original-auth-identity-source-authority.h"
#include "original-pq-host-catalog-source-state.h"
#include "original-pq-host-catalog-task-exit.h"
#include "original-pq-host-catalog-receipt.h"
#include "original-source-verifier-io.h"
#include "original-ide-parent-kernel.h"
#include <CommonCrypto/CommonDigest.h>
#include <fcntl.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/stat.h>
#include <limits.h>
#include <vector>

static BOOL PQSourceExact(NSDictionary*d,NSArray*keys){return [d isKindOfClass:NSDictionary.class]&&[[NSSet setWithArray:d.allKeys]isEqual:[NSSet setWithArray:keys]];}
static NSString*PQSourceSHA(NSData*d){unsigned char b[CC_SHA256_DIGEST_LENGTH];CC_SHA256(d.bytes,(CC_LONG)d.length,b);NSMutableString*s=[NSMutableString string];for(auto c:b)[s appendFormat:@"%02x",c];return s;}
static BOOL PQSourceHex(id x){return [x isKindOfClass:NSString.class]&&[x length]==64&&[x rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"]invertedSet]].location==NSNotFound;}
static BOOL PQSourceSame(struct stat a,struct stat b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;}
static BOOL PQSourceParentSame(struct stat a,struct stat b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink;}
static BOOL PQSourceCanonicalPath(NSString*p){char real[PATH_MAX];return [p isKindOfClass:NSString.class]&&p.length&&realpath(p.fileSystemRepresentation,real)&&[p isEqual:[NSString stringWithUTF8String:real]];}
struct PQSourceHeld{int fd=-1;struct stat identity{};NSString*__strong path=nil;BOOL selected=NO,closed=NO;};

@implementation YNXOriginalPQHostCatalogSource {
 YNXAuthIdentitySourceAuthority*_source;
 NSDictionary*_context,*_scope,*_journal,*_pair;
 ynx_auth_ide_private::KernelProcess _wallet;
 ynx_auth_private::PQCatalogSourceAttempt _life;
 std::vector<PQSourceHeld> _held;
 int _parent;struct stat _parentIdentity;
 pthread_t _thread;
 NSTask*_task;NSMutableArray<NSFileHandle*>*_pipes;NSMutableArray<NSNumber*>*_pipeStates;
 NSData*_input,*_stdout,*_stderr;
 NSString*_workerFailure;
 NSError*_first,*_closeFirst;
 BOOL _ready,_prepared,_workerStarted,_workerFinished,_workerJoined,_taskLaunched,_existingOutcome,_reconcileExisting,_parentCloseSelected,_parentClosed;
 int _exitStatus;
}
- (instancetype)init{if((self=[super init])){_parent=-1;_exitStatus=-1;_thread=pthread_self();_pipes=[NSMutableArray array];_pipeStates=[NSMutableArray array];}return self;}
- (BOOL)fail:(NSString*)code error:(NSError**)error{_ready=NO;_life.fail("PQ_HOST_SOURCE_UNKNOWN");if(!_first)_first=[NSError errorWithDomain:@"YNXOriginalPQHostCatalogSource" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(error)*error=_first;return NO;}
- (BOOL)thread:(NSError**)error{if(!pthread_main_np()||!pthread_equal(_thread,pthread_self())){if(error)*error=[NSError errorWithDomain:@"YNXOriginalPQHostCatalogSource" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PQ_HOST_SOURCE_ORIGINAL_THREAD_REQUIRED"}];return NO;}return YES;}
- (NSData*)hold:(NSString*)path digest:(NSString*)digest maximum:(NSUInteger)maximum image:(BOOL)image error:(NSError**)error{
 if(!PQSourceCanonicalPath(path)||!PQSourceHex(digest))return [self fail:@"PQ_HOST_SOURCE_FILE_PATH_REQUIRED" error:error],nil;
 if(image){NSString*part=@"/";for(NSString*n in path.stringByDeletingLastPathComponent.pathComponents){if([n isEqual:@"/"])continue;part=[part stringByAppendingPathComponent:n];struct stat d;if(lstat(part.fileSystemRepresentation,&d)||!S_ISDIR(d.st_mode)||d.st_uid!=0||(d.st_mode&0022))return [self fail:@"PQ_HOST_PROTOCOL_IMAGE_NOT_PROTECTED" error:error],nil;}}
 int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(fd<0)return [self fail:@"PQ_HOST_SOURCE_FILE_NOT_SUPPLIED" error:error],nil;
 _held.push_back({fd,{},path,NO,NO});auto&h=_held.back();struct stat named{};
 if(fstat(fd,&h.identity)||lstat(path.fileSystemRepresentation,&named)||!PQSourceSame(h.identity,named)||!S_ISREG(h.identity.st_mode)||h.identity.st_nlink!=1||(h.identity.st_mode&0022)||(h.identity.st_uid!=0&&h.identity.st_uid!=getuid())||(image&&(h.identity.st_uid!=0||!(h.identity.st_mode&0111)))||h.identity.st_size<1||(uint64_t)h.identity.st_size>maximum)return [self fail:@"PQ_HOST_SOURCE_FILE_IDENTITY_MISMATCH" error:error],nil;
 NSMutableData*raw=[NSMutableData dataWithLength:(NSUInteger)h.identity.st_size];size_t at=0;while(at<raw.length){ssize_t n=pread(fd,(char*)raw.mutableBytes+at,raw.length-at,(off_t)at);if(n<=0)return [self fail:@"PQ_HOST_SOURCE_FILE_READ_UNKNOWN" error:error],nil;at+=(size_t)n;}
 struct stat after{};if(fstat(fd,&after)||lstat(path.fileSystemRepresentation,&named)||!PQSourceSame(h.identity,after)||!PQSourceSame(h.identity,named)||![PQSourceSHA(raw)isEqual:digest])return [self fail:@"PQ_HOST_SOURCE_FILE_DIGEST_MISMATCH" error:error],nil;
 return [raw copy];
}
- (BOOL)heldCurrent:(NSError**)error{
 for(const auto&h:_held){struct stat held{},named{};if(h.selected||fstat(h.fd,&held)||lstat(h.path.fileSystemRepresentation,&named)||!PQSourceSame(h.identity,held)||!PQSourceSame(h.identity,named))return [self fail:@"PQ_HOST_SOURCE_HELD_FILE_CHANGED" error:error];}
 if(_parent>=0){struct stat held{},named{};NSString*p=_scope[@"outputPath"];if(fstat(_parent,&held)||lstat(p.stringByDeletingLastPathComponent.fileSystemRepresentation,&named)||!PQSourceParentSame(_parentIdentity,held)||!PQSourceParentSame(_parentIdentity,named))return [self fail:@"PQ_HOST_SOURCE_PARENT_CHANGED" error:error];}
 return YES;
}
+ (instancetype)acquire:(NSError**)error{
 YNXOriginalPQHostCatalogSource*s=[self new];if(![s thread:error])return s;
 @try{try{
  if(getuid()==0||getuid()!=geteuid()||getgid()!=getegid()){[s fail:@"PQ_HOST_SOURCE_ACTUAL_USER_REQUIRED" error:error];return s;}
  NSError*e=nil;s->_source=[YNXAuthIdentitySourceAuthority acquireOriginalWalletPQHostCatalogSource:&e];
  if(e||!s->_source){[s fail:e.localizedDescription?:@"PQ_HOST_DEDICATED_SOURCE_NOT_SUPPLIED" error:error];return s;}
  s->_context=[s->_source copyOriginalWalletPQHostCatalogContext:&e];s->_scope=s->_context[@"scope"];
  if(e||!PQSourceExact(s->_context,@[@"sourceId",@"instanceId",@"profileDigest",@"applicationId",@"scope"])||![s->_scope isKindOfClass:NSDictionary.class]){[s fail:e.localizedDescription?:@"PQ_HOST_DEDICATED_SOURCE_CONTEXT_REQUIRED" error:error];return s;}
  if(![NSBundle.mainBundle.bundleIdentifier isEqual:s->_context[@"applicationId"]]){[s fail:@"PQ_HOST_SOURCE_APPLICATION_MISMATCH" error:error];return s;}
  s->_wallet=ynx_auth_ide_private::observeKernel(getpid());
  if(s->_wallet.original.uid!=getuid()||![[s->_wallet.codeIdentity base64EncodedStringWithOptions:0]isEqual:s->_scope[@"walletCodeIdentity"]]){[s fail:@"PQ_HOST_SOURCE_KERNEL_IDENTITY_MISMATCH" error:error];return s;}
  if(![s hold:s->_scope[@"protocolImagePath"] digest:s->_scope[@"protocolImageSHA256"] maximum:536870912 image:YES error:&e]||![s hold:s->_scope[@"deliveryManifestPath"] digest:s->_scope[@"deliveryManifestSHA256"] maximum:2097152 image:NO error:&e]||![s hold:s->_scope[@"bindingPath"] digest:s->_scope[@"bindingSHA256"] maximum:16384 image:NO error:&e]){[s fail:e.localizedDescription?:@"PQ_HOST_SOURCE_INPUT_NOT_HELD" error:error];return s;}
  NSString*parent=[s->_scope[@"outputPath"]stringByDeletingLastPathComponent];
  if(!PQSourceCanonicalPath(parent)){[s fail:@"PQ_HOST_SOURCE_OUTPUT_PARENT_REQUIRED" error:error];return s;}
  s->_parent=open(parent.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);struct stat named{};
  if(s->_parent<0||fstat(s->_parent,&s->_parentIdentity)||lstat(parent.fileSystemRepresentation,&named)||!PQSourceParentSame(s->_parentIdentity,named)||!S_ISDIR(named.st_mode)||named.st_uid!=getuid()||(named.st_mode&07777)!=0700){[s fail:@"PQ_HOST_SOURCE_OUTPUT_PARENT_NOT_PRIVATE" error:error];return s;}
  s->_ready=YES;if(![s assertCurrentForJournal:s->_scope[@"journalBinding"] error:&e])[s fail:e.localizedDescription?:@"PQ_HOST_SOURCE_NOT_CURRENT" error:error];return s;
 }catch(...){[s fail:@"PQ_HOST_SOURCE_NATIVE_EXCEPTION" error:error];return s;}}@catch(NSException*){[s fail:@"PQ_HOST_SOURCE_NATIVE_EXCEPTION" error:error];return s;}
}
- (BOOL)assertCurrentForJournal:(NSDictionary*)journal error:(NSError**)error{
 if(![self thread:error])return NO;
 if(!_ready||_first||_life.retired()||_life.closeSelected()||!PQSourceExact(journal,@[@"operationId",@"account",@"networkId",@"originalHash",@"nativeWireHash",@"transactionHash"])||![journal isEqual:_scope[@"journalBinding"]])return [self fail:@"PQ_HOST_SOURCE_JOURNAL_OR_CURRENT_MISMATCH" error:error];
 NSError*e=nil;NSDictionary*context=[_source copyOriginalWalletPQHostCatalogContext:&e];
 if(e||![context isEqual:_context]||!ynx_auth_ide_private::sameKernel(_wallet,ynx_auth_ide_private::observeKernel(getpid()))||![self heldCurrent:&e])return [self fail:e.localizedDescription?:@"PQ_HOST_SOURCE_CHANGED_OR_REVOKED" error:error];
 const uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
 if(now<[_scope[@"issuedAtMs"]unsignedLongLongValue]||now>=[_scope[@"expiresAtMs"]unsignedLongLongValue])return [self fail:@"PQ_HOST_SOURCE_ORIGINAL_WINDOW_EXPIRED" error:error];
 return YES;
}
- (BOOL)writeNew:(NSString*)path bytes:(NSData*)bytes error:(NSError**)error{
 if(![self heldCurrent:error])return NO;
 NSString*parent=path.stringByDeletingLastPathComponent;if(![parent isEqual:[_scope[@"outputPath"]stringByDeletingLastPathComponent]])return [self fail:@"PQ_HOST_SOURCE_JOURNAL_PARENT_MISMATCH" error:error];
 int fd=openat(_parent,path.lastPathComponent.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0)return [self fail:@"PQ_HOST_SOURCE_ORIGINAL_RECORD_UNKNOWN" error:error];
 _held.push_back({fd,{},path,NO,NO});auto&h=_held.back();size_t at=0;
 while(at<bytes.length){ssize_t n=write(fd,(const char*)bytes.bytes+at,bytes.length-at);if(n<=0)return [self fail:@"PQ_HOST_SOURCE_RECORD_WRITE_UNKNOWN" error:error];at+=(size_t)n;}
 struct stat named{};if(fsync(fd)||fstat(fd,&h.identity)||lstat(path.fileSystemRepresentation,&named)||!PQSourceSame(h.identity,named)||!S_ISREG(named.st_mode)||named.st_uid!=getuid()||named.st_nlink!=1||(named.st_mode&07777)!=0600||named.st_size!=(off_t)bytes.length||fsync(_parent))return [self fail:@"PQ_HOST_SOURCE_RECORD_DURABILITY_UNKNOWN" error:error];
 return YES;
}
- (BOOL)prepareHandoff:(NSDictionary*)journal error:(NSError**)error{
 if(![self assertCurrentForJournal:journal error:error])return NO;
 if(_prepared||_life.selected())return [self fail:@"PQ_HOST_SOURCE_ORIGINAL_HANDOFF_ALREADY_ENTERED" error:error];
 _journal=[journal copy];_input=[NSJSONSerialization dataWithJSONObject:_journal options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
 if(!_input.length||_input.length>4096)return [self fail:@"PQ_HOST_SOURCE_JOURNAL_CAPACITY" error:error];
 // Existing attempt/output/result is a cold UNKNOWN boundary, never a second
 // O_EXCL registration. Preserve paths/results for original read-only recovery.
 BOOL outputExists=NO;for(NSString*k in @[@"attemptPath",@"outputPath",@"resultPath"]){struct stat s{};if(lstat([_scope[k]fileSystemRepresentation],&s)==0){_existingOutcome=YES;if([k isEqual:@"outputPath"])outputExists=YES;}else if(errno!=ENOENT)return [self fail:@"PQ_HOST_SOURCE_OUTCOME_ABSENCE_UNKNOWN" error:error];}
 if(_existingOutcome){if(!outputExists||![_scope[@"protocolReconcileContract"]isEqual:@"YNX-PQ-HOST-CATALOG-WALLET-RECONCILE-JOURNAL6/v1"])return [self fail:@"PQ_HOST_SOURCE_EXISTING_OUTCOME_REQUIRES_RECONCILIATION" error:error];_reconcileExisting=YES;}
 if(!_life.select())return [self fail:@"PQ_HOST_SOURCE_ORIGINAL_HANDOFF_ALREADY_ENTERED" error:error];
 if(!_reconcileExisting){NSDictionary*record=@{@"version":@"YNX-PQ-HOST-CATALOG-SOURCE-ATTEMPT/v1",@"context":_context,@"journalBinding":_journal,@"state":@"entered-unknown"};
 NSData*raw=[NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!raw||![self writeNew:_scope[@"attemptPath"] bytes:raw error:error])return NO;}
 _prepared=YES;return _life.enter();
}
- (void)cancelPreparedHandoff{@synchronized(self){if(!_workerStarted){_workerFailure=@"PQ_HOST_SOURCE_QUEUE_UNKNOWN";_workerFinished=YES;}}}
- (BOOL)closePipes{
 BOOL ok=YES;for(NSUInteger i=0;i<_pipes.count;i++){if(_pipeStates[i].intValue!=0){if(_pipeStates[i].intValue!=1)ok=NO;continue;}_pipeStates[i]=@2;NSError*e=nil;BOOL done=[_pipes[i]closeAndReturnError:&e];_pipeStates[i]=done?@1:@2;if(!done||e)ok=NO;}return ok;
}
- (void)runPreparedHandoff{
 @synchronized(self){if(!_prepared||_workerStarted||_life.retired()){_workerFailure=@"PQ_HOST_SOURCE_RETIRED_OR_WORK_ONCE";_workerFinished=YES;return;}_workerStarted=YES;}
 @autoreleasepool{@try{try{
  NSPipe*in=[NSPipe pipe],*out=[NSPipe pipe],*err=[NSPipe pipe];
  for(NSFileHandle*h in @[in.fileHandleForReading,in.fileHandleForWriting,out.fileHandleForReading,out.fileHandleForWriting,err.fileHandleForReading,err.fileHandleForWriting]){[_pipes addObject:h];[_pipeStates addObject:@0];}
  _task=[NSTask new];_task.executableURL=[NSURL fileURLWithPath:_scope[@"protocolImagePath"]];
  NSMutableArray*args=[@[@"register-proof-host-source",@"--wallet-request-stdin",@"true",@"--delivery-manifest",_scope[@"deliveryManifestPath"],@"--delivery-manifest-sha256",_scope[@"deliveryManifestSHA256"],@"--binding",_scope[@"bindingPath"],@"--binding-sha256",_scope[@"bindingSHA256"],@"--output",_scope[@"outputPath"]]mutableCopy];
  if(_reconcileExisting)[args addObjectsFromArray:@[@"--wallet-reconcile-existing",@"true"]];_task.arguments=args;
  _task.environment=@{};_task.currentDirectoryURL=[NSURL fileURLWithPath:[_scope[@"outputPath"]stringByDeletingLastPathComponent] isDirectory:YES];_task.standardInput=in;_task.standardOutput=out;_task.standardError=err;
  NSError*e=nil;if(![_task launchAndReturnError:&e]){_workerFailure=@"PQ_HOST_SOURCE_PROTOCOL_START_UNKNOWN";return;}_taskLaunched=YES;
  NSUInteger writer=[_pipes indexOfObjectIdenticalTo:in.fileHandleForWriting];std::vector<unsigned char> captured,errors;
  try{auto result=ynx_auth_private::boundedVerifierIO(in.fileHandleForWriting.fileDescriptor,out.fileHandleForReading.fileDescriptor,err.fileHandleForReading.fileDescriptor,(const unsigned char*)_input.bytes,_input.length,[&](){_pipeStates[writer]=@2;NSError*x=nil;BOOL done=[in.fileHandleForWriting closeAndReturnError:&x];_pipeStates[writer]=done?@1:@2;return (bool)(done&&!x);},[&](){return (bool)_task.running;},7000,4096,16384,&captured,&errors);(void)result;}
  catch(const std::exception&x){_workerFailure=[NSString stringWithUTF8String:x.what()];}
  _stdout=[NSData dataWithBytes:captured.data() length:captured.size()];_stderr=[NSData dataWithBytes:errors.data() length:errors.size()];
 }catch(...){_workerFailure=@"PQ_HOST_SOURCE_PROTOCOL_EXCEPTION";}}@catch(NSException*){_workerFailure=@"PQ_HOST_SOURCE_PROTOCOL_EXCEPTION";}@finally{
  // No detached timer and no raw PID signal: the original retained task is
  // touched only in this worker. An ignored TERM never becomes fake joined.
  if(_taskLaunched&&_task.running)[_task terminate];
  if(!_taskLaunched||ynx_auth_private::observePQCatalogTaskExit(_task,250)){if(_taskLaunched)_exitStatus=_task.terminationStatus;[self closePipes];}
  else if(!_workerFailure)_workerFailure=@"PQ_HOST_SOURCE_CHILD_EXIT_UNCONFIRMED";
  @synchronized(self){_workerFinished=YES;}
 }}
}
- (NSDictionary*)completeHandoff:(NSError**)error{
 if(![self thread:error])return nil;
 @synchronized(self){if(!_workerFinished)return [self fail:@"PQ_HOST_SOURCE_WORK_NOT_JOINED" error:error],nil;if(_workerJoined)return [self fail:@"PQ_HOST_SOURCE_RESULT_ALREADY_COMPLETED" error:error],nil;_workerJoined=YES;if(!_task.running)_life.joined();}
 if(_workerFailure||_exitStatus!=0||!_stdout.length||_stdout.length>16384||_stderr.length||![self closePipes])return [self fail:_workerFailure?:@"PQ_HOST_SOURCE_PROTOCOL_OUTCOME_UNKNOWN" error:error],nil;
 NSDictionary*parsed=PQSourceReceipt(_stdout);
 if(!parsed||![parsed[@"catalogPath"]isEqual:_scope[@"outputPath"]]||!PQSourceHex(parsed[@"catalogSha256"]))return [self fail:@"PQ_HOST_SOURCE_PROTOCOL_RECEIPT_UNKNOWN" error:error],nil;
 NSError*e=nil;if(![self hold:parsed[@"catalogPath"] digest:parsed[@"catalogSha256"] maximum:16384 image:NO error:&e])return [self fail:e.localizedDescription?:@"PQ_HOST_SOURCE_CATALOG_OUTCOME_UNKNOWN" error:error],nil;
 if(_held.back().identity.st_uid!=getuid()||(_held.back().identity.st_mode&07777)!=0600)return [self fail:@"PQ_HOST_SOURCE_CATALOG_PRIVATE_IDENTITY_REQUIRED" error:error],nil;
 _pair=[parsed copy];_life.captureResult();
 NSDictionary*record=@{@"version":@"YNX-PQ-HOST-CATALOG-SOURCE-RESULT/v1",@"context":_context,@"journalBinding":_journal,@"pair":_pair};NSData*raw=[NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
 // Preserve original DATA even if a late fence fails. Main stores the pair,
 // then its mandatory Source current check rejects retired/unknown authority.
 if(!raw||(!_reconcileExisting&&![self writeNew:_scope[@"resultPath"] bytes:raw error:&e])||![self assertCurrentForJournal:_journal error:&e]){[self fail:e.localizedDescription?:@"PQ_HOST_SOURCE_POST_COMPLETION_UNKNOWN" error:error];return _pair;}
 if(!_life.complete()){[self fail:@"PQ_HOST_SOURCE_POST_COMPLETION_UNKNOWN" error:error];return _pair;}return _pair;
}
- (NSDictionary*)observeRevocation{
 NSError*e=nil;if(!_life.retired()&&!_first)[self assertCurrentForJournal:_scope[@"journalBinding"] error:&e];
 return @{@"version":@"YNX-PQ-HOST-CATALOG-SOURCE-OBSERVATION/v1",@"sourceId":_context[@"sourceId"]?:@"",@"instanceId":_context[@"instanceId"]?:@"",@"retired":@(_life.retired()),@"revoked":@NO,@"current":@(_ready&&!_first&&!_life.retired()&&!_life.closeSelected()),@"unknown":@(_first!=nil||_life.unknown()),@"dataOnly":@YES,@"authorized":@NO};
}
- (NSDictionary*)status{return @{@"selected":@(_life.selected()),@"active":@(_life.active()),@"heldResult":@(_pair!=nil),@"existingOutcomeObserved":@(_existingOutcome),@"readonlyReconciliation":@(_reconcileExisting),@"originalRegistrationOutcomeUnknown":@(_existingOutcome),@"unknown":@(_life.unknown()),@"retired":@(_life.retired()),@"closed":@(_life.closed()),@"sourceId":_context[@"sourceId"]?:@"",@"instanceId":_context[@"instanceId"]?:@"",@"firstCause":_first.localizedDescription?:@"",@"cleanupCause":_closeFirst.localizedDescription?:@"",@"dataOnly":@YES,@"authorized":@NO};}
- (void)retire{if(pthread_equal(_thread,pthread_self())){@synchronized(self){_life.retire();_ready=NO;[_source retire];}}}
- (BOOL)join:(NSError**)error{if(![self thread:error])return NO;@synchronized(self){
 if(_workerFinished&&!_task.running)_life.joined();
 if(!_life.joinReady()||_task.running){if(error)*error=_first?:[NSError errorWithDomain:@"YNXOriginalPQHostCatalogSource" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PQ_HOST_SOURCE_CHILD_NOT_JOINED"}];return NO;}
 }return !_source||[_source join:error];}
- (BOOL)close:(NSError**)error{
 if(![self thread:error])return NO;if(_life.closeSelected()){if(error)*error=_closeFirst;return _life.closed();}
 [self retire];if(![self join:error]||!_life.selectClose())return NO;
 BOOL ok=[self closePipes];for(auto&h:_held){if(h.selected){if(!h.closed)ok=NO;continue;}h.selected=YES;h.closed=close(h.fd)==0;if(!h.closed)ok=NO;}
 if(_parent>=0){if(!_parentCloseSelected){_parentCloseSelected=YES;_parentClosed=close(_parent)==0;if(_parentClosed)_parent=-1;}if(!_parentClosed)ok=NO;}
 NSError*e=nil;if(_source&&(![_source close:&e]||e))ok=NO;
 if(!ok)_closeFirst=e?:[NSError errorWithDomain:@"YNXOriginalPQHostCatalogSource" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PQ_HOST_SOURCE_CLOSE_UNKNOWN"}];
 _life.closeResult(ok);if(error)*error=_closeFirst;return ok;
}
@end
