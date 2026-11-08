#include "DeviceV4SourceBackendPrivate.hpp"
#include "DeviceV4LinuxReviewedPrivate.hpp"
#include "MobileCanonicalDATA.hpp"
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <poll.h>
#include <unistd.h>
#include <signal.h>
#include <spawn.h>
#include <cerrno>
#include <cstring>
#include <algorithm>
#include <array>
#include <climits>
#include <pthread.h>
#include <thread>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/evp.h>
#endif
namespace ynx::auth::devicev4 {
namespace d=ynx::auth::mobile::qualified::data;
namespace linux_detail {
Failure error(int32_t code){return localFailure(code);}
bool sameStat(const struct stat&a,const struct stat&b){bool v=a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size;
#ifdef __APPLE__
 return v&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
#else
 return v&&a.st_mtim.tv_sec==b.st_mtim.tv_sec&&a.st_mtim.tv_nsec==b.st_mtim.tv_nsec&&a.st_ctim.tv_sec==b.st_ctim.tv_sec&&a.st_ctim.tv_nsec==b.st_ctim.tv_nsec;
#endif
}
bool sameDir(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode;}
std::vector<std::string>parts(const std::string&s){if(s.size()<2||s[0]!='/'||s.size()>4096||s.back()=='/'||s.find('\\')!=std::string::npos||s.find('\0')!=std::string::npos)throw error(Arguments);std::vector<std::string>v;size_t at=1;while(at<s.size()){size_t n=s.find('/',at);auto p=s.substr(at,n==std::string::npos?s.size()-at:n-at);if(p.empty()||p=="."||p==".."||std::any_of(p.begin(),p.end(),[](unsigned char c){return c<32||c==127;}))throw error(Arguments);v.push_back(p);if(n==std::string::npos)break;at=n+1;}return v;}
std::string hash(const Bytes&b){std::array<uint8_t,32>out{};
#ifdef __APPLE__
 CC_SHA256(b.data(),CC_LONG(b.size()),out.data());
#else
 unsigned count=0;if(EVP_Digest(b.data(),b.size(),out.data(),&count,EVP_sha256(),nullptr)!=1||count!=32)throw error(Unavailable);
#endif
 static const char hex[]="0123456789abcdef";std::string s;for(auto c:out){s+=hex[c>>4];s+=hex[c&15];}return s;
}
struct FD{int n=-1;struct stat identity{};bool selected=false,closed=false;bool close(){if(n<0){closed=true;return true;}if(selected)return closed;selected=true;if(::close(n))return false;n=-1;closed=true;return true;}};
struct File{linux_release::Pin pin;uint32_t uid=0;std::vector<FD>dirs;FD file;Bytes raw;bool captured=false,keepRaw=true;
 std::string digest(){std::array<uint8_t,32>out{};std::array<uint8_t,65536>buffer{};
#ifdef __APPLE__
  CC_SHA256_CTX ctx{};CC_SHA256_Init(&ctx);
#else
  std::unique_ptr<EVP_MD_CTX,decltype(&EVP_MD_CTX_free)>ctx(EVP_MD_CTX_new(),EVP_MD_CTX_free);if(!ctx||EVP_DigestInit_ex(ctx.get(),EVP_sha256(),nullptr)!=1)throw error(Unavailable);
#endif
  uint64_t at=0;while(at<pin.bytes){auto n=pread(file.n,buffer.data(),size_t(std::min<uint64_t>(buffer.size(),pin.bytes-at)),off_t(at));if(n<0&&errno==EINTR)continue;if(n<=0)throw error(Changed);
#ifdef __APPLE__
  CC_SHA256_Update(&ctx,buffer.data(),CC_LONG(n));
#else
  if(EVP_DigestUpdate(ctx.get(),buffer.data(),size_t(n))!=1)throw error(Unavailable);
#endif
  at+=uint64_t(n);}uint8_t extra;if(pread(file.n,&extra,1,off_t(at))!=0)throw error(Changed);
#ifdef __APPLE__
  CC_SHA256_Final(out.data(),&ctx);
#else
  unsigned count=0;if(EVP_DigestFinal_ex(ctx.get(),out.data(),&count)!=1||count!=32)throw error(Unavailable);
#endif
  static const char hex[]="0123456789abcdef";std::string s;for(auto c:out){s+=hex[c>>4];s+=hex[c&15];}return s;
 }
 void open(const linux_release::Pin&p,uint32_t role,uint64_t cap,bool executable=false,bool retainRaw=true){pin=p;uid=role;keepRaw=retainRaw;auto path=parts(p.path);if(!d::hex(p.sha256)||!p.bytes||p.bytes>cap)throw error(Arguments);dirs.emplace_back();dirs.back().n=::open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(dirs.back().n<0||fstat(dirs.back().n,&dirs.back().identity))throw error(Unavailable);
  for(size_t i=0;i+1<path.size();++i){int parent=dirs.back().n;dirs.emplace_back();auto&f=dirs.back();f.n=openat(parent,path[i].c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(f.n<0||fstat(f.n,&f.identity)||!S_ISDIR(f.identity.st_mode)||(f.identity.st_mode&0022)||(f.identity.st_uid!=0&&f.identity.st_uid!=role))throw error(Changed);}
  file.n=openat(dirs.back().n,path.back().c_str(),O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(file.n<0||fstat(file.n,&file.identity))throw error(Unavailable);auto&s=file.identity;if(!S_ISREG(s.st_mode)||(s.st_uid!=0&&s.st_uid!=role)||(s.st_mode&0022)||s.st_nlink!=1||s.st_size<0||uint64_t(s.st_size)!=p.bytes||(executable&&!(s.st_mode&0111)))throw error(Changed);if(keepRaw)raw=read();if(digest()!=p.sha256)throw error(Changed);captured=true;current();
 }
 Bytes read(){Bytes b(size_t(pin.bytes));size_t at=0;while(at<b.size()){auto n=pread(file.n,b.data()+at,b.size()-at,off_t(at));if(n<0&&errno==EINTR)continue;if(n<=0)throw error(Changed);at+=size_t(n);}uint8_t extra;if(pread(file.n,&extra,1,off_t(at))!=0)throw error(Changed);return b;}
 void current(){if(file.n<0||dirs.empty())throw error(Closed);auto path=parts(pin.path);struct stat a{},b{};for(size_t i=0;i<dirs.size();++i){if(fstat(dirs[i].n,&a)||!sameDir(a,dirs[i].identity))throw error(Changed);if(i&& (fstatat(dirs[i-1].n,path[i-1].c_str(),&b,AT_SYMLINK_NOFOLLOW)||!sameDir(a,b)))throw error(Changed);}if(fstat(file.n,&a)||!sameStat(a,file.identity)||fstatat(dirs.back().n,path.back().c_str(),&b,AT_SYMLINK_NOFOLLOW)||!sameStat(a,b))throw error(Changed);if(captured&&(digest()!=pin.sha256||(keepRaw&&read()!=raw)))throw error(Changed);if(fstat(file.n,&a)||!sameStat(a,file.identity)||fstatat(dirs.back().n,path.back().c_str(),&b,AT_SYMLINK_NOFOLLOW)||!sameStat(a,b))throw error(Changed);}
 bool close(){if(!file.close())return false;for(auto i=dirs.rbegin();i!=dirs.rend();++i)if(!i->close())return false;raw.clear();return true;}
};
d::Value text(const std::string&s){d::Value v;v.type=d::Value::string;v.s=s;return v;}
d::Value number(uint64_t n){d::Value v;v.type=d::Value::integer;v.n=n;return v;}
d::Value object(){d::Value v;v.type=d::Value::object;return v;}
d::Value parse(const Bytes&b,size_t cap=393216){return d::parseCanonical(b,cap);}
Bytes bytes(const std::string&s){return Bytes(s.begin(),s.end());}
}
struct Backend::Impl{
 linux_release::Row row;std::vector<std::unique_ptr<linux_detail::File>>files;Failure first{};std::thread::id actor=std::this_thread::get_id();
 linux_detail::File *own=nullptr,*node=nullptr,*verifier=nullptr,*root=nullptr,*enrollment=nullptr,*profile=nullptr,*head=nullptr,*registration=nullptr,*session=nullptr;
 Snapshot original;d::Value previous;uint64_t wallFloor=0,deadline=0;bool initialized=false,retired=false,closed=false,closeSelected=false;Drain closeResult{};
 pid_t child=-1;bool childUnknown=false,killSelected=false;linux_detail::FD childInput,childOutput,spawnRead,spawnWrite;
 Failure fail(Failure f){retired=true;if(!first.present)first=f;return first;}
 linux_detail::File*hold(const linux_release::Pin&p,uint64_t cap,bool executable=false,bool raw=true){files.push_back(std::make_unique<linux_detail::File>());auto*f=files.back().get();f->open(p,row.roleUID,cap,executable,raw);return f;}
 void physicalCurrent(){for(auto&f:files)f->current();
#ifdef __linux__
 struct stat mapped{};if(::stat("/proc/self/exe",&mapped)||mapped.st_dev!=own->file.identity.st_dev||mapped.st_ino!=own->file.identity.st_ino)throw localFailure(Changed);
#else
 #ifndef YNX_DEVICE_V4_LINUX_PUBLIC_ROWS_INCLUDE
 throw localFailure(NotSupplied);
 #endif
#endif
 }
 void clock(){auto now=wallNow();if(now<wallFloor)throw localFailure(ClockRollback);if(initialized&&(monoNow()>=deadline||now>=uint64_t(original.expires)))throw localFailure(Expired);wallFloor=now;}
 // SAME existing bounded Source-v2 stdin process, no new service/driver/provider.
 Bytes run(const Bytes&input){if(child>=0||childUnknown||childInput.n>=0||childOutput.n>=0||spawnRead.n>=0||spawnWrite.n>=0)throw localFailure(Pending);int in[2]={-1,-1},out[2]={-1,-1};if(pipe(in))throw localFailure(Unavailable);spawnRead={};childInput={};spawnRead.n=in[0];childInput.n=in[1];if(pipe(out)){(void)drainChild(false);throw localFailure(Unavailable);}childOutput={};spawnWrite={};childOutput.n=out[0];spawnWrite.n=out[1];posix_spawn_file_actions_t actions;int actionCode=posix_spawn_file_actions_init(&actions);if(actionCode){(void)drainChild(false);throw localFailure(Unavailable);}actionCode=posix_spawn_file_actions_adddup2(&actions,in[0],STDIN_FILENO);if(!actionCode)actionCode=posix_spawn_file_actions_adddup2(&actions,out[1],STDOUT_FILENO);if(!actionCode)actionCode=posix_spawn_file_actions_addopen(&actions,STDERR_FILENO,"/dev/null",O_WRONLY,0);for(auto n:{in[0],in[1],out[0],out[1]})if(!actionCode)actionCode=posix_spawn_file_actions_addclose(&actions,n);if(actionCode){posix_spawn_file_actions_destroy(&actions);(void)drainChild(false);throw localFailure(Unavailable);}
  char*argv[]={const_cast<char*>(row.node.path.c_str()),const_cast<char*>(row.verifier.path.c_str()),nullptr};char envPath[]="PATH=/usr/bin:/bin",envLocale[]="LANG=C";char*env[]={envPath,envLocale,nullptr};int code=posix_spawn(&child,row.node.path.c_str(),&actions,nullptr,argv,env);posix_spawn_file_actions_destroy(&actions);if(code){child=-1;(void)drainChild(false);throw localFailure(Unavailable);}killSelected=false;bool one=spawnRead.close(),two=spawnWrite.close();if(!one||!two){(void)drainChild(true);throw localFailure(Unavailable);}if(fcntl(in[1],F_SETFL,O_NONBLOCK)||fcntl(out[0],F_SETFL,O_NONBLOCK)){(void)drainChild(true);throw localFailure(Unavailable);}
  // Blocking SIGPIPE is scoped to this actor. Never mutate process-wide signal
  // handlers in a Go/Native combined host. Consume only our newly pending bit.
  struct SignalBlock{sigset_t one{},old{};bool pending=false,active=false;SignalBlock(){sigemptyset(&one);sigaddset(&one,SIGPIPE);sigset_t p{};sigpending(&p);pending=sigismember(&p,SIGPIPE);active=!pthread_sigmask(SIG_BLOCK,&one,&old);}~SignalBlock(){if(!active)return;sigset_t p{};sigpending(&p);if(!pending&&!sigismember(&old,SIGPIPE)&&sigismember(&p,SIGPIPE)){int signal=0;sigwait(&one,&signal);}pthread_sigmask(SIG_SETMASK,&old,nullptr);}} signals;if(!signals.active){(void)drainChild(true);throw localFailure(Unavailable);}
  try{
  Bytes result;size_t sent=0;bool inputOpen=true,outputOpen=true;const auto end=std::min(deadline?deadline:UINT64_MAX,monoNow()+row.timeoutMS);bool failed=false;
  while(inputOpen||outputOpen){auto now=monoNow();if(now>=end){failed=true;break;}pollfd p[2]={{inputOpen?in[1]:-1,POLLOUT,0},{outputOpen?out[0]:-1,POLLIN,0}};int n=poll(p,2,int(std::min<uint64_t>(50,end-now)));if(n<0&&errno==EINTR)continue;if(n<0){failed=true;break;}if(inputOpen&&(p[0].revents&(POLLOUT|POLLERR|POLLHUP))){auto wrote=::write(in[1],input.data()+sent,input.size()-sent);if(wrote>0)sent+=size_t(wrote);else if(wrote<0&&errno!=EAGAIN&&errno!=EINTR){failed=true;break;}if(sent==input.size()){if(!childInput.close()){failed=true;break;}inputOpen=false;}}if(outputOpen&&(p[1].revents&(POLLIN|POLLHUP|POLLERR))){uint8_t b[8192];auto got=::read(out[0],b,sizeof(b));if(got>0){if(result.size()+size_t(got)>1048576){failed=true;break;}result.insert(result.end(),b,b+got);}else if(got==0){if(!childOutput.close()){failed=true;break;}outputOpen=false;}else if(errno!=EAGAIN&&errno!=EINTR){failed=true;break;}}}
  int status=0;if(failed){(void)drainChild(true);throw localFailure(Unavailable);}for(;;){auto n=waitpid(child,&status,WNOHANG);if(n==child){child=-1;break;}if(n<0&&errno==EINTR)continue;if(n<0){childUnknown=true;throw localFailure(Unavailable);}if(monoNow()>=end){(void)drainChild(true);failed=true;break;}poll(nullptr,0,1);}
  if(failed||!WIFEXITED(status)||WEXITSTATUS(status)!=0||sent!=input.size())throw localFailure(Unavailable);if(result.empty()||result.back()!='\n')throw localFailure(Changed);result.pop_back();return result;
  }catch(...){(void)drainChild(true);throw;}
 }
 bool drainChild(bool cancel)noexcept{bool one=childInput.close(),two=childOutput.close(),three=spawnRead.close(),four=spawnWrite.close(),done=one&&two&&three&&four;if(child>0){if(cancel&&!killSelected){killSelected=true;if(::kill(child,SIGKILL)&&errno!=ESRCH)childUnknown=true;}int status=0;auto got=waitpid(child,&status,WNOHANG);if(got==child){child=-1;childUnknown=false;}else if(got<0&&errno!=EINTR)childUnknown=true;}return done&&child<0&&!childUnknown;}
 Snapshot refresh(){using namespace linux_detail;physicalCurrent();clock();auto policy=parse(bytes(row.policyOriginal),16384);policy.keys({"rootDigest","enrollmentDigest","endpoint","spki","signatureContract","applicationId","productId","platform"});if(policy.at("platform").text()!="linux"||policy.at("signatureContract").at("purpose").text()!="product-session-device-source-v4"||policy.at("rootDigest").text()!=hash(root->raw)||policy.at("enrollmentDigest").text()!=hash(enrollment->raw))throw localFailure(Changed);
  auto input=object();input.o={{"operation",text("auth-source-v2-native-node/v1")},{"node",parse(bytes(row.nativeNodeOriginal),16384)},{"rootRaw",text(std::string(root->raw.begin(),root->raw.end()))},{"enrollmentRaw",text(std::string(enrollment->raw.begin(),enrollment->raw.end()))},{"profileRaw",text(std::string(profile->raw.begin(),profile->raw.end()))},{"headRaw",text(std::string(head->raw.begin(),head->raw.end()))},{"policy",policy},{"previous",previous}};
  auto encoded=bytes(d::canonical(input));if(encoded.size()>2097152)throw localFailure(Capacity);auto raw=run(encoded);physicalCurrent();clock();auto result=parse(raw,1048576);result.keys({"projection","currentRaw"});const auto&p=result.at("projection");if(p.at("dataOnly").type!=d::Value::boolean||!p.at("dataOnly").b||p.at("nativeAdmission").type!=d::Value::boolean||p.at("nativeAdmission").b||p.at("status").text()!="active")throw localFailure(Changed);
  const auto&scope=p.at("selection").at("productSessionDeviceV4");scope.keys({"version","expected","context","registrationOriginal","sessionOriginal"});if(scope.at("version").text()!="4"||scope.at("registrationOriginal").text()!=std::string(registration->raw.begin(),registration->raw.end())||scope.at("sessionOriginal").text()!=std::string(session->raw.begin(),session->raw.end()))throw localFailure(Changed);
  Snapshot s;static const char*keys[]={"networkId","canonicalOwner","account","sessionBinding","productId","clientId","platform","applicationId","bundleId","packageId","origin","callback","deviceId","generation","registrationId","revision","registrationDigest"};const auto&e=scope.at("expected");if(e.o.size()!=17)throw localFailure(Changed);for(unsigned i=0;i<17;++i){const auto&v=e.at(keys[i]);if(v.type==d::Value::nullValue&&(i==8||i==9))s.nullMask|=1u<<i;else{const auto&t=v.text();if(t.empty()||t.size()>2048)throw localFailure(Changed);s.expected[i]=bytes(t);}}if(std::string(s.expected[6].begin(),s.expected[6].end())!="linux")throw localFailure(Changed);
  const auto&context=scope.at("context");context.keys({"version","algorithm","securityLevel","networkId","account","deviceId","generation","registrationId","revision","registrationDigest","scopes","purpose"});s.context=bytes(d::canonical(context));s.registration=registration->raw;s.session=session->raw;auto now=wallNow(),expiry=p.at("expiresAtMs").number();if(now>uint64_t(INT64_MAX)-5000||expiry>uint64_t(INT64_MAX))throw localFailure(Expired);s.issued=int64_t(now);s.expires=int64_t(std::min(expiry,now+5000));if(s.expires<=s.issued)throw localFailure(Expired);
  auto ns=p.o.find("productDeviceAccountNamespaceDATA");if(ns!=p.o.end()){const auto&n=ns->second;n.keys({"purpose","sourceId","instanceId","generation","accountIssuer","accountSubject"});auto&v=s.accountNamespace;if(n.at("purpose").text()!="product-session-device-source-v4"||n.at("sourceId").text()!=p.at("sourceId").text()||n.at("instanceId").text()!=p.at("instanceId").text()||n.at("generation").number()!=p.at("generation").number())throw localFailure(Changed);v.issuer=bytes(n.at("accountIssuer").text());v.subject=bytes(n.at("accountSubject").text());v.sourceId=bytes(n.at("sourceId").text());v.instanceId=bytes(n.at("instanceId").text());v.generation=n.at("generation").number();v.present=true;if(v.issuer.empty()||v.issuer.size()>2048||v.subject!=s.expected[2]||v.sourceId.empty()||v.sourceId.size()>512||v.instanceId.empty()||v.instanceId.size()>512||!v.generation)throw localFailure(Changed);}
  auto next=object();next.o={{"sequence",p.at("sequence")},{"floor",p.at("floor")},{"head",p.at("head")},{"timeFloor",p.at("timeFloor")},{"executionHeight",p.at("executionHeight")}};previous=std::move(next);clock();return s;
 }
};
Backend::Backend():p_(new Impl){}
Backend::~Backend(){if(!p_->closed)abort();}
struct BackendFactory{static BackendAcquisition open()noexcept{BackendAcquisition a;try{auto rows=linux_release::originalReviewedDeviceV4LinuxRows();if(rows.empty())return{nullptr,localFailure(NotSupplied)};if(rows.size()!=1)return{nullptr,localFailure(Changed)};a.owner=std::shared_ptr<Backend>(new Backend);auto&p=*a.owner->p_;p.row=std::move(rows[0]);if(p.row.roleUID!=geteuid()||p.row.resourceRef.empty()||p.row.timeoutMS<1||p.row.timeoutMS>5000||p.row.wholeRuntime.empty()||p.row.wholeRuntime.size()>2048)throw localFailure(Changed);p.own=p.hold(p.row.ownImage,536870912,true,false);p.node=p.hold(p.row.node,536870912,true,false);p.verifier=p.hold(p.row.verifier,1048576,false,false);uint64_t total=0;for(const auto&pin:p.row.wholeRuntime){if(pin.bytes>1073741824-total)throw localFailure(Capacity);total+=pin.bytes;p.hold(pin,16777216,false,false);}p.root=p.hold(p.row.root,16384);p.enrollment=p.hold(p.row.enrollment,393216);p.profile=p.hold(p.row.profile,393216);p.head=p.hold(p.row.head,393216);p.registration=p.hold(p.row.registration,16384);p.session=p.hold(p.row.session,16384);using namespace linux_detail;p.previous=object();p.previous.o={{"sequence",number(0)},{"floor",number(0)},{"head",text("")},{"timeFloor",number(0)},{"executionHeight",text("0")}};p.original=p.refresh();auto now=wallNow(),mono=monoNow();if(now>=uint64_t(p.original.expires)||uint64_t(p.original.expires)-now>UINT64_MAX-mono)throw localFailure(Expired);p.deadline=mono+uint64_t(p.original.expires)-now;p.wallFloor=now;p.initialized=true;p.clock();}catch(Failure f){a.failure=a.owner?a.owner->p_->fail(f):f;}catch(...){a.failure=a.owner?a.owner->p_->fail(localFailure(Exception)):localFailure(Exception);}return a;}};
BackendAcquisition acquireOriginalBackend()noexcept{return BackendFactory::open();}
Failure Backend::current()noexcept{if(p_->actor!=std::this_thread::get_id())return localFailure(WrongActor);try{if(p_->first.present)return p_->first;if(p_->retired||p_->closed)return localFailure(Retired);auto fresh=p_->refresh();if(fresh.expected!=p_->original.expected||fresh.nullMask!=p_->original.nullMask||fresh.context!=p_->original.context||fresh.registration!=p_->original.registration||fresh.session!=p_->original.session||!(fresh.accountNamespace==p_->original.accountNamespace))return p_->fail(localFailure(Changed));p_->clock();return{};}catch(Failure f){return p_->fail(f);}catch(...){return p_->fail(localFailure(Exception));}}
Failure Backend::snapshot(Snapshot&out)noexcept{auto f=current();if(f.present)return f;try{auto copy=p_->original;p_->physicalCurrent();p_->clock();out=std::move(copy);return{};}catch(Failure e){return p_->fail(e);}catch(...){return p_->fail(localFailure(Exception));}}
Drain Backend::join()noexcept{if(p_->actor!=std::this_thread::get_id())return{localFailure(WrongActor),0,0};p_->retired=true;bool done=p_->drainChild(true);return{p_->first,uint32_t(!done),uint32_t(done)};}
Drain Backend::close()noexcept{if(p_->actor!=std::this_thread::get_id())return{localFailure(WrongActor),0,0};p_->retired=true;if(p_->closeSelected)return p_->closeResult;auto j=join();if(!j.physical_done)return j;p_->closeSelected=true;bool done=true;for(auto i=p_->files.rbegin();i!=p_->files.rend();++i)if(!(*i)->close())done=false;p_->closed=done;if(!done&&!p_->first.present)p_->first=localFailure(Unavailable);p_->closeResult={p_->first,uint32_t(!done),uint32_t(done)};return p_->closeResult;}
}
