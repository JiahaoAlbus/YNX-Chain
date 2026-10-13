#import <Foundation/Foundation.h>
#include <node_api.h>
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
#include <CommonCrypto/CommonDigest.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include <Security/Security.h>
#import "../../../packages/wallet-auth/native/original-auth-identity-source-authority.h"

// Owning NAPI implementation. Registry membership preserves original custody,
// not authorization. Every business call also requires the actual Source gate.
enum class Kind { administration,joint };
struct OriginalAuthHandle {
 Kind kind; napi_env env; YNXAuthIdentitySourceAuthority *__strong source;
 NSDictionary *__strong selection; napi_ref vault=nullptr,view=nullptr,local=nullptr,result=nullptr;
 ynx_auth_private::JointLifecycle life;bool retired=false,closed=false,closeSelected=false,cleanupFailed=false;
 ynx_auth_private::TemporaryDescriptor commitDescriptor,readDescriptor;
 int journalDir=-1,channel=-1;std::string recordName;OriginalAuthHandle *parent=nullptr;unsigned children=0;
 std::unordered_map<std::string,std::string> responses;
 std::unordered_set<std::string> enteredRequests;
};
static std::unordered_set<OriginalAuthHandle *> originals,debt;
static bool CloseTemporary(OriginalAuthHandle *h,ynx_auth_private::TemporaryDescriptor &descriptor){
 bool completed=descriptor.closeOnce([](int fd){return close(fd);});
 if(!completed){h->cleanupFailed=true;debt.insert(h);}return completed;
}
static napi_value Undefined(napi_env env){napi_value v;return napi_get_undefined(env,&v)==napi_ok?v:nullptr;}
static napi_value Error(napi_env env,const char *code){napi_throw_error(env,code,code);return nullptr;}
static bool Args(napi_env env,napi_callback_info info,size_t n,napi_value *argv,void **data=nullptr){size_t count=n+1;napi_value values[5];if(n>4||napi_get_cb_info(env,info,&count,values,nullptr,data)!=napi_ok||count!=n)return false;for(size_t i=0;i<n;i++)argv[i]=values[i];return true;}
static OriginalAuthHandle *Original(napi_env env,napi_value value,Kind kind){void *p=nullptr;if(napi_unwrap(env,value,&p)!=napi_ok)return nullptr;OriginalAuthHandle *h=(OriginalAuthHandle *)p;if(!originals.count(h)||h->env!=env||h->kind!=kind)return nullptr;return h;}
static bool Current(OriginalAuthHandle *h,bool admission=true){NSError *e=nil;if(!h||h->retired||h->closed||![h->source assertCurrent:&e]||(admission&&![h->source assertAuthenticatedNativePurpose:&e])){if(h)Error(h->env,(e.localizedDescription?:@"AUTH_IDENTITY_ORIGINAL_RETIRED").UTF8String);return false;}return true;}
static NSDictionary *Dictionary(napi_env env,napi_value value){
 napi_value global,json,stringify,text;napi_get_global(env,&global);napi_get_named_property(env,global,"JSON",&json);napi_get_named_property(env,json,"stringify",&stringify);if(napi_call_function(env,json,stringify,1,&value,&text)!=napi_ok)return nil;
 size_t n=0;if(napi_get_value_string_utf8(env,text,nullptr,0,&n)!=napi_ok||n>65536)return nil;std::string raw(n+1,'\0');if(napi_get_value_string_utf8(env,text,raw.data(),raw.size(),&n)!=napi_ok)return nil;NSData *b=[NSData dataWithBytes:raw.data() length:n];id parsed=[NSJSONSerialization JSONObjectWithData:b options:0 error:nil];return [parsed isKindOfClass:NSDictionary.class]?parsed:nil;
}
static napi_value JSON(napi_env env,id value){NSData *bytes=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(!bytes||bytes.length>65536)return Error(env,"AUTH_IDENTITY_OUTPUT_CAPACITY");napi_value global,json,parse,text,result;napi_get_global(env,&global);napi_get_named_property(env,global,"JSON",&json);napi_get_named_property(env,json,"parse",&parse);napi_create_string_utf8(env,(const char *)bytes.bytes,bytes.length,&text);return napi_call_function(env,json,parse,1,&text,&result)==napi_ok?result:nullptr;}
static bool Same(napi_env env,napi_ref held,napi_value value){napi_value original;bool equal=false;return held&&napi_get_reference_value(env,held,&original)==napi_ok&&napi_strict_equals(env,original,value,&equal)==napi_ok&&equal;}
static bool EnforcingChild(OriginalAuthHandle *h,napi_value child){
 NSDictionary *observed=Dictionary(h->env,child),*approved=h->selection[@"enforcingChild"];
 if(![approved isKindOfClass:NSDictionary.class]||!observed||![observed isEqual:approved])return false;
 pid_t pid=[approved[@"pid"] intValue];struct proc_bsdinfo info{};if(pid<=1||proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))!=(int)sizeof(info)||info.pbi_uid!=getuid()||info.pbi_ppid!=getpid()||info.pbi_start_tvsec!=[approved[@"startSeconds"] unsignedLongLongValue]||info.pbi_start_tvusec!=[approved[@"startMicroseconds"] unsignedLongLongValue])return false;
 SecCodeRef code=nullptr;CFDictionaryRef metadata=nullptr;OSStatus status=SecCodeCopyGuestWithAttributes(nullptr,(__bridge CFDictionaryRef)@{(__bridge NSString *)kSecGuestAttributePid:@(pid)},kSecCSDefaultFlags,&code);if(status==errSecSuccess)status=SecCodeCheckValidity(code,kSecCSStrictValidate,nullptr);if(status==errSecSuccess)status=SecCodeCopySigningInformation(code,kSecCSSigningInformation,&metadata);
 NSData *actual=metadata?((__bridge NSDictionary *)metadata)[(__bridge NSString *)kSecCodeInfoUnique]:nil;NSString *expected=approved[@"codeHashBase64"];
 BOOL matches=status==errSecSuccess&&[actual isKindOfClass:NSData.class]&&[expected isKindOfClass:NSString.class]&&[[actual base64EncodedStringWithOptions:0] isEqual:expected];if(metadata)CFRelease(metadata);if(code)CFRelease(code);return matches;
}
static bool Close(OriginalAuthHandle *h){
 if(h->closeSelected)return h->closed;h->retired=true;if(h->children){h->cleanupFailed=true;debt.insert(h);return false;}h->closeSelected=true;
 for(int *fd:{&h->channel,&h->journalDir})if(*fd>=0){if(close(*fd)<0)h->cleanupFailed=true;else *fd=-1;}
 if(h->kind==Kind::administration){[h->source retire];NSError *e=nil;if(![h->source join:&e]||![h->source close:&e])h->cleanupFailed=true;}
 if(h->parent&&h->parent->children){h->parent->children--;h->parent=nullptr;}
 h->closed=!h->cleanupFailed&&!h->commitDescriptor.unresolved()&&!h->readDescriptor.unresolved();h->life.completedCleanup(h->closed);if(!h->closed)debt.insert(h);return h->closed;
}
static void Finalize(napi_env env,void *p,void *){OriginalAuthHandle *h=(OriginalAuthHandle *)p;if(!originals.count(h))return;if(!Close(h))return;for(napi_ref ref:{h->vault,h->view,h->local,h->result})if(ref)napi_delete_reference(env,ref);originals.erase(h);delete h;}
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
static napi_value PrivateDispatch(napi_env env,napi_callback_info info){
 void *p=nullptr;napi_value a[1];if(!Args(env,info,1,a,&p))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=(OriginalAuthHandle *)p;if(!originals.count(h)||h->kind!=Kind::joint||!Current(h))return nullptr;
 // Owned dispatcher has no callback installer. The canonical Host bridge
 // requires the original service resource, never a caller endpoint/provider.
 size_t length=0;if(napi_get_value_string_utf8(env,a[0],nullptr,0,&length)!=napi_ok||length>65536)return Error(env,"ORIGINAL_PRIVATE_REQUEST_INVALID");std::string raw(length+1,'\0');if(napi_get_value_string_utf8(env,a[0],raw.data(),raw.size(),&length)!=napi_ok)return Error(env,"ORIGINAL_PRIVATE_REQUEST_INVALID");NSData *bytes=[NSData dataWithBytes:raw.data() length:length];id parsed=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
 if(![parsed isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:[parsed allKeys]] isEqual:[NSSet setWithArray:@[@"requestId",@"operation",@"phase",@"body",@"proofHeader"]]])return Error(env,"ORIGINAL_PRIVATE_REQUEST_INVALID");
 NSData *canonical=[NSJSONSerialization dataWithJSONObject:parsed options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(![bytes isEqual:canonical]||![@[@"beginYNX",@"handleReturn",@"restore",@"disconnect"] containsObject:parsed[@"operation"]]||![@[@"time",@"effect"] containsObject:parsed[@"phase"]]||![parsed[@"requestId"] isKindOfClass:NSString.class])return Error(env,"ORIGINAL_PRIVATE_REQUEST_INVALID");
 std::string requestKey=std::string([parsed[@"operation"] UTF8String])+":"+[parsed[@"phase"] UTF8String]+":"+[parsed[@"requestId"] UTF8String];if(h->enteredRequests.count(requestKey)||h->enteredRequests.size()>=64)return Error(env,"ORIGINAL_PRIVATE_ALREADY_ENTERED");h->enteredRequests.insert(requestKey);
 NSString *path=h->selection[@"originalServiceSocket"];
 if(![path isKindOfClass:NSString.class]||![path hasPrefix:@"/"]||![path.stringByStandardizingPath isEqual:path]||[path lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>=sizeof(sockaddr_un::sun_path))return Error(env,"AUTH_IDENTITY_ORIGINAL_SERVICE_RESOURCE_NOT_SUPPLIED");
 struct stat named;if(lstat(path.fileSystemRepresentation,&named)||!S_ISSOCK(named.st_mode)||named.st_uid!=getuid()||(named.st_mode&0077))return Error(env,"AUTH_IDENTITY_ORIGINAL_SERVICE_RESOURCE_NOT_SUPPLIED");
 h->channel=socket(AF_UNIX,SOCK_STREAM,0);if(h->channel<0)return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");fcntl(h->channel,F_SETFD,FD_CLOEXEC);sockaddr_un address{};address.sun_family=AF_UNIX;strcpy(address.sun_path,path.fileSystemRepresentation);
 if(connect(h->channel,(sockaddr *)&address,sizeof(address)))return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");pid_t peer=0;socklen_t size=sizeof(peer);NSNumber *approved=h->selection[@"originalServicePID"];
 if(![approved isKindOfClass:NSNumber.class]||getsockopt(h->channel,SOL_LOCAL,LOCAL_PEERPID,&peer,&size)||peer!=approved.intValue||!Current(h))return Error(env,"AUTH_IDENTITY_ORIGINAL_SERVICE_PEER_CHANGED");
 std::string frame(raw.data(),length);frame+='\n';size_t sent=0;while(sent<frame.size()){pollfd p{h->channel,POLLOUT,0};if(poll(&p,1,15000)!=1)return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");ssize_t n=write(h->channel,frame.data()+sent,frame.size()-sent);if(n<=0)return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");sent+=(size_t)n;}
 std::string response;while(response.size()<=65536){pollfd p{h->channel,POLLIN,0};if(poll(&p,1,15000)!=1)return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");char b;ssize_t n=read(h->channel,&b,1);if(n!=1)return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_UNKNOWN");if(b=='\n')break;response+=b;}
 if(response.size()>65536)return Error(env,"AUTH_IDENTITY_PRIVATE_RESPONSE_CAPACITY");id result=[NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:response.data() length:response.size()] options:0 error:nil];
 if(![result isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:[result allKeys]] isEqual:[NSSet setWithArray:@[@"status",@"headers",@"body"]]]||![result[@"body"] isKindOfClass:NSString.class])return Error(env,"AUTH_IDENTITY_PRIVATE_RESPONSE_INVALID");
 h->responses.emplace(requestKey,response);napi_value original=JSON(env,result); // capture before late Source current fence
 if(!Current(h))return nullptr;if(close(h->channel)){h->cleanupFailed=true;debt.insert(h);return Error(env,"AUTH_IDENTITY_PRIVATE_CHANNEL_CLOSE_UNKNOWN");}h->channel=-1;return original;
}
static napi_value ReadJoint(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=Original(env,a[0],Kind::joint);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(h))return nullptr;if(!Same(env,h->result,a[1])||h->journalDir<0)return Error(env,"AUTH_IDENTITY_ORIGINAL_RESULT_REQUIRED");
 if(h->readDescriptor.unresolved())return Error(env,"AUTH_IDENTITY_READBACK_UNKNOWN");
 int fd=openat(h->journalDir,h->recordName.c_str(),O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd>=0)h->readDescriptor.hold(fd);struct stat st;if(fd<0||fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_nlink!=1||st.st_uid!=getuid()||(st.st_mode&0077)||st.st_size<1||st.st_size>65536){if(fd>=0)CloseTemporary(h,h->readDescriptor);return Error(env,"AUTH_IDENTITY_READBACK_UNKNOWN");}
 NSMutableData *bytes=[NSMutableData dataWithLength:(NSUInteger)st.st_size];ssize_t n=pread(fd,bytes.mutableBytes,bytes.length,0);bool closeFailed=!CloseTemporary(h,h->readDescriptor);if(n!=(ssize_t)bytes.length||closeFailed)return Error(env,"AUTH_IDENTITY_READBACK_UNKNOWN");id readback=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];napi_value expected;napi_get_reference_value(env,h->result,&expected);if(![readback isEqual:Dictionary(env,expected)])return Error(env,"AUTH_IDENTITY_READBACK_UNKNOWN");if(!Current(h))return nullptr;h->life.completeReadback();
 napi_value view=JSON(env,@{@"association":h->selection[@"association"],@"raw":h->selection[@"raw"],@"executor":h->selection[@"executor"],@"observer":h->selection[@"observer"]}),vault,executor,dispatch;napi_get_reference_value(env,h->vault,&vault);napi_set_named_property(env,view,"vault",vault);napi_get_named_property(env,view,"executor",&executor);napi_create_function(env,"privateDispatch",NAPI_AUTO_LENGTH,PrivateDispatch,h,&dispatch);napi_set_named_property(env,executor,"privateDispatch",dispatch);napi_create_reference(env,view,1,&h->view);return view;
}
enum Operation {adminCurrent,adminRetire,adminJoin,adminClose,jointCurrent,jointChild,jointSuccession,jointRetire,jointJoin,jointClose};
static napi_value CapturePrivate(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=Original(env,a[0],Kind::joint);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(h))return nullptr;
 for(NSString *key in @[@"sourceSelection",@"receiptSelection",@"expectedRequest",@"association"]){id value=h->selection[key];if(!value)return Error(env,"AUTH_IDENTITY_PRIVATE_BINDING_NOT_SUPPLIED");napi_value v=JSON(env,value);if(!v)return nullptr;napi_property_descriptor p={key.UTF8String,nullptr,nullptr,nullptr,nullptr,v,napi_default,nullptr};if(napi_define_properties(env,a[0],1,&p)!=napi_ok)return Error(env,"AUTH_IDENTITY_PRIVATE_CAPTURE_FAILED");}
 return a[0];}
static napi_value AdmissionPrivate(napi_env env,napi_callback_info info){napi_value a[2];if(!Args(env,info,2,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=Original(env,a[0],Kind::joint);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(h))return nullptr;NSDictionary *input=Dictionary(env,a[1]);if(!input||![@[@"beginYNX",@"handleReturn",@"restore",@"disconnect"] containsObject:input[@"operation"]])return Error(env,"AUTH_IDENTITY_OPERATION_MISMATCH");return Undefined(env);}
static napi_value TerminalPrivate(napi_env env,napi_callback_info info){napi_value a[5];size_t count=5;if(napi_get_cb_info(env,info,&count,a,nullptr,nullptr)!=napi_ok||count!=5)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");OriginalAuthHandle *h=Original(env,a[0],Kind::joint);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");if(!Current(h))return nullptr;
 // Do not bless a captured response or supplied result digest as commit proof.
 // Require the original authenticated Source to expose its separate terminal
 // readback. Matching native-purpose Source/Host terminal contract is NONE.
 return Error(env,"AUTH_IDENTITY_ORIGINAL_HOST_TERMINAL_CONTRACT_NOT_SUPPLIED");}
static napi_value Lifecycle(napi_env env,napi_callback_info info){void *p=nullptr;napi_value a[4];Operation op;size_t count=4;if(napi_get_cb_info(env,info,&count,a,nullptr,&p)!=napi_ok||count<1)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");op=(Operation)(uintptr_t)p;Kind kind=op<=adminClose?Kind::administration:Kind::joint;OriginalAuthHandle *h=Original(env,a[0],kind);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");
 if(op==adminRetire||op==jointRetire){h->retired=true;h->life.retire();if(kind==Kind::administration)[h->source retire];return Undefined(env);}
 if(op==adminClose||op==jointClose)return Close(h)?Undefined(env):Error(env,"AUTH_IDENTITY_CLEANUP_UNKNOWN");
 if(op==adminJoin||op==jointJoin){if(!h->retired)return Error(env,"AUTH_IDENTITY_NOT_RETIRED");return Undefined(env);}
 if(!Current(h))return nullptr;
 if(op==jointChild){if(count!=3||!h->view)return Error(env,"AUTH_IDENTITY_CHILD_NOT_SUPPLIED");napi_value view,executor;napi_get_reference_value(env,h->view,&view);napi_get_named_property(env,view,"executor",&executor);bool equal=false;napi_strict_equals(env,executor,a[1],&equal);if(!equal)return Error(env,"AUTH_IDENTITY_EXECUTOR_CHILD_MISMATCH");napi_valuetype kind;napi_typeof(env,a[2],&kind);if(kind!=napi_null&&!EnforcingChild(h,a[2]))return Error(env,"AUTH_IDENTITY_ENFORCING_CHILD_CHANGED");}
 if(op==jointSuccession){if(count!=2||![Dictionary(env,a[1]) isEqual:h->selection[@"expectedRequest"]])return Error(env,"AUTH_IDENTITY_SUCCESSION_MISMATCH");}
 return Undefined(env);
}
static napi_value Register(napi_env env,napi_value exports){
 struct Method {const char *name;napi_callback callback;void *data;};
 Method methods[]={{"acquireOriginalAdministrationProfile",Acquire,nullptr},{"readOriginalAdministrationProfile",ReadAdministration,nullptr},{"assertOriginalAdministrationProfileCurrent",Lifecycle,(void *)adminCurrent},{"retireOriginalAdministrationProfile",Lifecycle,(void *)adminRetire},{"joinOriginalAdministrationProfile",Lifecycle,(void *)adminJoin},{"closeOriginalAdministrationProfile",Lifecycle,(void *)adminClose},{"reserveOriginalJointRegistration",Reserve,nullptr},{"commitOriginalJointRegistration",Commit,nullptr},{"readOriginalJointRegistration",ReadJoint,nullptr},{"assertOriginalJointCurrent",Lifecycle,(void *)jointCurrent},{"assertOriginalJointExecutorChild",Lifecycle,(void *)jointChild},{"assertOriginalJointSuccession",Lifecycle,(void *)jointSuccession},{"retireOriginalJoint",Lifecycle,(void *)jointRetire},{"joinOriginalJoint",Lifecycle,(void *)jointJoin},{"closeOriginalJoint",Lifecycle,(void *)jointClose},
 {"captureOriginalNativePrivateServiceBorrow",CapturePrivate,nullptr},{"assertOriginalNativePrivateServiceCurrent",Lifecycle,(void *)jointCurrent},{"assertOriginalNativePrivateServiceAdmission",AdmissionPrivate,nullptr},{"assertOriginalNativePrivateServiceTerminal",TerminalPrivate,nullptr},{"retireOriginalNativePrivateService",Lifecycle,(void *)jointRetire},{"joinOriginalNativePrivateService",Lifecycle,(void *)jointJoin},{"closeOriginalNativePrivateService",Lifecycle,(void *)jointClose}};
 for(auto &m:methods){napi_property_descriptor descriptor={m.name,nullptr,m.callback,nullptr,nullptr,nullptr,napi_default,m.data};if(napi_define_properties(env,exports,1,&descriptor)!=napi_ok)return nullptr;}return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,Register)
