// Synthetic stdout only. No network, browser/profile/key/user-file access.
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <pwd.h>
#include <limits.h>
#include <errno.h>
static int output(const void *p,size_t n){size_t used=0;while(used<n){ssize_t k=write(STDOUT_FILENO,(const char*)p+used,n-used);if(k<0&&errno==EINTR)continue;if(k<=0)return 0;used+=(size_t)k;}return 1;}
int main(int argc,char**argv){
    if(argc!=2)return 64;char*end=0;unsigned long length=strtoul(argv[1],&end,10);
    if(!end||*end||length<128||length>16777216)return 65;
    const char*home=getenv("HOME");int verified=0;
    if(home){struct passwd*p=getpwuid(getuid());char actual[PATH_MAX];if(!p||!realpath(p->pw_dir,actual)||strcmp(home,actual))return 66;verified=1;}
    const char*prefix=verified?"{\"synthetic\":\"YNX_CAPTURE\",\"homeVerified\":true,\"padding\":\"":"{\"synthetic\":\"YNX_CAPTURE\",\"homeVerified\":false,\"padding\":\"";
    const char*suffix="\",\"tail\":\"YNX_CAPTURE_TAIL\"}\n";
    size_t head=strlen(prefix),tail=strlen(suffix),padding=(size_t)length-head-tail;
    if(!output(prefix,head))return 67;
    char bytes[8192];memset(bytes,'x',sizeof(bytes));
    while(padding){size_t count=padding<sizeof(bytes)?padding:sizeof(bytes);if(!output(bytes,count))return 68;padding-=count;}
    if(!output(suffix,tail))return 69;
    return 0;
}
