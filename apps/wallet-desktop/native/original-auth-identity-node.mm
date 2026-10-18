#import <Foundation/Foundation.h>
#include "original-private-terminal-recovery.h"
#include <node_api.h>
#import "original-private-service-channel.h"
#include "original-private-service-channel.mm"
#include <unordered_set>
#include <string>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <vector>
#include <unordered_map>
#include <poll.h>
#include <limits.h>
#include <stdlib.h>
#include <CommonCrypto/CommonDigest.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include <Security/Security.h>
#include <atomic>
#include "../../../packages/wallet-auth/native/original-first-enter-selection.h"
#import "../../../packages/wallet-auth/native/original-auth-identity-source-authority.h"
#include "../../../packages/wallet-auth/native/original-host-dirfd-journal.h"

// Owning NAPI implementation. Registry membership preserves original custody,
// not authorization. Every business call also requires the actual Source gate.
enum class Kind { administration,joint,privateService,ideClient };
struct OriginalAuthHandle {
 Kind kind; napi_env env; YNXAuthIdentitySourceAuthority *__strong source;
 NSError *__strong acquisitionCause=nil;
 YNXOriginalPrivateServiceChannel *__strong serviceChannel=nil;
 bool serviceReady=false;std::string serviceReceivedRaw;std::unordered_map<std::string,std::string> serviceAcknowledged;
 void *ideParentOpaque=nullptr;
 NSDictionary *__strong selection; napi_ref vault=nullptr,view=nullptr,local=nullptr,result=nullptr,serviceCloseCause=nullptr,ideNodeParent=nullptr;
 ynx_auth_private::JointLifecycle life;std::atomic_bool retired{false},closed{false},cleanupFailed{false};bool closeSelected=false;
 ynx_auth_private::TemporaryDescriptor commitDescriptor,readDescriptor,channelDescriptor,terminalParent,terminalDirectory,terminalEntered,terminalResult,terminalState;
 int journalDir=-1,channel=-1;std::string recordName;OriginalAuthHandle *parent=nullptr;unsigned children=0;
 std::unordered_map<std::string,std::string> responses;
 std::unordered_map<std::string,std::string> requestOriginals;
 std::unordered_set<std::string> admittedPrivateRequests;
 std::unordered_map<std::string,std::string> persistentFirstEnterVerified;
 std::unordered_set<std::string> terminalAcknowledged;
 std::unordered_map<std::string,std::pair<std::string,std::string>> terminalAcknowledgedRecords;
 std::unordered_set<std::string> terminalReadSelected;
 std::unordered_map<std::string,std::string> terminalReadCauses,terminalReadCleanupCauses;
 std::unordered_set<std::string> enteredRequests;
};
static std::unordered_set<OriginalAuthHandle *> originals,debt;
static bool FirstEnterPermitCurrent(OriginalAuthHandle *,const std::string&,const std::string&,bool);
static bool IDEOriginalJointBusinessCurrent(OriginalAuthHandle *joint);
static bool IDEClientOriginalCurrent(OriginalAuthHandle *client);
static void IDEClientReleaseParent(OriginalAuthHandle *client);
static void IDERetireForOriginal(OriginalAuthHandle *original);
static bool CloseTemporary(OriginalAuthHandle *h,ynx_auth_private::TemporaryDescriptor &descriptor){
 bool completed=descriptor.closeOnce([](int fd){return close(fd);});
 if(!completed){h->cleanupFailed=true;debt.insert(h);}return completed;
}
static bool ChannelAvailable(OriginalAuthHandle *h){
 return h&&!h->cleanupFailed&&h->channel<0&&h->channelDescriptor.available();
}
static bool CloseChannel(OriginalAuthHandle *h){
 if(h->channel>=0&&h->channelDescriptor.identity()!=h->channel){h->cleanupFailed=true;debt.insert(h);return false;}
 bool completed=CloseTemporary(h,h->channelDescriptor);
 if(completed)h->channel=-1;return completed;
}
static bool JoinReady(OriginalAuthHandle *h){
 return h->retired&&ynx_auth_private::ChildOwnership::joined(h->children);
}
static napi_value Undefined(napi_env env){napi_value v;return napi_get_undefined(env,&v)==napi_ok?v:nullptr;}
static napi_value Error(napi_env env,const char *code){napi_throw_error(env,code,code);return nullptr;}
static bool Args(napi_env env,napi_callback_info info,size_t n,napi_value *argv,void **data=nullptr){size_t count=n+1;napi_value values[5];if(n>4||napi_get_cb_info(env,info,&count,values,nullptr,data)!=napi_ok||count!=n)return false;for(size_t i=0;i<n;i++)argv[i]=values[i];return true;}
static OriginalAuthHandle *Original(napi_env env,napi_value value,Kind kind){void *p=nullptr;if(napi_unwrap(env,value,&p)!=napi_ok)return nullptr;OriginalAuthHandle *h=(OriginalAuthHandle *)p;if(!originals.count(h)||h->env!=env||h->kind!=kind)return nullptr;return h;}
static bool Current(OriginalAuthHandle *h,bool admission=true){if(h&&h->acquisitionCause){Error(h->env,h->acquisitionCause.localizedDescription.UTF8String);return false;}NSError *e=nil;if(!h||h->retired||h->closed||h->cleanupFailed||(h->parent&&(h->parent->retired||h->parent->closed||h->parent->cleanupFailed))||![h->source assertCurrent:&e]||(admission&&![h->source assertAuthenticatedNativePurpose:&e])){if(h)Error(h->env,(e.localizedDescription?:@"AUTH_IDENTITY_ORIGINAL_RETIRED").UTF8String);return false;}if(h->kind==Kind::privateService&&(!h->serviceReady||![h->serviceChannel assertCurrent:&e])){Error(h->env,(e.localizedDescription?:@"AUTH_IDENTITY_SERVICE_NOT_READY").UTF8String);return false;}if(h->kind==Kind::ideClient&&!IDEClientOriginalCurrent(h)){Error(h->env,"IDE_ORIGINAL_PRIVATE_CLIENT_CURRENT_FAILED");return false;}return true;}
static NSDictionary *Dictionary(napi_env env,napi_value value){
 napi_value global,json,stringify,text;napi_get_global(env,&global);napi_get_named_property(env,global,"JSON",&json);napi_get_named_property(env,json,"stringify",&stringify);if(napi_call_function(env,json,stringify,1,&value,&text)!=napi_ok)return nil;
 size_t n=0;if(napi_get_value_string_utf8(env,text,nullptr,0,&n)!=napi_ok||n>65536)return nil;std::string raw(n+1,'\0');if(napi_get_value_string_utf8(env,text,raw.data(),raw.size(),&n)!=napi_ok)return nil;NSData *b=[NSData dataWithBytes:raw.data() length:n];id parsed=[NSJSONSerialization JSONObjectWithData:b options:0 error:nil];return [parsed isKindOfClass:NSDictionary.class]?parsed:nil;
}
static napi_value JSON(napi_env env,id value){NSData *bytes=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!bytes||bytes.length>65536)return Error(env,"AUTH_IDENTITY_OUTPUT_CAPACITY");napi_value global,json,parse,text,result;napi_get_global(env,&global);napi_get_named_property(env,global,"JSON",&json);napi_get_named_property(env,json,"parse",&parse);napi_create_string_utf8(env,(const char *)bytes.bytes,bytes.length,&text);return napi_call_function(env,json,parse,1,&text,&result)==napi_ok?result:nullptr;}
static bool Same(napi_env env,napi_ref held,napi_value value){napi_value original;bool equal=false;return held&&napi_get_reference_value(env,held,&original)==napi_ok&&napi_strict_equals(env,original,value,&equal)==napi_ok&&equal;}
static bool EnforcingChild(OriginalAuthHandle *h,napi_value child){
 NSDictionary *observed=Dictionary(h->env,child),*approved=h->selection[@"enforcingChild"];
 if(![approved isKindOfClass:NSDictionary.class]||!observed||![observed isEqual:approved])return false;
 pid_t pid=[approved[@"pid"] intValue];struct proc_bsdinfo info{};if(pid<=1||proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))!=(int)sizeof(info)||info.pbi_uid!=getuid()||info.pbi_ppid!=(uint32_t)getpid()||info.pbi_start_tvsec!=[approved[@"startSeconds"] unsignedLongLongValue]||info.pbi_start_tvusec!=[approved[@"startMicroseconds"] unsignedLongLongValue])return false;
 SecCodeRef code=nullptr;CFDictionaryRef metadata=nullptr;OSStatus status=SecCodeCopyGuestWithAttributes(nullptr,(__bridge CFDictionaryRef)@{(__bridge NSString *)kSecGuestAttributePid:@(pid)},kSecCSDefaultFlags,&code);if(status==errSecSuccess)status=SecCodeCheckValidity(code,kSecCSStrictValidate,nullptr);if(status==errSecSuccess)status=SecCodeCopySigningInformation(code,kSecCSSigningInformation,&metadata);
 NSData *actual=metadata?((__bridge NSDictionary *)metadata)[(__bridge NSString *)kSecCodeInfoUnique]:nil;NSString *expected=approved[@"codeHashBase64"];
 BOOL matches=status==errSecSuccess&&[actual isKindOfClass:NSData.class]&&[expected isKindOfClass:NSString.class]&&[[actual base64EncodedStringWithOptions:0] isEqual:expected];if(metadata)CFRelease(metadata);if(code)CFRelease(code);return matches;
}
static OriginalAuthHandle *PrivateOriginal(napi_env env,napi_value value){auto *h=Original(env,value,Kind::joint);if(h)return h;h=Original(env,value,Kind::privateService);return h?:Original(env,value,Kind::ideClient);}
static bool Close(OriginalAuthHandle *h){
 if(h->closeSelected)return h->closed;h->retired=true;h->life.retire();IDERetireForOriginal(h);if(!JoinReady(h)){debt.insert(h);return false;}h->closeSelected=true;
 CloseChannel(h);
 if(h->kind==Kind::privateService){NSError *e=nil;if(![h->serviceChannel closeOriginal:&e])h->cleanupFailed=true;}
 if(h->journalDir>=0){if(close(h->journalDir)<0)h->cleanupFailed=true;else h->journalDir=-1;}
 if((h->kind==Kind::administration||h->kind==Kind::privateService)&&h->source){[h->source retire];NSError *e=nil;if(![h->source join:&e]||![h->source close:&e])h->cleanupFailed=true;}
 h->closed=!h->cleanupFailed&&!h->commitDescriptor.unresolved()&&!h->readDescriptor.unresolved()&&!h->channelDescriptor.unresolved()&&!h->terminalParent.unresolved()&&!h->terminalDirectory.unresolved()&&!h->terminalEntered.unresolved()&&!h->terminalResult.unresolved()&&!h->terminalState.unresolved();
 if(h->closed&&h->parent&&h->parent->children){h->parent->children--;h->parent=nullptr;}
 if(h->closed&&h->kind==Kind::ideClient)IDEClientReleaseParent(h);
 h->life.completedCleanup(h->closed);if(!h->closed)debt.insert(h);else debt.erase(h);return h->closed;
}
static napi_value CloseServiceOwner(napi_env env,OriginalAuthHandle *h){
 if(h->serviceCloseCause){napi_value cause;napi_get_reference_value(env,h->serviceCloseCause,&cause);napi_throw(env,cause);return nullptr;}
 if(Close(h))return Undefined(env);napi_value message,cause;napi_create_string_utf8(env,h->kind==Kind::ideClient?"IDE_ORIGINAL_PRIVATE_CLIENT_CLOSE_UNKNOWN":"ORIGINAL_SERVICE_CLOSE_UNKNOWN",NAPI_AUTO_LENGTH,&message);napi_create_error(env,nullptr,message,&cause);napi_create_reference(env,cause,1,&h->serviceCloseCause);napi_throw(env,cause);return nullptr;
}
static void Finalize(napi_env env,void *p,void *){OriginalAuthHandle *h=(OriginalAuthHandle *)p;if(!originals.count(h))return;if(!Close(h))return;for(napi_ref ref:{h->vault,h->view,h->local,h->result,h->serviceCloseCause})if(ref)napi_delete_reference(env,ref);originals.erase(h);delete h;}
static napi_value Wrap(napi_env env,OriginalAuthHandle *h){napi_value object;napi_create_object(env,&object);originals.insert(h);if(napi_wrap(env,object,h,Finalize,nullptr,nullptr)!=napi_ok){debt.insert(h);return Error(env,"AUTH_IDENTITY_WRAP_FAILED");}return object;}
static napi_value Acquire(napi_env env,napi_callback_info info){napi_value unused[1];if(!Args(env,info,0,unused))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");NSError *error=nil;YNXAuthIdentitySourceAuthority *s=[YNXAuthIdentitySourceAuthority acquireOriginalSource:&error];if(!s)return Error(env,(error.localizedDescription?:@"AUTH_IDENTITY_ORIGINAL_PROFILE_NOT_SUPPLIED").UTF8String);OriginalAuthHandle *h=new OriginalAuthHandle{};h->kind=Kind::administration;h->env=env;h->source=s;return Wrap(env,h);}
static napi_value ReadAdministration(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=Original(env,a[0],Kind::administration);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(h))return nullptr;NSError *e=nil;NSDictionary *s=[h->source copyOriginalSelection:&e];h->selection=s;if(!s)return Error(env,(e.localizedDescription?:@"AUTH_IDENTITY_ORIGINAL_SELECTION_NOT_SUPPLIED").UTF8String);napi_value result=JSON(env,s);if(!Current(h))return nullptr;return result;}
static napi_value Reserve(napi_env env,napi_callback_info info){
 napi_value a[3];if(!Args(env,info,3,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *admin=Original(env,a[0],Kind::administration);if(!admin)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(admin))return nullptr;
 NSDictionary *local=Dictionary(env,a[1]),*selection=admin->selection,*association=selection[@"association"];
 if(!local||![local[@"scope"] isEqual:@"LOCAL_SELECTED_VAULT"]||![local[@"account"] isEqual:association[@"account"]])return Error(env,"AUTH_IDENTITY_LOCAL_ASSOCIATION_MISMATCH");
 OriginalAuthHandle *h=new OriginalAuthHandle{};h->env=env;h->kind=Kind::joint;h->source=admin->source;h->selection=selection;h->parent=admin;admin->children++;
 napi_create_reference(env,a[2],1,&h->vault);napi_create_reference(env,a[1],1,&h->local);
 // Registered directory is an original approved Source resource. No path is
 // supplied by the caller/renderer, and unqualified Source never reaches I/O.
 NSString *path=selection[@"registeredDirectory"];
 if(![path isKindOfClass:NSString.class]||![path hasPrefix:@"/"]||![path.stringByStandardizingPath isEqual:path]){debt.insert(h);return Wrap(env,h);}
 struct stat named,held;if(lstat(path.fileSystemRepresentation,&named)||!S_ISDIR(named.st_mode)||S_ISLNK(named.st_mode)||(named.st_mode&0077)||named.st_uid!=getuid()){debt.insert(h);return Wrap(env,h);}
 h->journalDir=open(path.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(h->journalDir<0||fstat(h->journalDir,&held)||held.st_dev!=named.st_dev||held.st_ino!=named.st_ino){debt.insert(h);return Wrap(env,h);}
 h->recordName=std::string("joint-")+NSUUID.UUID.UUIDString.UTF8String;
 return Wrap(env,h);
}
static napi_value Commit(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=Original(env,a[0],Kind::joint);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(h))return nullptr;if(h->journalDir<0)return Error(env,"AUTH_IDENTITY_REGISTERED_RESOURCE_NOT_SUPPLIED");if(!h->life.enterCommit())return Error(env,"AUTH_IDENTITY_COMMIT_ALREADY_ENTERED");
 NSDictionary *record=@{@"recordId":[NSString stringWithUTF8String:h->recordName.c_str()],@"association":h->selection[@"association"],@"generation":h->selection[@"generation"]};NSData *raw=[NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
 napi_value result=JSON(env,record);napi_create_reference(env,result,1,&h->result); // retain before late fences/I/O
 int fd=openat(h->journalDir,h->recordName.c_str(),O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0)return Error(env,"AUTH_IDENTITY_REGISTERED_COMMIT_UNKNOWN");
 h->commitDescriptor.hold(fd);
 size_t n=0;bool failed=false;while(n<raw.length){ssize_t count=write(fd,(const char *)raw.bytes+n,raw.length-n);if(count<=0){failed=true;break;}n+=(size_t)count;}if(fsync(fd))failed=true;if(!CloseTemporary(h,h->commitDescriptor))failed=true;if(fsync(h->journalDir))failed=true;
 if(failed)return Error(env,"AUTH_IDENTITY_REGISTERED_COMMIT_UNKNOWN");if(!Current(h))return nullptr;return result;
}
static bool IDEPrivateCurrent(OriginalAuthHandle *h){if(!Current(h))return false;
 if(h->kind==Kind::privateService||h->kind==Kind::ideClient)return true; // Distinct service role or ACTUAL same adopted Node delivery; never a pretend joint.
 if(!IDEOriginalJointBusinessCurrent(h)){Error(h->env,"IDE_ORIGINAL_ADOPTED_DELIVERY_REQUIRED");return false;}return true;}
// A newly selected Source persistent-entered capability MUST NOT silently
// fall through legacy unsigned admission/writes. No fallback or env flag.
static bool LegacyPrivateEntryPermitted(NSDictionary*selection){return [selection isKindOfClass:NSDictionary.class]&&[selection objectForKey:@"persistentEnteredWitness"]==nil;}
static napi_value PrivateDispatch(napi_env env,napi_callback_info info){
 void *p=nullptr;napi_value a[1];if(!Args(env,info,1,a,&p))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=(OriginalAuthHandle *)p;if(!originals.count(h)||h->kind!=Kind::joint||!IDEPrivateCurrent(h))return nullptr;
 if(!ChannelAvailable(h))return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");
 // Owned dispatcher has no callback installer. The canonical Host bridge
 // requires the original service resource, never a caller endpoint/provider.
 size_t length=0;if(napi_get_value_string_utf8(env,a[0],nullptr,0,&length)!=napi_ok||length>262144)return Error(env,"ORIGINAL_PRIVATE_REQUEST_INVALID");std::string raw(length+1,'\0');if(napi_get_value_string_utf8(env,a[0],raw.data(),raw.size(),&length)!=napi_ok)return Error(env,"ORIGINAL_PRIVATE_REQUEST_INVALID");NSData *bytes=[NSData dataWithBytes:raw.data() length:length];id parsed=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
 if(!YNXOriginalRecoverablePrivateCarrierBudget(parsed,bytes,h->selection))return Error(env,"ORIGINAL_PRIVATE_REQUEST_INVALID");
 std::string requestKey=std::string([parsed[@"operation"] UTF8String])+":"+[parsed[@"phase"] UTF8String]+":"+[parsed[@"requestId"] UTF8String];
 if(!LegacyPrivateEntryPermitted(h->selection)){auto it=h->persistentFirstEnterVerified.find(requestKey);if(it==h->persistentFirstEnterVerified.end()||it->second!=std::string(raw.data(),length)||!h->admittedPrivateRequests.count(requestKey)||!FirstEnterPermitCurrent(h,requestKey,it->second,false))return Error(env,"SOURCE_PERSISTENT_ENTERED_NATIVE_GATE_REQUIRED");h->persistentFirstEnterVerified.erase(it);}
 if(h->enteredRequests.count(requestKey)||h->enteredRequests.size()>=64)return Error(env,"ORIGINAL_PRIVATE_ALREADY_ENTERED");h->enteredRequests.insert(requestKey);h->requestOriginals.emplace(requestKey,std::string(raw.data(),length));
 NSString *path=h->selection[@"originalServiceSocket"];
 if(![path isKindOfClass:NSString.class]||![path hasPrefix:@"/"]||![path.stringByStandardizingPath isEqual:path]||[path lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>=sizeof(sockaddr_un::sun_path))return Error(env,"AUTH_IDENTITY_ORIGINAL_SERVICE_RESOURCE_NOT_SUPPLIED");
 struct stat named;if(lstat(path.fileSystemRepresentation,&named)||!S_ISSOCK(named.st_mode)||named.st_uid!=getuid()||(named.st_mode&0077))return Error(env,"AUTH_IDENTITY_ORIGINAL_SERVICE_RESOURCE_NOT_SUPPLIED");
 h->channel=socket(AF_UNIX,SOCK_STREAM,0);if(h->channel<0)return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");if(!h->channelDescriptor.hold(h->channel)){h->cleanupFailed=true;debt.insert(h);return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");}fcntl(h->channel,F_SETFD,FD_CLOEXEC);sockaddr_un address{};address.sun_family=AF_UNIX;strcpy(address.sun_path,path.fileSystemRepresentation);
 if(connect(h->channel,(sockaddr *)&address,sizeof(address)))return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");pid_t peer=0;socklen_t size=sizeof(peer);NSNumber *approved=h->selection[@"originalServicePID"];
 if(![approved isKindOfClass:NSNumber.class]||getsockopt(h->channel,SOL_LOCAL,LOCAL_PEERPID,&peer,&size)||peer!=approved.intValue||!IDEPrivateCurrent(h))return Error(env,"AUTH_IDENTITY_ORIGINAL_SERVICE_PEER_CHANGED");
 std::string frame(raw.data(),length);frame+='\n';size_t sent=0;while(sent<frame.size()){pollfd p{h->channel,POLLOUT,0};if(poll(&p,1,15000)!=1)return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");ssize_t n=write(h->channel,frame.data()+sent,frame.size()-sent);if(n<=0)return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");sent+=(size_t)n;}
 std::string response;while(response.size()<=65536){pollfd p{h->channel,POLLIN,0};if(poll(&p,1,15000)!=1)return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");char b;ssize_t n=read(h->channel,&b,1);if(n!=1)return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");if(b=='\n')break;response+=b;}
 if(response.size()>65536)return Error(env,"AUTH_IDENTITY_PRIVATE_RESPONSE_CAPACITY");id result=[NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:response.data() length:response.size()] options:0 error:nil];
 if(![result isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:[result allKeys]] isEqual:[NSSet setWithArray:@[@"status",@"headers",@"body"]]]||![result[@"body"] isKindOfClass:NSString.class])return Error(env,"AUTH_IDENTITY_PRIVATE_RESPONSE_INVALID");
 h->responses.emplace(requestKey,response);napi_value original=JSON(env,result); // capture before late Source current fence
 if(!IDEPrivateCurrent(h))return nullptr;if(!CloseChannel(h))return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_CLOSE_UNKNOWN");return original;
}
static napi_value ReadJoint(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=Original(env,a[0],Kind::joint);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(h))return nullptr;if(!Same(env,h->result,a[1])||h->journalDir<0)return Error(env,"AUTH_IDENTITY_ORIGINAL_RESULT_REQUIRED");
 if(h->readDescriptor.unresolved())return Error(env,"AUTH_IDENTITY_READBACK_UNKNOWN");
 int fd=openat(h->journalDir,h->recordName.c_str(),O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd>=0)h->readDescriptor.hold(fd);struct stat st;if(fd<0||fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_nlink!=1||st.st_uid!=getuid()||(st.st_mode&0077)||st.st_size<1||st.st_size>65536){if(fd>=0)CloseTemporary(h,h->readDescriptor);return Error(env,"AUTH_IDENTITY_READBACK_UNKNOWN");}
 NSMutableData *bytes=[NSMutableData dataWithLength:(NSUInteger)st.st_size];ssize_t n=pread(fd,bytes.mutableBytes,bytes.length,0);bool closeFailed=!CloseTemporary(h,h->readDescriptor);if(n!=(ssize_t)bytes.length||closeFailed)return Error(env,"AUTH_IDENTITY_READBACK_UNKNOWN");id readback=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];napi_value expected;napi_get_reference_value(env,h->result,&expected);if(![readback isEqual:Dictionary(env,expected)])return Error(env,"AUTH_IDENTITY_READBACK_UNKNOWN");if(!Current(h))return nullptr;h->life.completeReadback();
 napi_value view=JSON(env,@{@"association":h->selection[@"association"],@"raw":h->selection[@"raw"],@"executor":h->selection[@"executor"],@"observer":h->selection[@"observer"]}),vault,executor,dispatch;napi_get_reference_value(env,h->vault,&vault);napi_set_named_property(env,view,"vault",vault);napi_get_named_property(env,view,"executor",&executor);napi_create_function(env,"privateDispatch",NAPI_AUTO_LENGTH,PrivateDispatch,h,&dispatch);napi_set_named_property(env,executor,"privateDispatch",dispatch);napi_create_reference(env,view,1,&h->view);return view;
}
enum Operation {adminCurrent,adminRetire,adminJoin,adminClose,jointCurrent,jointChild,jointSuccession,jointRetire,jointJoin,jointClose};
static napi_value CapturePrivate(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=PrivateOriginal(env,a[0]);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(h))return nullptr;
 for(NSString *key in @[@"sourceSelection",@"receiptSelection",@"expectedRequest",@"association"]){id value=h->selection[key];if(!value)return Error(env,"AUTH_IDENTITY_PRIVATE_BINDING_NOT_SUPPLIED");napi_value v=JSON(env,value);if(!v)return nullptr;napi_property_descriptor p={key.UTF8String,nullptr,nullptr,nullptr,nullptr,v,napi_default,nullptr};if(napi_define_properties(env,a[0],1,&p)!=napi_ok)return Error(env,"AUTH_IDENTITY_PRIVATE_CAPTURE_FAILED");}
 return a[0];}
static NSDictionary *PrivateCarrierDictionary(napi_env env,napi_value value,OriginalAuthHandle *h){
 // Private-session-only parser. General Dictionary/JSON stay at 65536.
 napi_value global,json,stringify,text;
 if(napi_get_global(env,&global)!=napi_ok||napi_get_named_property(env,global,"JSON",&json)!=napi_ok||napi_get_named_property(env,json,"stringify",&stringify)!=napi_ok||napi_call_function(env,json,stringify,1,&value,&text)!=napi_ok)return nil;
 size_t n=0;if(napi_get_value_string_utf8(env,text,nullptr,0,&n)!=napi_ok||n>262144)return nil;
 std::string raw(n+1,'\0');if(napi_get_value_string_utf8(env,text,raw.data(),raw.size(),&n)!=napi_ok)return nil;
 NSData *bytes=[NSData dataWithBytes:raw.data() length:n];id parsed=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
 if(![parsed isKindOfClass:NSDictionary.class])return nil;
 NSData *canonical=YNXPrivateCanonical(parsed);return YNXOriginalRecoverablePrivateCarrierBudget(parsed,canonical,h->selection)?parsed:nil;
}
static napi_value AdmissionPrivate(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=PrivateOriginal(env,a[0]);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(h))return nullptr;
 NSDictionary *input=PrivateCarrierDictionary(env,a[1],h);
 if(h->kind!=Kind::privateService&&h->kind!=Kind::ideClient&&!IDEOriginalJointBusinessCurrent(h))return Error(env,"IDE_ORIGINAL_ADOPTED_DELIVERY_REQUIRED");
 if(!input)return Error(env,"AUTH_IDENTITY_OPERATION_MISMATCH");
 NSString *requestID=input[@"requestId"];NSRegularExpression *pattern=[NSRegularExpression regularExpressionWithPattern:@"^req_[A-Za-z0-9_-]{12,80}$" options:0 error:nil];if([pattern numberOfMatchesInString:requestID options:0 range:NSMakeRange(0,requestID.length)]!=1)return Error(env,"AUTH_IDENTITY_OPERATION_MISMATCH");
 std::string key=std::string([input[@"operation"] UTF8String])+":"+[input[@"phase"] UTF8String]+":"+requestID.UTF8String;
 if(h->requestOriginals.count(key)||h->requestOriginals.size()>=64)return Error(env,"ORIGINAL_PRIVATE_ALREADY_ENTERED");
 NSData *raw=[NSJSONSerialization dataWithJSONObject:input options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!YNXOriginalRecoverablePrivateCarrierBudget(input,raw,h->selection))return Error(env,"AUTH_IDENTITY_OPERATION_MISMATCH");
 if(!LegacyPrivateEntryPermitted(h->selection)){auto it=h->persistentFirstEnterVerified.find(key);if(it==h->persistentFirstEnterVerified.end()||it->second!=std::string((const char*)raw.bytes,raw.length)||!FirstEnterPermitCurrent(h,key,it->second,true))return Error(env,"SOURCE_PERSISTENT_ENTERED_NATIVE_GATE_REQUIRED");}
 if(h->kind==Kind::privateService&&h->serviceReceivedRaw!=std::string((const char*)raw.bytes,raw.length))return Error(env,"ORIGINAL_SERVICE_RECEIVED_INPUT_REQUIRED");
 h->requestOriginals.emplace(key,std::string((const char *)raw.bytes,raw.length));h->admittedPrivateRequests.insert(key); // Before late fence, never replay on failure.
 if(!Current(h))return nullptr;return Undefined(env);
}
static NSString *TerminalSHA(NSData *raw){if(!raw)return nil;unsigned char hash[CC_SHA256_DIGEST_LENGTH];CC_SHA256(raw.bytes,(CC_LONG)raw.length,hash);NSMutableString *result=[NSMutableString string];for(unsigned char byte:hash)[result appendFormat:@"%02x",byte];return result;}
static NSData *TerminalCanonical(id value){return [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];}
static bool TerminalSameStat(struct stat a,struct stat b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;}
static bool TerminalDirectoryStat(struct stat s){return S_ISDIR(s.st_mode)&&s.st_uid==getuid()&&(s.st_mode&0777)==0700;}
static NSData *TerminalReadAt(OriginalAuthHandle *h,int parent,NSString *leaf,ynx_auth_private::TemporaryDescriptor &descriptor,size_t limit){
 if(descriptor.unresolved()||![leaf isKindOfClass:NSString.class]||[leaf containsString:@"/"]||[leaf isEqual:@"."]||[leaf isEqual:@".."])return nil;
 int fd=openat(parent,leaf.UTF8String,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(fd<0)return nil;if(!descriptor.hold(fd))return nil;
 struct stat before,named,after;if(fstat(fd,&before)||!S_ISREG(before.st_mode)||before.st_uid!=getuid()||(before.st_mode&0777)!=0600||before.st_nlink!=1||before.st_size<=0||(uint64_t)before.st_size>limit||fstatat(parent,leaf.UTF8String,&named,AT_SYMLINK_NOFOLLOW)||!TerminalSameStat(before,named)){CloseTemporary(h,descriptor);return nil;}
 NSMutableData *raw=[NSMutableData dataWithLength:(NSUInteger)before.st_size];size_t offset=0;bool valid=true;
 while(offset<raw.length){ssize_t n=pread(fd,(char *)raw.mutableBytes+offset,raw.length-offset,(off_t)offset);if(n<=0){valid=false;break;}offset+=(size_t)n;}
 if(fstat(fd,&after)||fstatat(parent,leaf.UTF8String,&named,AT_SYMLINK_NOFOLLOW)||!TerminalSameStat(before,after)||!TerminalSameStat(before,named))valid=false;
 if(!CloseTemporary(h,descriptor))valid=false;return valid?[raw copy]:nil;
}
static NSDictionary *TerminalRecord(NSData *raw,NSArray *fields){
 if(!raw)return nil;id value=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
 if(![value isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:[value allKeys]] isEqual:[NSSet setWithArray:fields]]||![TerminalCanonical(value) isEqual:raw])return nil;
 id version=value[@"version"];if(![version isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)version)==CFBooleanGetTypeID()||[version doubleValue]!=1.0)return nil;return value;
}
// Read-only custody recovery. No business operation, ACK, global-UNKNOWN reset,
// Source replacement, filesystem write or reconstructed response exists here.
static napi_value ReadPrivateTerminalResult(napi_env env,napi_callback_info info){
 napi_value a[4];if(!Args(env,info,4,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 OriginalAuthHandle *h=PrivateOriginal(env,a[0]);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");
 if(!IDEPrivateCurrent(h))return nullptr;
 if(!YNXOriginalPrivateTerminalRecoveryRegistered(h->selection))return Error(env,"AUTH_IDENTITY_TERMINAL_RECOVERY_NOT_REGISTERED");
 NSString *values[3];for(unsigned i=0;i<3;i++){size_t size=0;if(napi_get_value_string_utf8(env,a[i+1],nullptr,0,&size)!=napi_ok||size>128)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");std::string text(size+1,char(0));if(napi_get_value_string_utf8(env,a[i+1],text.data(),text.size(),&size)!=napi_ok)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");values[i]=[[NSString alloc]initWithBytes:text.data() length:size encoding:NSUTF8StringEncoding];if(!values[i])return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");}
 NSString *operation=values[0],*phase=values[1],*requestID=values[2];
 if(![operation isEqual:@"handleReturn"]||![phase isEqual:@"effect"])return Error(env,"AUTH_IDENTITY_OPERATION_MISMATCH");
 std::string key=std::string(operation.UTF8String)+":"+phase.UTF8String+":"+requestID.UTF8String;
 auto original=h->requestOriginals.find(key);
 if(original==h->requestOriginals.end()||(!h->enteredRequests.count(key)&&!h->admittedPrivateRequests.count(key))||h->terminalAcknowledged.count(key)||h->terminalReadSelected.count(key))return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_UNKNOWN");
 NSData *inputRaw=[NSData dataWithBytes:original->second.data() length:original->second.size()];NSDictionary *input=YNXTerminalObject(inputRaw,262144);
 if(!YNXOriginalRecoverablePrivateCarrierBudget(input,inputRaw,h->selection)||![input[@"referenceAction"] isEqual:@"complete"])return Error(env,"AUTH_IDENTITY_OPERATION_MISMATCH");
 h->terminalReadSelected.insert(key); // Same read attempt is never replayed after UNKNOWN.
 NSString *statePath=h->selection[@"originalHostStatePath"],*journal=h->selection[@"originalHostTerminalDirectory"];
 if(![statePath isKindOfClass:NSString.class]||![statePath hasPrefix:@"/"]||![statePath.stringByStandardizingPath isEqual:statePath]||![journal isKindOfClass:NSString.class]||![journal isEqual:[statePath stringByAppendingString:@".private-terminal"]])return Error(env,"AUTH_IDENTITY_ORIGINAL_HOST_TERMINAL_RESOURCE_NOT_SUPPLIED");
 for(auto *d:{&h->terminalParent,&h->terminalDirectory,&h->terminalEntered,&h->terminalResult,&h->terminalState})if(d->unresolved())return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_CLOSE_UNKNOWN");
 NSString *parent=statePath.stringByDeletingLastPathComponent;char canonical[PATH_MAX];if(!realpath(parent.fileSystemRepresentation,canonical)||![parent isEqual:[NSString stringWithUTF8String:canonical]])return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_PATH_CHANGED");
 struct stat pn,ph,jn,jh;if(lstat(parent.fileSystemRepresentation,&pn)||!TerminalDirectoryStat(pn))return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_PATH_CHANGED");
 bool clean=true;auto finish=[&](){for(auto *d:{&h->terminalState,&h->terminalResult,&h->terminalEntered,&h->terminalDirectory,&h->terminalParent})if(d->unresolved()&&!CloseTemporary(h,*d))clean=false;return clean;};
 int parentFD=open(parent.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(parentFD<0)return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_UNKNOWN");h->terminalParent.hold(parentFD);
 if(fstat(parentFD,&ph)||!TerminalSameStat(pn,ph)||fstatat(parentFD,journal.lastPathComponent.UTF8String,&jn,AT_SYMLINK_NOFOLLOW)||!TerminalDirectoryStat(jn)){finish();return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_PATH_CHANGED");}
 int directory=openat(parentFD,journal.lastPathComponent.UTF8String,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(directory<0){finish();return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_UNKNOWN");}h->terminalDirectory.hold(directory);
 if(fstat(directory,&jh)||!TerminalSameStat(jn,jh)){finish();return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_PATH_CHANGED");}
 NSString *leaf=TerminalSHA(TerminalCanonical(@{@"operation":operation,@"phase":phase,@"requestId":requestID}));
 NSData *entered=TerminalReadAt(h,directory,[leaf stringByAppendingString:@".entered"],h->terminalEntered,8192),*terminal=TerminalReadAt(h,directory,[leaf stringByAppendingString:@".terminal"],h->terminalResult,8192),*state=TerminalReadAt(h,parentFD,statePath.lastPathComponent,h->terminalState,32*1024*1024);
 auto retained=h->responses.find(key);NSData *late=retained==h->responses.end()?nil:[NSData dataWithBytes:retained->second.data() length:retained->second.size()];NSString *cause=nil;
 NSDictionary *proof=YNXOriginalTerminalCustodyResult(entered,terminal,state,inputRaw,TerminalCanonical(h->selection[@"association"]),late,&cause);
 struct stat p2,j2,named;if(fstat(parentFD,&p2)||lstat(parent.fileSystemRepresentation,&named)||!TerminalSameStat(p2,ph)||!TerminalSameStat(p2,named)||fstat(directory,&j2)||fstatat(parentFD,journal.lastPathComponent.UTF8String,&named,AT_SYMLINK_NOFOLLOW)||!TerminalSameStat(j2,jh)||!TerminalSameStat(j2,named)){proof=nil;if(!cause)cause=@"AUTH_IDENTITY_ORIGINAL_TERMINAL_PATH_CHANGED";}
 NSString *first=proof?nil:(cause?:@"AUTH_IDENTITY_ORIGINAL_TERMINAL_UNKNOWN");
 if(!finish()){h->terminalReadCleanupCauses.emplace(key,"AUTH_IDENTITY_ORIGINAL_TERMINAL_CLOSE_UNKNOWN");if(!first)first=@"AUTH_IDENTITY_ORIGINAL_TERMINAL_CLOSE_UNKNOWN";}
 if(first){h->terminalReadCauses.emplace(key,first.UTF8String);return Error(env,first.UTF8String);}
 // Retain actual recovered bytes before the late Source fence/JS allocation.
 NSData *response=[proof[@"responseRaw"] dataUsingEncoding:NSUTF8StringEncoding];
 h->responses.emplace(key,std::string((const char *)response.bytes,response.length));
 napi_value result=JSON(env,proof);
 if(!result){h->terminalReadCauses.emplace(key,"AUTH_IDENTITY_TERMINAL_RESULT_CAPTURE_UNKNOWN");return nullptr;}
 if(!IDEPrivateCurrent(h)){h->terminalReadCauses.emplace(key,"AUTH_IDENTITY_TERMINAL_SOURCE_CURRENT_CHANGED");return nullptr;}
 return result; // Data only. Existing one-shot terminal ACK remains required.
}

static napi_value TerminalPrivate(napi_env env,napi_callback_info info){
 napi_value a[5];size_t count=5;if(napi_get_cb_info(env,info,&count,a,nullptr,nullptr)!=napi_ok||count!=5)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 OriginalAuthHandle *h=PrivateOriginal(env,a[0]);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(h))return nullptr;
 NSString *values[4];for(unsigned i=0;i<4;i++){size_t size=0;if(napi_get_value_string_utf8(env,a[i+1],nullptr,0,&size)!=napi_ok||size>128)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");std::string text(size+1,'\0');if(napi_get_value_string_utf8(env,a[i+1],text.data(),text.size(),&size)!=napi_ok)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");values[i]=[[NSString alloc] initWithBytes:text.data() length:size encoding:NSUTF8StringEncoding];if(!values[i])return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");}
 NSString *operation=values[0],*phase=values[1],*requestId=values[2],*resultDigest=values[3];
 if(![@[@"beginYNX",@"handleReturn",@"restore",@"disconnect"] containsObject:operation]||![@[@"time",@"effect"] containsObject:phase])return Error(env,"AUTH_IDENTITY_OPERATION_MISMATCH");
 std::string requestKey=std::string(operation.UTF8String)+":"+phase.UTF8String+":"+requestId.UTF8String;
 auto input=h->requestOriginals.find(requestKey),response=h->responses.find(requestKey);
 if(input==h->requestOriginals.end()||(response==h->responses.end()&&!h->admittedPrivateRequests.count(requestKey))||h->terminalAcknowledged.count(requestKey))return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_UNKNOWN");
 NSData *inputRaw=[NSData dataWithBytes:input->second.data() length:input->second.size()];
 if(response!=h->responses.end()){
  NSData *responseRaw=[NSData dataWithBytes:response->second.data() length:response->second.size()];id responseObject=[NSJSONSerialization JSONObjectWithData:responseRaw options:0 error:nil];
  if(!responseObject||![TerminalSHA(TerminalCanonical(responseObject)) isEqual:resultDigest])return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_UNKNOWN");
 }
 // Both locators MUST come from independently authenticated Native-purpose
 // Source selection. This private storage contract never admits that Source.
 NSString *statePath=h->selection[@"originalHostStatePath"],*journal=h->selection[@"originalHostTerminalDirectory"];
 if(![statePath isKindOfClass:NSString.class]||![journal isKindOfClass:NSString.class]||![journal isEqual:[statePath stringByAppendingString:@".private-terminal"]]||![statePath hasPrefix:@"/"]||![statePath.stringByStandardizingPath isEqual:statePath])return Error(env,"AUTH_IDENTITY_ORIGINAL_HOST_TERMINAL_RESOURCE_NOT_SUPPLIED");
 for(auto *descriptor:{&h->terminalParent,&h->terminalDirectory,&h->terminalEntered,&h->terminalResult,&h->terminalState})if(descriptor->unresolved())return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_CLOSE_UNKNOWN");
 NSString *parent=statePath.stringByDeletingLastPathComponent;char canonical[PATH_MAX];
 if(!realpath(parent.fileSystemRepresentation,canonical)||![parent isEqual:[NSString stringWithUTF8String:canonical]])return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_PATH_CHANGED");
 struct stat parentNamed,parentHeld,journalNamed,journalHeld;
 if(lstat(parent.fileSystemRepresentation,&parentNamed)||!TerminalDirectoryStat(parentNamed))return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_PATH_CHANGED");
 bool clean=true;auto finish=[&](){for(auto *descriptor:{&h->terminalState,&h->terminalResult,&h->terminalEntered,&h->terminalDirectory,&h->terminalParent})if(descriptor->unresolved()&&!CloseTemporary(h,*descriptor))clean=false;return clean;};
 int parentFD=open(parent.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(parentFD<0)return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_UNKNOWN");h->terminalParent.hold(parentFD);
 if(fstat(parentFD,&parentHeld)||!TerminalSameStat(parentHeld,parentNamed)||fstatat(parentFD,journal.lastPathComponent.UTF8String,&journalNamed,AT_SYMLINK_NOFOLLOW)||!TerminalDirectoryStat(journalNamed)){finish();return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_PATH_CHANGED");}
 int directory=openat(parentFD,journal.lastPathComponent.UTF8String,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(directory<0){finish();return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_UNKNOWN");}h->terminalDirectory.hold(directory);
 if(fstat(directory,&journalHeld)||!TerminalSameStat(journalHeld,journalNamed)){finish();return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_PATH_CHANGED");}
 NSString *key=TerminalSHA(TerminalCanonical(@{@"operation":operation,@"phase":phase,@"requestId":requestId}));
 NSData *enteredRaw=TerminalReadAt(h,directory,[key stringByAppendingString:@".entered"],h->terminalEntered,8192),*terminalRaw=TerminalReadAt(h,directory,[key stringByAppendingString:@".terminal"],h->terminalResult,8192),*stateRaw=TerminalReadAt(h,parentFD,statePath.lastPathComponent,h->terminalState,32*1024*1024);
 NSDictionary *entered=TerminalRecord(enteredRaw,@[@"version",@"kind",@"requestDigest",@"associationDigest",@"operation",@"phase",@"requestId",@"stateBeforeDigest"]);
 NSDictionary *terminal=TerminalRecord(terminalRaw,@[@"version",@"kind",@"enteredDigest",@"requestDigest",@"associationDigest",@"operation",@"phase",@"requestId",@"responseDigest",@"stateBeforeDigest",@"stateAfterDigest"]);
 NSString *associationDigest=TerminalSHA(TerminalCanonical(h->selection[@"association"]));
 NSDictionary *originalInput=YNXTerminalObject(inputRaw,262144);
 bool recovery=[originalInput[@"carrierVersion"] isEqual:@"YNX-PRODUCT-SESSION-PRIVATE/v4"]&&[originalInput[@"referenceAction"] isEqual:@"complete"]&&YNXOriginalPrivateTerminalRecoveryRegistered(h->selection);
 bool valid=false;
 if(recovery){
  if(!IDEPrivateCurrent(h)){finish();return nullptr;}
  NSData *late=response==h->responses.end()?nil:[NSData dataWithBytes:response->second.data() length:response->second.size()];
  NSString *cause=nil;NSDictionary *proof=YNXOriginalTerminalCustodyResult(enteredRaw,terminalRaw,stateRaw,inputRaw,TerminalCanonical(h->selection[@"association"]),late,&cause);
  valid=proof&&[proof[@"responseDigest"] isEqual:resultDigest];
 }else{
  // Same v1 producer schema; correct its snapshot-vs-file coordinate bug.
  valid=entered&&terminal&&stateRaw&&associationDigest&&[entered[@"kind"] isEqual:@"entered"]&&[terminal[@"kind"] isEqual:@"terminal"]&&[terminal[@"enteredDigest"] isEqual:TerminalSHA(enteredRaw)]&&[terminal[@"responseDigest"] isEqual:resultDigest]&&[terminal[@"stateAfterDigest"] isEqual:YNXOriginalPrivateSnapshotDigest(YNXTerminalObject(stateRaw,32*1024*1024))];
  for(NSDictionary *record in @[entered?:@{},terminal?:@{}])if(![record[@"operation"] isEqual:operation]||![record[@"phase"] isEqual:phase]||![record[@"requestId"] isEqual:requestId]||![record[@"requestDigest"] isEqual:TerminalSHA(inputRaw)]||![record[@"associationDigest"] isEqual:associationDigest])valid=false;
  if(![terminal[@"stateBeforeDigest"] isEqual:entered[@"stateBeforeDigest"]])valid=false;
 }
 struct stat p2,j2,named2;if(fstat(parentFD,&p2)||lstat(parent.fileSystemRepresentation,&named2)||!TerminalSameStat(p2,parentHeld)||!TerminalSameStat(p2,named2)||fstat(directory,&j2)||fstatat(parentFD,journal.lastPathComponent.UTF8String,&named2,AT_SYMLINK_NOFOLLOW)||!TerminalSameStat(j2,journalHeld)||!TerminalSameStat(j2,named2))valid=false;
 if(!finish()||!valid)return Error(env,"AUTH_IDENTITY_ORIGINAL_TERMINAL_UNKNOWN");
 if(recovery&&!IDEPrivateCurrent(h))return nullptr;
 if(!Current(h))return nullptr;
 h->terminalAcknowledgedRecords.emplace(requestKey,std::make_pair(std::string(TerminalSHA(enteredRaw).UTF8String),std::string(TerminalSHA(terminalRaw).UTF8String)));
 h->terminalAcknowledged.insert(requestKey);if(h->kind==Kind::privateService)h->serviceAcknowledged.emplace(requestKey,resultDigest.UTF8String);return Undefined(env);
}
struct OriginalHostJournal {unsigned firstEnterChildren=0;std::unordered_set<std::string> firstEnterRequests;ynx_auth_private::HostDirfdJournal io;OriginalAuthHandle *parent;bool ready=false,busy=false,retired=false,closed=false,closeSelected=false;std::string first;bool retainedOnly=false;std::string stateLeaf;std::unordered_set<std::string> retainedReads;
 napi_env coldEnv=nullptr;YNXAuthIdentitySourceAuthority *__strong coldSource=nil;NSDictionary *__strong coldSelection=nil;};
static std::unordered_set<OriginalHostJournal *> hostJournals,hostJournalDebt;
static OriginalHostJournal *HostJournalOriginal(napi_env env,napi_value ref){void *p=nullptr;if(napi_unwrap(env,ref,&p)!=napi_ok)return nullptr;auto *h=(OriginalHostJournal *)p;return hostJournals.count(h)&&((h->coldEnv==env&&h->parent==nullptr)||(originals.count(h->parent)&&h->parent->env==env))?h:nullptr;}
static bool HostJournalClose(OriginalHostJournal *h){
 h->retired=true;if(h->busy||h->firstEnterChildren)return false;if(h->closeSelected)return h->closed;h->closeSelected=true;h->closed=h->io.close();
 if(h->coldSource){@try{NSError*error=nil;[h->coldSource retire];BOOL joined=[h->coldSource join:&error];BOOL closed=joined&&[h->coldSource close:&error];if(!closed){h->closed=false;if(h->first.empty())h->first=(error.localizedDescription?:@"HOST_DIRFD_COLD_SOURCE_CLOSE_UNKNOWN").UTF8String;}}@catch(id cause){(void)cause;h->closed=false;if(h->first.empty())h->first="HOST_DIRFD_COLD_SOURCE_CLOSE_EXCEPTION";}}
 if(h->closed){if(h->parent&&h->parent->children)h->parent->children--;hostJournalDebt.erase(h);}else hostJournalDebt.insert(h);return h->closed;
}
static void HostJournalFinalize(napi_env,void *p,void *){auto *h=(OriginalHostJournal *)p;if(!hostJournals.count(h)||!HostJournalClose(h))return;hostJournals.erase(h);delete h;}
static bool HostJournalString(napi_env env,napi_value input,size_t limit,std::string &out){size_t size=0;if(napi_get_value_string_utf8(env,input,nullptr,0,&size)!=napi_ok||size>limit)return false;out.assign(size+1,'\0');if(napi_get_value_string_utf8(env,input,out.data(),out.size(),&size)!=napi_ok)return false;out.resize(size);return out.find('\0')==std::string::npos;}
static napi_value HostJournalOpen(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto *parent=PrivateOriginal(env,a[0]);if(!parent)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(parent))return nullptr;
 std::string statePath;if(!HostJournalString(env,a[1],4096,statePath))return Error(env,"HOST_DIRFD_SELECTION_INVALID");
 NSString *selected=parent->selection[@"originalHostStatePath"],*journal=parent->selection[@"originalHostTerminalDirectory"];
 if(![selected isKindOfClass:NSString.class]||statePath!=selected.UTF8String||![journal isKindOfClass:NSString.class]||![journal isEqual:[selected stringByAppendingString:@".private-terminal"]])return Error(env,"HOST_DIRFD_ORIGINAL_SOURCE_SELECTION_REQUIRED");
 auto *h=new OriginalHostJournal{};h->parent=parent;parent->children++;hostJournals.insert(h);hostJournalDebt.insert(h);
 napi_value ref;napi_create_object(env,&ref);if(napi_wrap(env,ref,h,HostJournalFinalize,nullptr,nullptr)!=napi_ok)return Error(env,"HOST_DIRFD_WRAP_UNKNOWN");
 // Return exact partial custody even on open failure; assertReady reports it.
 try{h->io.open(selected.stringByDeletingLastPathComponent.UTF8String,journal.lastPathComponent.UTF8String);h->ready=true;NSError *e=nil;if(![parent->source assertAuthenticatedNativePurpose:&e]){h->first="HOST_DIRFD_SOURCE_CURRENT_CHANGED";h->ready=false;}}
 catch(const std::exception&e){h->first=e.what();h->ready=false;}return ref;
}

// Read-only cold DATA custody under the SAME authenticated parent. No state
// path, Source instance, provider, floor or session is accepted from the caller.
static napi_value HostJournalOpenRetained(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto*parent=PrivateOriginal(env,a[0]);if(!parent)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");
 if(!IDEPrivateCurrent(parent))return nullptr;
 if(!YNXOriginalPrivateTerminalRecoveryRegistered(parent->selection))return Error(env,"AUTH_IDENTITY_TERMINAL_RECOVERY_NOT_REGISTERED");
 NSString*selected=parent->selection[@"originalHostStatePath"],*journal=parent->selection[@"originalHostTerminalDirectory"];
 if(![selected isKindOfClass:NSString.class]||![selected hasPrefix:@"/"]||![selected isEqual:selected.stringByStandardizingPath]||![journal isEqual:[selected stringByAppendingString:@".private-terminal"]])return Error(env,"HOST_DIRFD_ORIGINAL_SOURCE_SELECTION_REQUIRED");
 auto*h=new OriginalHostJournal{};h->parent=parent;h->retainedOnly=true;h->stateLeaf=selected.lastPathComponent.UTF8String;parent->children++;hostJournals.insert(h);hostJournalDebt.insert(h);
 napi_value ref;napi_create_object(env,&ref);if(napi_wrap(env,ref,h,HostJournalFinalize,nullptr,nullptr)!=napi_ok)return Error(env,"HOST_DIRFD_WRAP_UNKNOWN");
 try{h->io.openRetained(selected.stringByDeletingLastPathComponent.UTF8String,journal.lastPathComponent.UTF8String);h->ready=true;if(!IDEPrivateCurrent(parent)){h->first="HOST_DIRFD_SOURCE_CURRENT_CHANGED";h->ready=false;}}
 catch(const std::exception&e){h->first=e.what();h->ready=false;}
 return ref; // A partial owner, never admission. assertReady must follow.
}


static NSDictionary*HostJournalSelection(OriginalHostJournal*h){return h->coldEnv?h->coldSelection:h->parent->selection;}
static bool HostJournalCurrent(OriginalHostJournal*h,bool report=true){
 if(!h->coldEnv)return IDEPrivateCurrent(h->parent);
 auto refuse=[&](const char*code){if(h->first.empty())h->first=code;if(report)Error(h->coldEnv,h->first.c_str());return false;};
 NSError*error=nil;
 if(!h->coldSource||![h->coldSource assertAuthenticatedNativePurpose:&error])return refuse((error.localizedDescription?:@"HOST_DIRFD_COLD_SOURCE_CURRENT_UNKNOWN").UTF8String);
 NSDictionary*selection=[h->coldSource copyOriginalSelection:&error];
 if(error||!selection||![selection isEqual:h->coldSelection])return refuse((error.localizedDescription?:@"HOST_DIRFD_COLD_SOURCE_SELECTION_CHANGED").UTF8String);
 return true;
}
// Cold caller is the actual IDE-owned runtime/node, verified by the original
// acquireOriginalIDEConsumerSource implementation. It needs no lost Node
// delivery, but it receives ONLY a read custodian, never a private-service owner.
static napi_value HostJournalAcquireCold(napi_env env,napi_callback_info info){
 napi_value unused[1];if(!Args(env,info,0,unused))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto*h=new OriginalHostJournal{};h->parent=nullptr;h->coldEnv=env;h->retainedOnly=true;hostJournals.insert(h);hostJournalDebt.insert(h);
 napi_value ref;napi_create_object(env,&ref);if(napi_wrap(env,ref,h,HostJournalFinalize,nullptr,nullptr)!=napi_ok)return Error(env,"HOST_DIRFD_WRAP_UNKNOWN");
 // Capture partial Source before any readiness/current/selection operation.
 @try{
  NSError*error=nil;h->coldSource=[YNXAuthIdentitySourceAuthority acquireOriginalIDEConsumerSource:&error];
  if(error||!h->coldSource){h->first=(error.localizedDescription?:@"HOST_DIRFD_COLD_SOURCE_NOT_SUPPLIED").UTF8String;return ref;}
  h->coldSelection=[h->coldSource copyOriginalSelection:&error];
  NSString*selected=h->coldSelection[@"originalHostStatePath"],*journal=h->coldSelection[@"originalHostTerminalDirectory"];
  if(error||!YNXOriginalPrivateTerminalRecoveryRegistered(h->coldSelection)||![selected isKindOfClass:NSString.class]||![selected hasPrefix:@"/"]||![selected isEqual:selected.stringByStandardizingPath]||![journal isEqual:[selected stringByAppendingString:@".private-terminal"]]){h->first="HOST_DIRFD_COLD_SOURCE_SELECTION_INVALID";return ref;}
  h->stateLeaf=selected.lastPathComponent.UTF8String;
  try{h->io.openRetained(selected.stringByDeletingLastPathComponent.UTF8String,journal.lastPathComponent.UTF8String);h->ready=true;}
  catch(const std::exception&e){h->first=e.what();h->ready=false;}
  if(h->ready&&!HostJournalCurrent(h,false)){if(h->first.empty())h->first="HOST_DIRFD_COLD_SOURCE_CURRENT_CHANGED";h->ready=false;}
 }@catch(id cause){(void)cause;if(h->first.empty())h->first="HOST_DIRFD_COLD_SOURCE_CAPTURE_EXCEPTION";h->ready=false;}
 return ref;
}

template<class Work>static napi_value HostJournalRun(napi_env env,napi_callback_info info,size_t count,Work work){
 napi_value a[4];if(!Args(env,info,count,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto *h=HostJournalOriginal(env,a[0]);if(!h)return Error(env,"HOST_DIRFD_ORIGINAL_OWNER_REQUIRED");
 if(h->busy||!h->ready||h->retired||!h->first.empty())return Error(env,h->first.empty()?"HOST_DIRFD_UNRESOLVED":h->first.c_str());h->busy=true;
 if(!HostJournalCurrent(h)){if(h->first.empty())h->first="HOST_DIRFD_SOURCE_CURRENT_CHANGED";h->busy=false;return nullptr;}
 try{h->io.assertCurrent();napi_value result=work(h,a);h->io.assertCurrent();if(!HostJournalCurrent(h)){if(h->first.empty())h->first="HOST_DIRFD_SOURCE_CURRENT_CHANGED";h->busy=false;return nullptr;}h->busy=false;return result;}
 catch(const std::exception&e){if(h->first.empty())h->first=e.what();h->busy=false;return Error(env,h->first.c_str());}
}
static napi_value HostJournalReady(napi_env env,napi_callback_info info){return HostJournalRun(env,info,1,[&](OriginalHostJournal *,napi_value *){return Undefined(env);});}

// Result is DATA only: immutable original entered+terminal+HostState bindings.
// No existing request/admission/once maps are repopulated and no effect runs.
static napi_value HostJournalRetainedResult(napi_env env,napi_callback_info info){return HostJournalRun(env,info,2,[&](OriginalHostJournal*h,napi_value*a){
 if(!h->retainedOnly)throw std::runtime_error("HOST_DIRFD_RETAINED_OWNER_REQUIRED");
 std::string request;if(!HostJournalString(env,a[1],65536,request))throw std::runtime_error("HOST_DIRFD_RETAINED_REQUEST_INVALID");
 NSData*inputRaw=[NSData dataWithBytes:request.data() length:request.size()];NSDictionary*input=YNXTerminalObject(inputRaw,65536);
 if(!YNXOriginalRecoverablePrivateCarrierBudget(input,inputRaw,HostJournalSelection(h))||![input[@"operation"] isEqual:@"handleReturn"]||![input[@"phase"] isEqual:@"effect"]||![input[@"referenceAction"] isEqual:@"complete"])throw std::runtime_error("HOST_DIRFD_RETAINED_REQUEST_INVALID");
 NSString*leaf=TerminalSHA(TerminalCanonical(@{@"operation":input[@"operation"],@"phase":input[@"phase"],@"requestId":input[@"requestId"]}));std::string key=leaf.UTF8String;
 if(h->retainedReads.size()>=64)throw std::runtime_error("HOST_DIRFD_RETAINED_READ_CAPACITY");
 if(!h->retainedReads.insert(key).second)throw std::runtime_error("HOST_DIRFD_RETAINED_READ_ALREADY_SELECTED");
 auto entered=h->io.read(key+".entered"),terminal=h->io.read(key+".terminal"),state=h->io.readRetainedState(h->stateLeaf);
 NSString*cause=nil;NSDictionary*proof=YNXOriginalTerminalCustodyResult([NSData dataWithBytes:entered.data() length:entered.size()],[NSData dataWithBytes:terminal.data() length:terminal.size()],[NSData dataWithBytes:state.data() length:state.size()],inputRaw,TerminalCanonical(HostJournalSelection(h)[@"association"]),nil,&cause);
 if(!proof)throw std::runtime_error((cause?:@"AUTH_IDENTITY_ORIGINAL_TERMINAL_UNKNOWN").UTF8String);
 // Validate that the exact files remain the retained originals after parsing.
 if(h->io.read(key+".entered")!=entered||h->io.read(key+".terminal")!=terminal||h->io.readRetainedState(h->stateLeaf)!=state)throw std::runtime_error("HOST_DIRFD_RETAINED_ORIGINAL_CHANGED");
 NSMutableDictionary*result=[proof mutableCopy];result[@"dataOnly"]=@YES;result[@"effectRetryAuthorized"]=@NO;result[@"nativeAdmission"]=@NO;
 return JSON(env,result);
});}

// Same-Native first-enter custody. Capture returns its exact partial owner
// before fallible IO; no key/path/current/profile/HostState setter is exposed.
static void FirstEnterPreviousResolved(OriginalHostJournal*j){
 // This is a preflight of the ALREADY owned writer, not a new Source borrow.
 // Filename pairing, status DTOs and cold JSON never settle old UNKNOWN.
 auto names=j->io.list();std::unordered_set<std::string> records(names.begin(),names.end());
 if(records.empty())return;
 auto*parent=j->parent;
 for(const auto&name:names){
  std::string leaf=name.substr(0,64);
  if(!records.count(leaf+".entered")||!records.count(leaf+".terminal"))throw std::runtime_error("HOST_TERMINAL_PREVIOUS_UNKNOWN");
  if(name.substr(64)!=".entered")continue;
  bool verified=false;
  for(const auto&entry:parent->requestOriginals){
   if(!parent->terminalAcknowledged.count(entry.first))continue;
   NSData*requestRaw=[NSData dataWithBytes:entry.second.data() length:entry.second.size()];NSDictionary*request=YNXTerminalObject(requestRaw,65536);
   if(!request||!YNXOriginalRecoverablePrivateCarrierBudget(request,requestRaw,parent->selection))continue;
   NSString*expected=TerminalSHA(TerminalCanonical(@{@"operation":request[@"operation"],@"phase":request[@"phase"],@"requestId":request[@"requestId"]}));
   if(leaf!=expected.UTF8String)continue;
   auto acknowledged=parent->terminalAcknowledgedRecords.find(entry.first);
   if(acknowledged==parent->terminalAcknowledgedRecords.end())throw std::runtime_error("HOST_TERMINAL_PREVIOUS_UNKNOWN");
   auto entered=j->io.read(leaf+".entered"),terminal=j->io.read(leaf+".terminal");
   if(acknowledged->second.first!=TerminalSHA([NSData dataWithBytes:entered.data() length:entered.size()]).UTF8String||acknowledged->second.second!=TerminalSHA([NSData dataWithBytes:terminal.data() length:terminal.size()]).UTF8String)throw std::runtime_error("HOST_TERMINAL_PREVIOUS_UNKNOWN");
   verified=true;break;
  }
  if(!verified)throw std::runtime_error("HOST_TERMINAL_PREVIOUS_UNKNOWN");
 }
}
struct OriginalFirstEnter {
 OriginalHostJournal *journal=nullptr;napi_env env=nullptr;
 ynx_auth_private::FirstEnterSelection life;
 std::string request,entered,stateDigest,stateKey,key,requestId,nonce;
 bool terminalWriteSelected=false;
 uint64_t expires=0,timeFloor=0;
 NSDictionary *__strong binding=nil;
};
static std::unordered_set<OriginalFirstEnter*> firstEnterOwners;
static OriginalFirstEnter *FirstEnterOriginal(napi_env env,napi_value ref){void*p=nullptr;if(napi_unwrap(env,ref,&p)!=napi_ok)return nullptr;auto*h=(OriginalFirstEnter*)p;return firstEnterOwners.count(h)&&h->env==env?h:nullptr;}
static void FirstEnterClose(OriginalFirstEnter*h){if(h->life.closed)return;h->life.close();if(h->journal){if(!h->journal->firstEnterChildren)abort();h->journal->firstEnterChildren--;h->journal=nullptr;}}
static void FirstEnterFinalize(napi_env,void*p,void*){auto*h=(OriginalFirstEnter*)p;if(!firstEnterOwners.count(h))return;FirstEnterClose(h);firstEnterOwners.erase(h);delete h;}
static void FirstEnterCurrent(OriginalFirstEnter*h){
 h->life.current();auto*j=h->journal;
 if(!j||!hostJournals.count(j)||j->retainedOnly||j->coldEnv||j->retired||j->closed||!j->ready||!j->first.empty())h->life.fail("FIRST_ENTER_ORIGINAL_JOURNAL_UNAVAILABLE");
 if(!HostJournalCurrent(j))h->life.fail("FIRST_ENTER_SOURCE_CURRENT_CHANGED");
 j->io.assertCurrent();
}
static napi_value FirstEnterCapture(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*j=HostJournalOriginal(env,a[0]);
 if(!j||j->retainedOnly||j->coldEnv)return Error(env,"FIRST_ENTER_WRITER_REQUIRED");
 // Refuse a NEW attempt before child allocation/nonce or Source reservation.
 // Existing same-attempt accept/permit paths do not run this preflight after
 // their own legitimate entered write, so they are not mistaken for old debt.
 try{
  if(j->busy||j->retired||j->closed||!j->ready||!j->first.empty())return Error(env,"HOST_TERMINAL_PREVIOUS_UNKNOWN");
  if(!HostJournalCurrent(j))return nullptr;
  FirstEnterPreviousResolved(j);
 }catch(const std::exception&e){return Error(env,e.what());}
 auto*h=new OriginalFirstEnter{};h->env=env;h->journal=j;j->firstEnterChildren++;firstEnterOwners.insert(h);
 napi_value ref;napi_create_object(env,&ref);if(napi_wrap(env,ref,h,FirstEnterFinalize,nullptr,nullptr)!=napi_ok)return Error(env,"FIRST_ENTER_WRAP_UNKNOWN");
 try{
  h->life.capture();FirstEnterCurrent(h);
  if(LegacyPrivateEntryPermitted(HostJournalSelection(j)))h->life.fail("FIRST_ENTER_VERSION_NOT_REGISTERED");
  if(!HostJournalString(env,a[1],65536,h->request))h->life.fail("FIRST_ENTER_REQUEST_INVALID");
  NSData*raw=[NSData dataWithBytes:h->request.data() length:h->request.size()];id request=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
  if(!YNXOriginalRecoverablePrivateCarrierBudget(request,raw,HostJournalSelection(j))||![TerminalCanonical(request)isEqual:raw]||![request[@"operation"]isEqual:@"handleReturn"]||![request[@"phase"]isEqual:@"effect"]||![request[@"referenceAction"]isEqual:@"complete"])h->life.fail("FIRST_ENTER_REQUEST_INVALID");
  h->requestId=[request[@"requestId"] UTF8String];h->key="handleReturn:effect:"+h->requestId;
  if(j->firstEnterRequests.size()>=64||!j->firstEnterRequests.insert(h->key).second)h->life.fail("FIRST_ENTER_ALREADY_CAPTURED");
  NSString*selected=HostJournalSelection(j)[@"originalHostStatePath"];
  h->stateKey="before-"+std::string(TerminalSHA(raw).UTF8String);
  std::string state=j->io.readOriginalStateForOperation(selected.lastPathComponent.UTF8String,h->stateKey);NSData*stateRaw=[NSData dataWithBytes:state.data() length:state.size()];
  NSString*before=YNXOriginalPrivateSnapshotDigest(YNXTerminalObject(stateRaw,32*1024*1024));if(!before)h->life.fail("FIRST_ENTER_HOST_STATE_INVALID");
  h->stateDigest=TerminalSHA(stateRaw).UTF8String;
  NSData*entered=TerminalCanonical(@{@"version":@1,@"kind":@"entered",@"requestDigest":TerminalSHA(raw),@"associationDigest":TerminalSHA(TerminalCanonical(HostJournalSelection(j)[@"association"])),@"operation":@"handleReturn",@"phase":@"effect",@"requestId":request[@"requestId"],@"stateBeforeDigest":before});
  h->entered=std::string((const char*)entered.bytes,entered.length);
  h->binding=@{@"requestDigest":TerminalSHA(raw),@"enteredDigest":TerminalSHA(entered),@"hostStateDigest":TerminalSHA(stateRaw)};
  unsigned char nonceBytes[32];if(SecRandomCopyBytes(kSecRandomDefault,sizeof(nonceBytes),nonceBytes)!=errSecSuccess)h->life.fail("FIRST_ENTER_NONCE_UNAVAILABLE");
  NSString*nonce=[[NSData dataWithBytes:nonceBytes length:32]base64EncodedStringWithOptions:0];nonce=[[nonce stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"];nonce=[nonce stringByReplacingOccurrencesOfString:@"=" withString:@""];h->nonce=nonce.UTF8String;
  FirstEnterCurrent(h);
 }catch(const std::exception&e){if(h->life.first.empty())h->life.first=e.what();}
 return ref;
}
static napi_value FirstEnterReady(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=FirstEnterOriginal(env,a[0]);if(!h)return Error(env,"FIRST_ENTER_ORIGINAL_REQUIRED");try{FirstEnterCurrent(h);return Undefined(env);}catch(const std::exception&e){return Error(env,e.what());}}
static napi_value FirstEnterChallenge(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=FirstEnterOriginal(env,a[0]);if(!h)return Error(env,"FIRST_ENTER_ORIGINAL_REQUIRED");try{FirstEnterCurrent(h);if(h->life.selected)h->life.fail("FIRST_ENTER_ALREADY_SELECTED");return JSON(env,@{@"version":@"YNX-AUTH-PERSISTENT-ENTERED/v1",@"requestId":[NSString stringWithUTF8String:h->requestId.c_str()],@"originalRequestRaw":[NSString stringWithUTF8String:h->request.c_str()],@"binding":h->binding,@"witnessNonce":[NSString stringWithUTF8String:h->nonce.c_str()],@"dataOnly":@YES,@"nativeAdmission":@NO});}catch(const std::exception&e){return Error(env,e.what());}}
static napi_value FirstEnterAccept(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=FirstEnterOriginal(env,a[0]);if(!h)return Error(env,"FIRST_ENTER_ORIGINAL_REQUIRED");
 try{
  FirstEnterCurrent(h);h->life.select();std::string witness;if(!HostJournalString(env,a[1],32768,witness))h->life.fail("FIRST_ENTER_WITNESS_INVALID");
  auto*j=h->journal;NSString*selected=HostJournalSelection(j)[@"originalHostStatePath"];
  // Another already captured child may have entered while this child waited
  // for its Source witness. It must not bypass prior UNKNOWN either.
  FirstEnterPreviousResolved(j);
  auto state=j->io.readOriginalStateForOperation(selected.lastPathComponent.UTF8String,h->stateKey);if(h->stateDigest!=TerminalSHA([NSData dataWithBytes:state.data() length:state.size()]).UTF8String)h->life.fail("FIRST_ENTER_HOST_STATE_CHANGED");
  NSError*error=nil;NSDictionary*facts=[j->parent->source verifyOriginalFirstEnterWitness:[NSData dataWithBytes:witness.data() length:witness.size()] binding:h->binding requestId:[NSString stringWithUTF8String:h->requestId.c_str()] nonce:[NSString stringWithUTF8String:h->nonce.c_str()] error:&error];
  if(!facts)h->life.fail((error.localizedDescription?:@"FIRST_ENTER_SOURCE_WITNESS_REFUSED").UTF8String);
  FirstEnterCurrent(h);state=j->io.readOriginalStateForOperation(selected.lastPathComponent.UTF8String,h->stateKey);
  if(h->stateDigest!=TerminalSHA([NSData dataWithBytes:state.data() length:state.size()]).UTF8String)h->life.fail("FIRST_ENTER_HOST_STATE_CHANGED");
  NSData*identity=TerminalCanonical(@{@"operation":@"handleReturn",@"phase":@"effect",@"requestId":[NSString stringWithUTF8String:h->requestId.c_str()]});
  j->io.writeExclusive(std::string(TerminalSHA(identity).UTF8String)+".entered",h->entered);
  FirstEnterCurrent(h);uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);if(now>=[facts[@"expiresAtMs"]unsignedLongLongValue]||now<[facts[@"verifiedAtMs"]unsignedLongLongValue])h->life.fail("FIRST_ENTER_POST_WRITE_CURRENT");
  h->expires=[facts[@"expiresAtMs"]unsignedLongLongValue];h->timeFloor=now;
  h->life.accept();j->parent->persistentFirstEnterVerified.emplace(h->key,h->request);return Undefined(env);
 }catch(const std::exception&e){if(h->life.first.empty())h->life.first=e.what();return Error(env,h->life.first.c_str());}
}
static napi_value FirstEnterRetire(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=FirstEnterOriginal(env,a[0]);if(!h)return Error(env,"FIRST_ENTER_ORIGINAL_REQUIRED");h->life.retire();return Undefined(env);}
static bool FirstEnterPermitCurrent(OriginalAuthHandle*parent,const std::string&key,const std::string&raw,bool select){
 for(auto*h:firstEnterOwners)if(h->journal&&h->journal->parent==parent&&h->key==key&&h->request==raw&&h->life.verified){
  try{FirstEnterCurrent(h);NSString*selected=HostJournalSelection(h->journal)[@"originalHostStatePath"];
   auto state=h->journal->io.readOriginalStateForOperation(selected.lastPathComponent.UTF8String,h->stateKey);
   if(h->stateDigest!=TerminalSHA([NSData dataWithBytes:state.data() length:state.size()]).UTF8String)h->life.fail("FIRST_ENTER_EFFECT_HOST_STATE_CHANGED");
   uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
   if(now<h->timeFloor||now>=h->expires)h->life.fail("FIRST_ENTER_EFFECT_POST_CURRENT");
   h->timeFloor=now;if(select)h->life.selectEffect();else if(!h->life.effectSelected)h->life.fail("FIRST_ENTER_EFFECT_NOT_SELECTED");return true;
  }catch(const std::exception&e){if(h->life.first.empty())h->life.first=e.what();return false;}
 }return false;
}
static napi_value FirstEnterJoin(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=FirstEnterOriginal(env,a[0]);if(!h||!h->life.retired)return Error(env,"FIRST_ENTER_JOIN_PENDING");return Undefined(env);}
static napi_value FirstEnterDispose(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=FirstEnterOriginal(env,a[0]);if(!h)return Error(env,"FIRST_ENTER_ORIGINAL_REQUIRED");FirstEnterClose(h);return Undefined(env);}
static void FirstEnterWriteTerminal(OriginalHostJournal*j,const std::string&name,const std::string&raw){
 // Terminal persistence is before the normal terminal verifier/ACK. Requiring
 // that future ACK here would be a cycle. This gate instead requires the
 // actual SAME live Native first-enter/effect selection and original bytes.
 for(auto*h:firstEnterOwners)if(h->journal==j&&h->life.verified&&h->life.effectSelected){
  NSString*leaf=TerminalSHA(TerminalCanonical(@{@"operation":@"handleReturn",@"phase":@"effect",@"requestId":[NSString stringWithUTF8String:h->requestId.c_str()]}));
  if(name!=std::string(leaf.UTF8String)+".terminal")continue;
  try{
   FirstEnterCurrent(h);
   if(!j->parent->admittedPrivateRequests.count(h->key)||j->parent->requestOriginals.find(h->key)==j->parent->requestOriginals.end()||j->parent->requestOriginals.at(h->key)!=h->request)h->life.fail("FIRST_ENTER_TERMINAL_ORIGINAL_REQUIRED");
   if(h->terminalWriteSelected)h->life.fail("FIRST_ENTER_TERMINAL_ALREADY_SELECTED");
   h->terminalWriteSelected=true; // Before read/validation/write; no retry.
   auto entered=j->io.read(std::string(leaf.UTF8String)+".entered");if(entered!=h->entered)h->life.fail("FIRST_ENTER_TERMINAL_ENTERED_CHANGED");
   NSString*selected=HostJournalSelection(j)[@"originalHostStatePath"];
   auto state=j->io.readOriginalStateForOperation(selected.lastPathComponent.UTF8String,"after-"+std::string(leaf.UTF8String));
   auto response=j->parent->responses.find(h->key);NSData*late=response==j->parent->responses.end()?nil:[NSData dataWithBytes:response->second.data() length:response->second.size()];
   NSString*cause=nil;NSDictionary*proof=YNXOriginalTerminalCustodyResult([NSData dataWithBytes:entered.data() length:entered.size()],[NSData dataWithBytes:raw.data() length:raw.size()],[NSData dataWithBytes:state.data() length:state.size()],[NSData dataWithBytes:h->request.data() length:h->request.size()],TerminalCanonical(j->parent->selection[@"association"]),late,&cause);
   if(!proof)h->life.fail((cause?:@"FIRST_ENTER_TERMINAL_BINDING_REFUSED").UTF8String);
   FirstEnterCurrent(h);uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
   if(before<h->timeFloor||before>=h->expires)h->life.fail("FIRST_ENTER_TERMINAL_CURRENT_EXPIRED");
   j->io.writeExclusive(name,raw);
   if(j->io.readOriginalStateForOperation(selected.lastPathComponent.UTF8String,"after-"+std::string(leaf.UTF8String))!=state)h->life.fail("FIRST_ENTER_TERMINAL_STATE_CHANGED");
   FirstEnterCurrent(h);
   if(j->io.readOriginalStateForOperation(selected.lastPathComponent.UTF8String,"after-"+std::string(leaf.UTF8String))!=state)h->life.fail("FIRST_ENTER_TERMINAL_STATE_CHANGED");
   uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
   if(after<before||after>=h->expires)h->life.fail("FIRST_ENTER_TERMINAL_POST_CURRENT");
   h->timeFloor=after;return; // DATA stored only; no ACK/UNKNOWN clearance here.
  }catch(const std::exception&e){if(h->life.first.empty())h->life.first=e.what();throw;}
 }
 throw std::runtime_error("FIRST_ENTER_TERMINAL_ORIGINAL_REQUIRED");
}
static napi_value HostJournalList(napi_env env,napi_callback_info info){return HostJournalRun(env,info,1,[&](OriginalHostJournal *h,napi_value *){NSMutableArray *rows=[NSMutableArray array];for(const auto &name:h->io.list())[rows addObject:[NSString stringWithUTF8String:name.c_str()]];return JSON(env,rows);});}
static napi_value HostJournalRead(napi_env env,napi_callback_info info){return HostJournalRun(env,info,2,[&](OriginalHostJournal *h,napi_value *a){std::string name;if(!HostJournalString(env,a[1],73,name))throw std::runtime_error("HOST_DIRFD_RECORD_INVALID");auto raw=h->io.read(name);napi_value result;napi_create_string_utf8(env,raw.data(),raw.size(),&result);return result;});}
static napi_value HostJournalWrite(napi_env env,napi_callback_info info){return HostJournalRun(env,info,3,[&](OriginalHostJournal *h,napi_value *a){std::string name,raw;if(!HostJournalString(env,a[1],73,name)||!HostJournalString(env,a[2],8192,raw))throw std::runtime_error("HOST_DIRFD_RECORD_INVALID");if(!LegacyPrivateEntryPermitted(HostJournalSelection(h))){FirstEnterWriteTerminal(h,name,raw);return Undefined(env);}h->io.writeExclusive(name,raw);return Undefined(env);});}
static napi_value HostJournalRetire(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto *h=HostJournalOriginal(env,a[0]);if(!h)return Error(env,"HOST_DIRFD_ORIGINAL_OWNER_REQUIRED");h->retired=true;h->io.retire();return Undefined(env);}
static napi_value HostJournalJoin(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto *h=HostJournalOriginal(env,a[0]);if(!h||!h->retired||h->busy)return Error(env,"HOST_DIRFD_JOIN_PENDING");return Undefined(env);}
static napi_value HostJournalDispose(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto *h=HostJournalOriginal(env,a[0]);if(!h)return Error(env,"HOST_DIRFD_ORIGINAL_OWNER_REQUIRED");return HostJournalClose(h)?Undefined(env):Error(env,"HOST_DIRFD_CLOSE_UNKNOWN");}
static napi_value Lifecycle(napi_env env,napi_callback_info info){void *p=nullptr;napi_value a[4];Operation op;size_t count=4;if(napi_get_cb_info(env,info,&count,a,nullptr,&p)!=napi_ok||count<1)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");op=(Operation)(uintptr_t)p;Kind kind=op<=adminClose?Kind::administration:Kind::joint;OriginalAuthHandle *h=Original(env,a[0],kind);if(!h&&op>=jointCurrent)h=PrivateOriginal(env,a[0]);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");
 if(op==adminRetire||op==jointRetire){h->retired=true;h->life.retire();IDERetireForOriginal(h);if(kind==Kind::administration)[h->source retire];return Undefined(env);}
 if(op==adminClose||op==jointClose){if(h->kind==Kind::privateService||h->kind==Kind::ideClient)return CloseServiceOwner(env,h);return Close(h)?Undefined(env):Error(env,"AUTH_IDENTITY_CLEANUP_UNKNOWN");}
 if(op==adminJoin||op==jointJoin){if(!h->retired)return Error(env,"AUTH_IDENTITY_NOT_RETIRED");if(!JoinReady(h))return Error(env,"AUTH_IDENTITY_CHILDREN_NOT_JOINED");return Undefined(env);}
 if(!Current(h))return nullptr;
 if(op==jointChild){if(count!=3||!h->view)return Error(env,"AUTH_IDENTITY_CHILD_NOT_SUPPLIED");napi_value view,executor;napi_get_reference_value(env,h->view,&view);napi_get_named_property(env,view,"executor",&executor);bool equal=false;napi_strict_equals(env,executor,a[1],&equal);if(!equal)return Error(env,"AUTH_IDENTITY_EXECUTOR_CHILD_MISMATCH");napi_valuetype kind;napi_typeof(env,a[2],&kind);if(kind!=napi_null&&!EnforcingChild(h,a[2]))return Error(env,"AUTH_IDENTITY_ENFORCING_CHILD_CHANGED");}
 if(op==jointSuccession){if(count!=2||![Dictionary(env,a[1]) isEqual:h->selection[@"expectedRequest"]])return Error(env,"AUTH_IDENTITY_SUCCESSION_MISMATCH");}
 return Undefined(env);
}
#include "../../../packages/wallet-auth/native/original-ide-parent-joint.inc.mm"
#include "original-private-service-owner.inc.mm"
#include "original-ide-private-client.inc.mm"
#include "original-ide-auth-identity-owners.inc.mm"
#include "original-ide-identity-peer-owner.inc.mm"
#include "original-ide-wallet-identity-source-owner.inc.mm"
#include "original-ide-auth-identity-binding.inc.mm"
static napi_value Register(napi_env env,napi_value exports){
 struct Method {const char *name;napi_callback callback;void *data;};
 Method methods[]={{"acquireOriginalIDEWalletIdentitySource",AcquireOriginalIDEWalletIdentitySource,nullptr},{"isOriginalIDEWalletIdentitySource",IsOriginalIDEWalletIdentitySource,nullptr},{"acquireOriginalIDEIdentityPeerChannel",PeerConstruct,nullptr},{"receiveOriginalIDEIdentity",IDEIdentityConstruct,(void*)1},{"recoverOriginalIDEIdentity",IDEIdentityConstruct,(void*)2},{"acquireOriginalIDEProtectedKeyCall",IDEIdentityConstruct,(void*)3},{"captureOriginalIDEPrivateClient",IDEClientCapture,nullptr},{"assertOriginalIDEPrivateClientReady",IDEClientReady,nullptr},{"captureOriginalIDEPrivateClientResult",IDEClientResult,nullptr},{"acquireOriginalNativePrivateServiceOwner",ServiceAcquire,nullptr},{"assertOriginalNativePrivateServiceOwnerReady",ServiceReady,nullptr},{"readOriginalNativePrivateServiceRequest",ServiceRead,nullptr},{"writeOriginalNativePrivateServiceResponse",ServiceWrite,nullptr},{"retireOriginalNativePrivateServiceOwner",ServiceLifecycle,(void*)0},{"joinOriginalNativePrivateServiceOwner",ServiceLifecycle,(void*)1},{"closeOriginalNativePrivateServiceOwner",ServiceLifecycle,(void*)2},{"acquireOriginalIDEAdministrationProfile",IDEAcquireAdministration,nullptr},{"readOriginalIDEParentInstalledFrame",IDEInstalledFrame,nullptr},{"assertOriginalIDEParentAcknowledgement",IDEAcknowledge,nullptr},{"beginOriginalIDEParentPrelude",IDEBeginPrelude,nullptr},{"takeOriginalIDEParentSenderDescriptor",IDETakeSender,nullptr},{"acquireOriginalIDEAdmissionParentDelivery",IDENodeAcquire,nullptr},{"reserveOriginalIDEParentIntent",IDEReserve,nullptr},{"readOriginalIDEParentIntent",IDEIntentRead,nullptr},{"assertOriginalIDEParentIntentCurrent",IDEIntentLifecycle,(void *)ideIntentCurrent},{"retireOriginalIDEParentIntent",IDEIntentLifecycle,(void *)ideIntentRetire},{"joinOriginalIDEParentIntent",IDEIntentLifecycle,(void *)ideIntentJoin},{"closeOriginalIDEParentIntent",IDEIntentLifecycle,(void *)ideIntentClose},{"acquireOriginalAdministrationProfile",Acquire,nullptr},{"readOriginalAdministrationProfile",ReadAdministration,nullptr},{"assertOriginalAdministrationProfileCurrent",Lifecycle,(void *)adminCurrent},{"retireOriginalAdministrationProfile",Lifecycle,(void *)adminRetire},{"joinOriginalAdministrationProfile",Lifecycle,(void *)adminJoin},{"closeOriginalAdministrationProfile",Lifecycle,(void *)adminClose},{"reserveOriginalJointRegistration",Reserve,nullptr},{"commitOriginalJointRegistration",Commit,nullptr},{"readOriginalJointRegistration",ReadJoint,nullptr},{"assertOriginalJointCurrent",Lifecycle,(void *)jointCurrent},{"assertOriginalJointExecutorChild",Lifecycle,(void *)jointChild},{"assertOriginalJointSuccession",Lifecycle,(void *)jointSuccession},{"retireOriginalJoint",Lifecycle,(void *)jointRetire},{"joinOriginalJoint",Lifecycle,(void *)jointJoin},{"closeOriginalJoint",Lifecycle,(void *)jointClose},
 {"acquireOriginalIDEColdTerminalCustody",HostJournalAcquireCold,nullptr},{"openOriginalHostRetainedTerminalJournal",HostJournalOpenRetained,nullptr},{"readOriginalHostRetainedTerminalCustody",HostJournalRetainedResult,nullptr},
 {"captureOriginalPersistentFirstEnter",FirstEnterCapture,nullptr},{"assertOriginalPersistentFirstEnterReady",FirstEnterReady,nullptr},{"copyOriginalPersistentFirstEnterChallenge",FirstEnterChallenge,nullptr},{"acceptOriginalPersistentFirstEnterWitness",FirstEnterAccept,nullptr},{"retireOriginalPersistentFirstEnter",FirstEnterRetire,nullptr},{"joinOriginalPersistentFirstEnter",FirstEnterJoin,nullptr},{"closeOriginalPersistentFirstEnter",FirstEnterDispose,nullptr},
 {"openOriginalHostTerminalJournal",HostJournalOpen,nullptr},{"assertOriginalHostTerminalJournalReady",HostJournalReady,nullptr},{"listOriginalHostTerminalJournal",HostJournalList,nullptr},{"readOriginalHostTerminalJournal",HostJournalRead,nullptr},{"writeOriginalHostTerminalJournal",HostJournalWrite,nullptr},{"retireOriginalHostTerminalJournal",HostJournalRetire,nullptr},{"joinOriginalHostTerminalJournal",HostJournalJoin,nullptr},{"closeOriginalHostTerminalJournal",HostJournalDispose,nullptr},
 {"readOriginalNativePrivateServiceTerminalResult",ReadPrivateTerminalResult,nullptr},
 {"captureOriginalNativePrivateServiceBorrow",CapturePrivate,nullptr},{"assertOriginalNativePrivateServiceCurrent",Lifecycle,(void *)jointCurrent},{"assertOriginalNativePrivateServiceAdmission",AdmissionPrivate,nullptr},{"assertOriginalNativePrivateServiceTerminal",TerminalPrivate,nullptr},{"retireOriginalNativePrivateService",Lifecycle,(void *)jointRetire},{"joinOriginalNativePrivateService",Lifecycle,(void *)jointJoin},{"closeOriginalNativePrivateService",Lifecycle,(void *)jointClose}};
 for(auto &m:methods){napi_property_descriptor descriptor={m.name,nullptr,m.callback,nullptr,nullptr,nullptr,napi_default,m.data};if(napi_define_properties(env,exports,1,&descriptor)!=napi_ok)return nullptr;}
 if(!RegisterOriginalIDEIdentityPeerBinding(env,exports,methods))return nullptr;return RegisterOriginalIDEAuthIdentityBinding(env,exports,methods);
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,Register)
