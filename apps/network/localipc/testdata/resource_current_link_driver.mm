// PUBLIC-only original Go/LINK interoperability broker. This is not linked
// into the App/helper or a Root installer. Only posix_spawn-owned child handles
// are signaled/waited. The original LINK caller binary remains unmodified.
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <spawn.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <unistd.h>
#include <chrono>
#include <string>
#include <vector>
#include <cstdio>
#include <cstdlib>
extern char **environ;
class OwnedChild { public:pid_t pid=-1;bool waited=false;int status=0;~OwnedChild(){if(pid<=0||waited)return;kill(pid,SIGTERM);auto until=std::chrono::steady_clock::now()+std::chrono::seconds(2);while(std::chrono::steady_clock::now()<until){if(waitpid(pid,&status,WNOHANG)==pid){waited=true;return;}usleep(10000);}kill(pid,SIGKILL);while(waitpid(pid,&status,0)<0&&errno==EINTR){}waited=true;}bool wait(unsigned seconds){auto until=std::chrono::steady_clock::now()+std::chrono::seconds(seconds);while(std::chrono::steady_clock::now()<until){pid_t got=waitpid(pid,&status,WNOHANG);if(got==pid){waited=true;return WIFEXITED(status)&&WEXITSTATUS(status)==0;}if(got<0)return false;usleep(10000);}return false;}};
struct OutputCapture {
  int fd=-1,error=0;size_t total=0,written=0;bool truncated=false;
  void append(const char *data,size_t count){
    total+=count;size_t keep=count;if(written+keep>(4U<<20)){keep=(4U<<20)-written;truncated=true;}
    size_t at=0;while(at<keep&&fd>=0&&!error){ssize_t n=write(fd,data+at,keep-at);if(n<0&&errno==EINTR)continue;if(n<=0){error=errno?errno:EIO;break;}at+=(size_t)n;}written+=keep;
  }
};
struct DrainResult {bool eof=false,waitObserved=false;int readError=0,waitError=0;};
static DrainResult drainAndWait(OwnedChild &child,int fd,unsigned seconds,OutputCapture &capture){
  DrainResult result;int flags=fcntl(fd,F_GETFL);if(flags<0||fcntl(fd,F_SETFL,flags|O_NONBLOCK)){result.readError=errno;return result;}
  const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(seconds);
  while(std::chrono::steady_clock::now()<deadline){
    if(!child.waited){pid_t got=waitpid(child.pid,&child.status,WNOHANG);if(got==child.pid)child.waited=true;else if(got<0&&errno!=EINTR){result.waitError=errno;break;}}
    result.waitObserved=child.waited;if(result.waitObserved&&result.eof)break;
    if(result.eof){usleep(10000);continue;}
    pollfd ready{fd,POLLIN,0};int n=poll(&ready,1,100);if(n<0){if(errno==EINTR)continue;result.readError=errno;break;}if(n==0)continue;
    if(ready.revents&(POLLIN|POLLHUP|POLLERR))for(;;){
      char buffer[4096];ssize_t count=read(fd,buffer,sizeof(buffer));
      if(count>0)capture.append(buffer,(size_t)count);
      else if(count==0){result.eof=true;break;}
      else if(errno==EINTR)continue;
      else if(errno==EAGAIN)break;
      else {result.readError=errno;break;}
      if(std::chrono::steady_clock::now()>=deadline)break;
    }
    if(result.readError)break;
  }
  result.waitObserved=child.waited;return result;
}
static bool exitedZero(const OwnedChild &child){return child.waited&&WIFEXITED(child.status)&&WEXITSTATUS(child.status)==0;}
static bool line(int fd,std::string &out,unsigned timeout){out.clear();auto end=std::chrono::steady_clock::now()+std::chrono::seconds(timeout);while(out.size()<16384&&std::chrono::steady_clock::now()<end){pollfd p{fd,POLLIN,0};int n=poll(&p,1,100);if(n<0&&errno==EINTR)continue;if(n<=0)continue;char c;if(read(fd,&c,1)!=1)return false;out+=c;if(c=='\n')return true;}return false;}
static bool send(int fd,const std::string &text){size_t at=0;while(at<text.size()){ssize_t n=write(fd,text.data()+at,text.size()-at);if(n<0&&errno==EINTR)continue;if(n<=0)return false;at+=(size_t)n;}return true;}
static bool hash(const char *path,std::string &result,size_t &bytes){FILE *file=fopen(path,"rb");if(!file)return false;CC_SHA256_CTX ctx;CC_SHA256_Init(&ctx);unsigned char buf[65536];bytes=0;size_t n;while((n=fread(buf,1,sizeof(buf),file))){bytes+=n;CC_SHA256_Update(&ctx,buf,(CC_LONG)n);}bool ok=!ferror(file);fclose(file);unsigned char digest[32];CC_SHA256_Final(digest,&ctx);char hex[65];for(unsigned i=0;i<32;i++)snprintf(hex+2*i,3,"%02x",digest[i]);result=hex;return ok;}
static std::string identity(const char *kind,char pad,size_t count,bool large){return large?std::string(kind)+std::string(count,pad):(std::string(kind)=="PUBLIC-source-"?"PUBLIC-original":std::string(kind)=="PUBLIC-instance-"?"PUBLIC-own-instance":"PUBLIC-own-resource");}
static int brokerMain(int argc,char **argv){@autoreleasepool{
  if(argc!=7)return 2;const bool large=strcmp(argv[5],"chunked")==0;if(!large&&strcmp(argv[5],"normal"))return 2;
  std::string goHash;size_t goBytes=0;if(!hash(argv[1],goHash,goBytes)||goHash!=argv[6])return 3;
  int input[2],output[2];if(pipe(input)||pipe(output))return 4;OwnedChild go,link;
  posix_spawn_file_actions_t action;posix_spawn_file_actions_init(&action);posix_spawn_file_actions_adddup2(&action,input[0],STDIN_FILENO);posix_spawn_file_actions_adddup2(&action,output[1],STDOUT_FILENO);posix_spawn_file_actions_adddup2(&action,output[1],STDERR_FILENO);posix_spawn_file_actions_addclose(&action,input[1]);posix_spawn_file_actions_addclose(&action,output[0]);
  std::vector<std::string> environment;for(char **at=environ;*at;++at)environment.emplace_back(*at);environment.emplace_back("YNX_PUBLIC_CURRENT_LINK_SERVER=1");environment.emplace_back(std::string("YNX_PUBLIC_CURRENT_LINK_ROOT=")+argv[3]);environment.emplace_back(std::string("YNX_PUBLIC_CURRENT_LINK_MODE=")+argv[5]);std::vector<char*> env;for(auto &v:environment)env.push_back(v.data());env.push_back(nullptr);
  char *goArgs[]={argv[1],const_cast<char*>("-test.run=^TestP09ResourceCurrentLINKFixtureServer$"),nullptr};int code=posix_spawn(&go.pid,argv[1],&action,nullptr,goArgs,env.data());posix_spawn_file_actions_destroy(&action);close(input[0]);close(output[1]);if(code)return 5;
  const std::string root=argv[3],outputRoot=argv[4],socket=root+"/ipc/network-helper.sock",pid=std::to_string(go.pid),size=std::to_string(goBytes),source=identity("PUBLIC-source-",'s',242,large),instance=identity("PUBLIC-instance-",'i',240,large),resource=identity("PUBLIC-resource-",'r',240,large);
  std::vector<std::string> args{argv[2],socket,pid,argv[1],size,goHash,source,instance,resource,argv[5],outputRoot};std::vector<char*> linkArgs;for(auto &v:args)linkArgs.push_back(v.data());linkArgs.push_back(nullptr);
  std::string logPath=outputRoot+"/link.stdout";int log=open(logPath.c_str(),O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(log<0)return 6;
  posix_spawnattr_t attr;posix_spawnattr_init(&attr);posix_spawnattr_setflags(&attr,POSIX_SPAWN_START_SUSPENDED);posix_spawn_file_actions_init(&action);posix_spawn_file_actions_adddup2(&action,log,STDOUT_FILENO);posix_spawn_file_actions_adddup2(&action,log,STDERR_FILENO);
  code=posix_spawn(&link.pid,argv[2],&action,&attr,linkArgs.data(),environ);posix_spawn_file_actions_destroy(&action);posix_spawnattr_destroy(&attr);close(log);if(code)return 7;
  // The original process handle supplies PID. The Go owner independently
  // observes this already-mapped suspended image before immutable server Start.
  if(!send(input[1],std::to_string(link.pid)+"\n"))return 8;std::string text;if(!line(output[0],text,12)||text!="GO_CURRENT_READY\n"){fprintf(stderr,"Go readiness: %s",text.c_str());return 9;}
  if(kill(link.pid,SIGCONT))return 10;bool linkOK=link.wait(25);
  if(!send(input[1],"stop\n"))return 11;close(input[1]);
  std::string goLogPath=outputRoot+"/go.stdout";OutputCapture capture;capture.fd=open(goLogPath.c_str(),O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(capture.fd<0)return 11;
  bool drained=false;for(unsigned i=0;i<8&&line(output[0],text,10);i++){capture.append(text.data(),text.size());if(text=="GO_CURRENT_DRAINED_SAME_READER_COUNTERS_UNCHANGED_NO_ROOT\n"){drained=true;break;}}
  // DRAINED proves the reader's lifecycle only. Go's testing main can still
  // write PASS/diagnostics before process exit. Keep its pipe open and drain
  // concurrently with the original10s Wait; EOF is not a substitute for Wait.
  DrainResult drain=drainAndWait(go,output[0],10,capture);close(output[0]);close(capture.fd);bool goOK=exitedZero(go);
  printf("{\"PUBLIC\":true,\"goPIDFromActualSpawn\":%d,\"nativePIDFromActualSuspendedSpawn\":%d,\"sameSourceGo\":true,\"linkExit0\":%s,\"goReaderActuallyDrained\":%s,\"goOwnerWaitExit0\":%s,\"goWaitObserved\":%s,\"goRawWaitStatus\":%d,\"goExitCode\":%d,\"goTermSignal\":%d,\"goOutputEOF\":%s,\"goOutputBytesAfterReady\":%zu,\"goOutputTruncated\":%s,\"goReadErrno\":%d,\"goWaitErrno\":%d,\"goCaptureErrno\":%d,\"RootAdmission\":false,\"SourceAdmission\":false,\"actualAuthFence\":false}\n",go.pid,link.pid,linkOK?"true":"false",drained?"true":"false",goOK?"true":"false",drain.waitObserved?"true":"false",go.waited?go.status:-1,go.waited&&WIFEXITED(go.status)?WEXITSTATUS(go.status):-1,go.waited&&WIFSIGNALED(go.status)?WTERMSIG(go.status):0,drain.eof?"true":"false",capture.total,capture.truncated?"true":"false",drain.readError,drain.waitError,capture.error);
  return linkOK&&drained&&goOK&&drain.eof&&!drain.readError&&!drain.waitError&&!capture.error?0:12;
}}
#ifdef YNX_RESOURCE_CURRENT_DRIVER_DRAIN_TEST
static bool drainControl(int kind){
  int pipefd[2];if(pipe(pipefd))return false;OwnedChild child;child.pid=fork();if(child.pid<0)return false;
  if(child.pid==0){close(pipefd[0]);const char *marker="GO_CURRENT_DRAINED_SAME_READER_COUNTERS_UNCHANGED_NO_ROOT\n";if(write(pipefd[1],marker,strlen(marker))!=(ssize_t)strlen(marker))_exit(20);
    if(kind==2){raise(SIGTERM);_exit(21);}if(kind==3){close(pipefd[1]);usleep(150000);_exit(0);}
    char bytes[4096];memset(bytes,'P',sizeof(bytes));for(int i=0;i<40;i++){size_t at=0;while(at<sizeof(bytes)){ssize_t n=write(pipefd[1],bytes+at,sizeof(bytes)-at);if(n<0&&errno==EINTR)continue;if(n<=0)_exit(22);at+=(size_t)n;}}
    const char *pass="\nPASS\n";if(write(pipefd[1],pass,strlen(pass))!=(ssize_t)strlen(pass))_exit(23);close(pipefd[1]);_exit(kind==1?7:0);
  }
  close(pipefd[1]);std::string marker;if(!line(pipefd[0],marker,10)||marker!="GO_CURRENT_DRAINED_SAME_READER_COUNTERS_UNCHANGED_NO_ROOT\n"){close(pipefd[0]);return false;}
  OutputCapture capture;auto start=std::chrono::steady_clock::now();DrainResult result=drainAndWait(child,pipefd[0],10,capture);close(pipefd[0]);bool ok=result.eof&&result.waitObserved&&!result.readError&&!result.waitError;
  if(kind==2)ok=ok&&WIFSIGNALED(child.status)&&WTERMSIG(child.status)==SIGTERM;
  else if(kind==3)ok=ok&&exitedZero(child)&&std::chrono::steady_clock::now()-start>=std::chrono::milliseconds(100);
  else ok=ok&&WIFEXITED(child.status)&&WEXITSTATUS(child.status)==(kind==1?7:0)&&capture.total==40*sizeof(char[4096])+6;
  printf("{\"control\":%d,\"passed\":%s,\"rawWaitStatus\":%d,\"exitCode\":%d,\"termSignal\":%d,\"EOF\":%s,\"tailBytes\":%zu}\n",kind,ok?"true":"false",child.status,WIFEXITED(child.status)?WEXITSTATUS(child.status):-1,WIFSIGNALED(child.status)?WTERMSIG(child.status):0,result.eof?"true":"false",capture.total);return ok;
}
int main(int argc,char **argv){if(argc==7)return brokerMain(argc,argv);if(argc!=1)return 2;for(int kind=0;kind<4;kind++)if(!drainControl(kind))return 1;return 0;}
#else
int main(int argc,char **argv){return brokerMain(argc,argv);}
#endif
