// PUBLIC/CONTROLLED interoperability fixture. Production LINK's native-only
// registration/fence/NAPI owns its actual client; these argv are NOT an install
// or permission API and this fixture cannot sign/register/dispatch anything.
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <fstream>
#include <string>
#include <cstdio>
#include <cstdlib>
#include "../resource_current_protocol.h"
class HeldSocket { public:int fd=-1;~HeldSocket(){if(fd>=0)close(fd);} };
static bool actualProcess(int pid,const char *expectedStart,const char *expectedPath,const char *expectedHash){
  proc_bsdinfo info{};char path[4096]{};if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))!=sizeof(info)||info.pbi_pid!=(unsigned)pid||info.pbi_uid!=geteuid()||proc_pidpath(pid,path,sizeof(path))<=0)return false;
  char start[128];snprintf(start,sizeof(start),"darwin:%llu:%llu",info.pbi_start_tvsec,info.pbi_start_tvusec);
  if(strcmp(start,expectedStart)||strcmp(path,expectedPath))return false;
  FILE *file=fopen(path,"rb");if(!file)return false;CC_SHA256_CTX sha;CC_SHA256_Init(&sha);unsigned char bytes[65536];size_t n;while((n=fread(bytes,1,sizeof(bytes),file)))CC_SHA256_Update(&sha,bytes,(CC_LONG)n);bool ok=!ferror(file);fclose(file);unsigned char digest[32];CC_SHA256_Final(digest,&sha);char text[65];for(int i=0;i<32;i++)snprintf(text+i*2,3,"%02x",digest[i]);return ok&&strcmp(text,expectedHash)==0;
}
static bool writeAll(int fd,const std::string &bytes){size_t offset=0;while(offset<bytes.size()){ssize_t n=write(fd,bytes.data()+offset,bytes.size()-offset);if(n<0&&errno==EINTR)continue;if(n<=0)return false;offset+=(size_t)n;}return true;}
static NSDictionary *readResponse(int fd){
  std::string header;char ch;while(header.size()<4096&&header.find("\r\n\r\n")==std::string::npos){if(read(fd,&ch,1)!=1)return nil;header+=ch;}if(header.find("HTTP/1.1 200 ")!=0)return nil;
  // This fixture's small fixed original responses use standard Content-Length;
  // production LINK owns its full original HTTP parser, not this test parser.
  auto at=header.find("Content-Length: ");if(at==std::string::npos)return nil;size_t length=strtoul(header.c_str()+at+16,nullptr,10);if(!length||length>YNX_NETWORK_CURRENT_MESSAGE_MAX)return nil;std::string body(length,'\0');size_t offset=0;while(offset<length){ssize_t n=read(fd,body.data()+offset,length-offset);if(n<=0)return nil;offset+=(size_t)n;}
  NSData *raw=[NSData dataWithBytes:body.data() length:body.size()];id object=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];return [object isKindOfClass:NSDictionary.class]?object:nil;
}
static NSDictionary *call(int fd,const char *id,const char *operation){
  NSDictionary *request=@{@"version":@YNX_NETWORK_CURRENT_IPC_VERSION,@"id":@(id),@"operation":@(operation),@"payload":@{}};NSData *raw=[NSJSONSerialization dataWithJSONObject:request options:0 error:nil];std::string bytes((const char*)raw.bytes,raw.length);std::string wire="POST /v1/call HTTP/1.1\r\nHost: localipc\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nContent-Length: "+std::to_string(bytes.size())+"\r\n\r\n"+bytes;if(!writeAll(fd,wire))return nil;NSDictionary *response=readResponse(fd);if(![response[@"version"]isEqual:@YNX_NETWORK_CURRENT_IPC_VERSION]||![response[@"id"]isEqual:@(id)]||![response[@"code"]isEqual:@"OK"]||![response[@"peer"][@"nativeIPCVerified"]isEqual:@YES]||![response[@"peer"][@"browserIdentityVerified"]isEqual:@NO])return nil;return response[@"result"][@"payload"];
}
int main(int argc,const char **argv){@autoreleasepool{
  if(argc!=6)return 2;puts("READY");fflush(stdout);char ready;if(read(STDIN_FILENO,&ready,1)!=1)return 3;
  HeldSocket socket;socket.fd=::socket(AF_UNIX,SOCK_STREAM,0);if(socket.fd<0)return 4;sockaddr_un address{};address.sun_family=AF_UNIX;if(strlen(argv[1])>=sizeof(address.sun_path))return 5;strcpy(address.sun_path,argv[1]);if(connect(socket.fd,(sockaddr*)&address,sizeof(address)))return 6;
  int pid=0;socklen_t size=sizeof(pid);uid_t uid;gid_t gid;if(getpeereid(socket.fd,&uid,&gid)||uid!=geteuid()||getsockopt(socket.fd,SOL_LOCAL,LOCAL_PEERPID,&pid,&size)||pid!=atoi(argv[2])||!actualProcess(pid,argv[3],argv[4],argv[5]))return 7;
  NSDictionary *first=call(socket.fd,"cxx_1",YNX_NETWORK_CURRENT_REQUEST);NSDictionary *data=first[@"resourceCurrent"],*observation=first[@"observation"];if(![first[@"code"]isEqual:@"DATA_ONLY"]||data.count!=YNX_NETWORK_CURRENT_DATA_FIELDS||![first[@"authority"]isEqual:@NO]||![first[@"registeredIssuer"]isEqual:@NO]||![first[@"productionEnabled"]isEqual:@NO]||[data[@"expiresAtMs"]longLongValue]-[data[@"issuedAtMs"]longLongValue]!=YNX_NETWORK_CURRENT_TTL_MS||[observation[@"server"][@"pid"]intValue]!=pid||[observation[@"caller"][@"pid"]intValue]!=getpid())return 8;
  NSString *session=observation[@"sessionId"];usleep(3250000);if(!actualProcess(pid,argv[3],argv[4],argv[5]))return 9;
  NSDictionary *second=call(socket.fd,"cxx_2",YNX_NETWORK_CURRENT_REQUEST);if(![second[@"observation"][@"sessionId"]isEqual:session]||![second[@"resourceCurrent"][@"head"]isEqual:data[@"head"]]||![second[@"resourceCurrent"][@"sequence"]isEqual:data[@"sequence"]])return 10;
  NSDictionary *retired=call(socket.fd,"cxx_retire",YNX_NETWORK_CURRENT_RETIRE);if(![retired[@"observation"][@"lifetime"][@"retired"]isEqual:@YES])return 11;
  NSDictionary *joined=call(socket.fd,"cxx_join",YNX_NETWORK_CURRENT_JOIN);if(![joined[@"observation"][@"lifetime"][@"joined"]isEqual:@YES])return 12;
  NSDictionary *closed=call(socket.fd,"cxx_close",YNX_NETWORK_CURRENT_CLOSE);if(![closed[@"observation"][@"sessionId"]isEqual:session]||![closed[@"observation"][@"lifetime"][@"physicalComplete"]isEqual:@YES])return 13;
  puts("PASS PUBLIC_CONTROLLED_CXX_SAME_FD_OS_PID_START_IMAGE_EXACT9_RETIRE_JOIN_CLOSE; no Root/fence/NAPI/sign/dispatch");return 0;
}}
