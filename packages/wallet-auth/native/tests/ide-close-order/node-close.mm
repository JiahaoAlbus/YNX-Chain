#import <Foundation/Foundation.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include <fcntl.h>
#include <cerrno>
#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
/* CONNECTION_HELPERS */
@interface PublicNodeSource:NSObject
@property int joins,closes,mode;
-(void)retire;-(BOOL)join:(NSError**)error;-(BOOL)close:(NSError**)error;
@end
@implementation PublicNodeSource
-(void)retire{}
-(BOOL)join:(NSError**)error{self.joins++;if(self.mode==1)return NO;if(self.mode==2&&error)*error=[NSError errorWithDomain:@"PUBLIC" code:2 userInfo:nil];return YES;}
-(BOOL)close:(NSError**)error{self.closes++;if(self.mode==3&&error)*error=[NSError errorWithDomain:@"PUBLIC" code:3 userInfo:nil];return YES;}
@end
struct PublicLife{void retire(){}};struct PublicDebt{bool clean(){return true;}};
/* ACTUAL_NODE_SAMEFILE */
@interface NodeCloseHarness:NSObject
-(instancetype)initFD:(int)fd source:(PublicNodeSource*)source;
-(BOOL)closeOriginal:(NSError**)error;
@end
@implementation NodeCloseHarness{
 int _ownedEndpoint;struct stat _endpointIdentity;BOOL _closeSelected,_complete,_retired,_ready,_endpointSelected;
 PublicLife _life;PublicDebt _resourceDebt;PublicNodeSource*_source;NSError*_cleanup,*_first;id _originalCause;
}
-(instancetype)initFD:(int)fd source:(PublicNodeSource*)source{if((self=[super init])){_ownedEndpoint=fd;_source=source;_ready=YES;if(fd>=0)assert(!fstat(fd,&_endpointIdentity));}return self;}
/* ACTUAL_NODE_CLOSE */
@end
int main(){@autoreleasepool{int controls=0;
 {auto c=connection();int fd=dup(c.accepted);assert(fd>=0);PublicNodeSource*s=[PublicNodeSource new];NodeCloseHarness*h=[[NodeCloseHarness alloc]initFD:fd source:s];finish(c);NSError*error=nil;BOOL ok=[h closeOriginal:&error];if(!ok){std::fprintf(stderr,"Node-exit-close RED code=%s\n",error.localizedDescription.UTF8String);return 1;}assert(s.closes==1&&[h closeOriginal:&error]&&s.closes==1&&fcntl(fd,F_GETFD)<0);controls++;}
 for(int mode=1;mode<=3;mode++){PublicNodeSource*s=[PublicNodeSource new];s.mode=mode;NodeCloseHarness*h=[[NodeCloseHarness alloc]initFD:-1 source:s];NSError*error=nil;BOOL ok=[h closeOriginal:&error];if(ok||(mode<3&&s.closes)){std::fprintf(stderr,"Node-parent-close RED mode=%d returned=%d closes=%d\n",mode,ok,s.closes);return 1;}assert(![h closeOriginal:&error]&&s.closes==(mode<3?0:1));controls++;}
 // Regular-file permission changes must STILL be detected.
 {struct stat a{},b{};a.st_dev=b.st_dev=1;a.st_ino=b.st_ino=2;a.st_mode=S_IFREG|0600;b.st_mode=S_IFREG|0644;assert(!NodeSameFile(a,b));controls++;}
 std::printf("%d actual Node close/file-identity controls PASS; real socket exit, PUBLIC Source, no helper/Root/user grant\n",controls);
}}
