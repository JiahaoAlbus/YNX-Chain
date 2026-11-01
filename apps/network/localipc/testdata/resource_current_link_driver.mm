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
static bool line(int fd,std::string &out,unsigned timeout){out.clear();auto end=std::chrono::steady_clock::now()+std::chrono::seconds(timeout);while(out.size()<16384&&std::chrono::steady_clock::now()<end){pollfd p{fd,POLLIN,0};int n=poll(&p,1,100);if(n<0&&errno==EINTR)continue;if(n<=0)continue;char c;if(read(fd,&c,1)!=1)return false;out+=c;if(c=='\n')return true;}return false;}
static bool send(int fd,const std::string &text){size_t at=0;while(at<text.size()){ssize_t n=write(fd,text.data()+at,text.size()-at);if(n<0&&errno==EINTR)continue;if(n<=0)return false;at+=(size_t)n;}return true;}
static bool hash(const char *path,std::string &result,size_t &bytes){FILE *file=fopen(path,"rb");if(!file)return false;CC_SHA256_CTX ctx;CC_SHA256_Init(&ctx);unsigned char buf[65536];bytes=0;size_t n;while((n=fread(buf,1,sizeof(buf),file))){bytes+=n;CC_SHA256_Update(&ctx,buf,(CC_LONG)n);}bool ok=!ferror(file);fclose(file);unsigned char digest[32];CC_SHA256_Final(digest,&ctx);char hex[65];for(unsigned i=0;i<32;i++)snprintf(hex+2*i,3,"%02x",digest[i]);result=hex;return ok;}
static std::string identity(const char *kind,char pad,size_t count,bool large){return large?std::string(kind)+std::string(count,pad):(std::string(kind)=="PUBLIC-source-"?"PUBLIC-original":std::string(kind)=="PUBLIC-instance-"?"PUBLIC-own-instance":"PUBLIC-own-resource");}
int main(int argc,char **argv){@autoreleasepool{
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
  if(!send(input[1],"stop\n"))return 11;close(input[1]);bool drained=false;for(unsigned i=0;i<8&&line(output[0],text,10);i++){if(text=="GO_CURRENT_DRAINED_SAME_READER_COUNTERS_UNCHANGED_NO_ROOT\n"){drained=true;break;}}close(output[0]);bool goOK=go.wait(10);
  printf("{\"PUBLIC\":true,\"goPIDFromActualSpawn\":%d,\"nativePIDFromActualSuspendedSpawn\":%d,\"sameSourceGo\":true,\"linkExit0\":%s,\"goReaderActuallyDrained\":%s,\"goOwnerWaitExit0\":%s,\"RootAdmission\":false,\"SourceAdmission\":false,\"actualAuthFence\":false}\n",go.pid,link.pid,linkOK?"true":"false",drained?"true":"false",goOK?"true":"false");return linkOK&&drained&&goOK?0:12;
}}
