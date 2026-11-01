#define main QAActualLauncherMain
#import "launcher.m"
#undef main
static void check(BOOL ok,const char *name){if(!ok){fprintf(stderr,"FAIL %s\n",name);exit(1);}printf("PASS %s\n",name);}
int main(int argc,const char **argv){@autoreleasepool{
 if(argc!=2)return 2;NSString *dir=@(argv[1]);NSString *helper=[dir stringByAppendingPathComponent:@"ynx-network-helper"],*proof=[dir stringByAppendingPathComponent:@"ynx-consensus-proof-verify"],*worker=[dir stringByAppendingPathComponent:@"ynx-network-task-worker"];
 [@"isolated-helper"writeToFile:helper atomically:YES encoding:NSUTF8StringEncoding error:nil];[@"isolated-proof"writeToFile:proof atomically:YES encoding:NSUTF8StringEncoding error:nil];[@"isolated-fixed-worker"writeToFile:worker atomically:YES encoding:NSUTF8StringEncoding error:nil];
 NSMutableDictionary *build=[@{@"helperSHA256":digest(helper),@"proofSHA256":digest(proof)}mutableCopy];check(packagedFiles(helper,proof,build),"old QA package remains read-only compatible without task worker");
 build[@"resourceWorkerSHA256"]=digest(worker);check(packagedFiles(helper,proof,build),"new exact fixed worker digest accepted");
 [@"changed-worker"writeToFile:worker atomically:YES encoding:NSUTF8StringEncoding error:nil];check(!packagedFiles(helper,proof,build),"changed fixed worker denies packaged launch");
 [[NSFileManager defaultManager]removeItemAtPath:worker error:nil];check(!packagedFiles(helper,proof,build),"missing worker cannot silently fall back");
 build[@"resourceWorkerSHA256"]=@YES;check(!packagedFiles(helper,proof,build),"non-string worker pin denied");
 build[@"resourceWorkerSHA256"]=@"short";check(!packagedFiles(helper,proof,build),"malformed worker pin denied");
 return 0;
}}
