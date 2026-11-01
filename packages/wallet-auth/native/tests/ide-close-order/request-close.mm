#import <Foundation/Foundation.h>
#include <cassert>
#include <string>
#include <unordered_set>
@interface PublicCloseSource:NSObject
@property int retireCalls,joinCalls,closeCalls,mode;
-(void)retire;-(BOOL)join:(NSError**)error;-(BOOL)close:(NSError**)error;
@end
@implementation PublicCloseSource
-(void)retire{self.retireCalls++;}
-(BOOL)join:(NSError**)error{self.joinCalls++;if(self.mode==1)return NO;if(self.mode==4&&error)*error=[NSError errorWithDomain:@"PUBLIC" code:4 userInfo:nil];return YES;}
-(BOOL)close:(NSError**)error{self.closeCalls++;if(self.mode==2)return NO;if(self.mode==3&&error)*error=[NSError errorWithDomain:@"PUBLIC" code:3 userInfo:nil];if(self.mode==5)@throw [NSException exceptionWithName:@"PUBLIC" reason:nil userInfo:nil];return YES;}
@end
struct IDEIdentityRequestOwner{bool closeSelected=false,cleanupComplete=false,retired=false,unknown=false;unsigned entered=0,peerChildren=0;std::string closeFirst;PublicCloseSource*__strong effect=nil,*__strong source=nil;};
static std::unordered_set<IDEIdentityRequestOwner*>ideIdentityDebt;
static std::string IDEIdentityCode(NSError*error,const char*otherwise){(void)error;return otherwise;}
static bool IDEIdentityFail(IDEIdentityRequestOwner*h,const std::string&cause){(void)cause;h->unknown=true;return false;}
/* ACTUAL_JOIN_CLOSE */
int main(){@autoreleasepool{int controls=0;
 for(int mode=0;mode<=5;mode++){
  IDEIdentityRequestOwner h;h.effect=[PublicCloseSource new];h.source=[PublicCloseSource new];h.effect.mode=mode;
  bool result=IDEIdentityClose(&h);
  if(mode==0){assert(result&&h.cleanupComplete&&h.effect==nil&&h.source==nil);}
  else{assert(!result&&h.effect&&h.source);if(mode!=1&&mode!=4){if(h.source.closeCalls!=0){std::fprintf(stderr,"child-close RED mode=%d effectClose=%d parentClose=%d\n",mode,h.effect.closeCalls,h.source.closeCalls);return 1;}assert(ideIdentityDebt.count(&h));assert(!IDEIdentityClose(&h)&&h.effect.closeCalls==1&&h.source.closeCalls==0);}else assert(h.effect.closeCalls==0&&h.source.closeCalls==0);}
  ideIdentityDebt.erase(&h);controls++;
 }
 {IDEIdentityRequestOwner h;h.effect=[PublicCloseSource new];h.source=[PublicCloseSource new];h.source.mode=2;assert(!IDEIdentityClose(&h));assert(h.effect.closeCalls==1&&h.source.closeCalls==1);assert(!IDEIdentityClose(&h)&&h.effect.closeCalls==1&&h.source.closeCalls==1);ideIdentityDebt.erase(&h);controls++;}
 {IDEIdentityRequestOwner h;h.effect=[PublicCloseSource new];h.source=[PublicCloseSource new];h.peerChildren=1;assert(!IDEIdentityClose(&h)&&!h.effect.closeCalls&&!h.source.closeCalls&&!h.closeSelected);controls++;}
 std::printf("%d actual IDEIdentityJoin/Close controls PASS; PUBLIC effect/Source owners, no helper/Root/user grant\n",controls);
}}
