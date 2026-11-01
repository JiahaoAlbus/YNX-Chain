// Read-only sampler for one live direct child of the original helper. It never
// signals a PID: only the original Go owner retains its os.Process kill handle.
#include <libproc.h>
#include <mach/mach_time.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <time.h>

static mach_timebase_info_data_t timebase;
// XNU task_power_info_locked returns Mach ticks, including on Apple Silicon.
static uint64_t micros(uint64_t ticks){return (uint64_t)(((__uint128_t)ticks*timebase.numer)/timebase.denom/1000);}
static int over(const struct rusage_info_v0 *u,uint64_t cpu){uint64_t a=micros(u->ri_user_time),b=micros(u->ri_system_time);return a>=cpu||b>=cpu-a;}
static int number(const char *s,uint64_t *out){
 if(!s||!*s||*s=='0'||strlen(s)>20)return 0;
 uint64_t n=0;for(const unsigned char *p=(const unsigned char*)s;*p;p++){if(*p<'0'||*p>'9'||n>(UINT64_MAX-(*p-'0'))/10)return 0;n=n*10+(*p-'0');}*out=n;return 1;
}
static uint64_t monotonic_ms(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (uint64_t)t.tv_sec*1000+(uint64_t)t.tv_nsec/1000000;}
static void emit(const char *phase,const char *challenge,int pid,int parent,const struct rusage_info_v0 *u){
 printf("{\"version\":\"YNX-NETWORK-RESOURCE-MONITOR/v1\",\"phase\":\"%s\",\"challenge\":\"%s\",\"pid\":\"%d\",\"parent\":\"%d\",\"start\":\"%llu\",\"userMicros\":\"%llu\",\"systemMicros\":\"%llu\",\"rssBytes\":\"%llu\"}\n",phase,challenge,pid,parent,(unsigned long long)u->ri_proc_start_abstime,(unsigned long long)(micros(u->ri_user_time)),(unsigned long long)(micros(u->ri_system_time)),(unsigned long long)u->ri_resident_size);fflush(stdout);
}
int main(int argc,char **argv){
 if(argc!=11||strcmp(argv[1],"--pid")||strcmp(argv[3],"--parent")||strcmp(argv[5],"--cpu-micros")||strcmp(argv[7],"--duration-ms")||strcmp(argv[9],"--challenge")){fputs("MONITOR_ARGS\n",stderr);return 2;}
 uint64_t pid64,parent64,cpu,ms;if(!number(argv[2],&pid64)||!number(argv[4],&parent64)||!number(argv[6],&cpu)||!number(argv[8],&ms)||pid64>INT_MAX||parent64>INT_MAX||parent64<=1||cpu>5000000||ms>5000||strlen(argv[10])!=32||geteuid()==0){fputs("MONITOR_ARGS\n",stderr);return 2;}
 for(const char *p=argv[10];*p;p++)if(!(*p>='0'&&*p<='9')&&!(*p>='a'&&*p<='f')){fputs("MONITOR_ARGS\n",stderr);return 2;}
 if(mach_timebase_info(&timebase)!=KERN_SUCCESS||!timebase.numer||!timebase.denom)return 3;
 const int resources[]={RLIMIT_CORE,RLIMIT_FSIZE,RLIMIT_NPROC,RLIMIT_NOFILE};const rlim_t values[]={0,0,0,16};
 for(unsigned i=0;i<sizeof(resources)/sizeof(resources[0]);i++){struct rlimit r={values[i],values[i]};if(setrlimit(resources[i],&r))return 3;}
 int pid=(int)pid64,parent=(int)parent64;if(getppid()!=parent||pid==parent||pid==getpid()){fputs("MONITOR_OWNER\n",stderr);return 2;}
 struct proc_bsdinfo b={0};struct rusage_info_v0 u={0};
 if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,sizeof(b))!=(int)sizeof(b)||b.pbi_ppid!=(uint32_t)parent||b.pbi_uid!=geteuid()||proc_pid_rusage(pid,RUSAGE_INFO_V0,(rusage_info_t*)&u)||!u.ri_proc_start_abstime){fputs("MONITOR_OWNER\n",stderr);return 3;}
 uint64_t start=u.ri_proc_start_abstime,began=monotonic_ms();if(!began)return 3;
 if(over(&u,cpu)){emit("cpu_limit",argv[10],pid,parent,&u);return 0;}
 emit("ready",argv[10],pid,parent,&u);
 for(;;){
  struct timespec delay={.tv_sec=0,.tv_nsec=10000000};nanosleep(&delay,NULL);
  if(getppid()!=parent)return 0;
  if(proc_pid_rusage(pid,RUSAGE_INFO_V0,(rusage_info_t*)&u)){emit("exited",argv[10],pid,parent,&u);return 0;}
  if(u.ri_proc_start_abstime!=start||proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,sizeof(b))!=(int)sizeof(b)||b.pbi_ppid!=(uint32_t)parent||b.pbi_uid!=geteuid()){emit("identity_changed",argv[10],pid,parent,&u);return 0;}
  if(over(&u,cpu)){emit("cpu_limit",argv[10],pid,parent,&u);return 0;}
  uint64_t now=monotonic_ms();if(!now||now<began||now-began>ms+100){emit("wall_limit",argv[10],pid,parent,&u);return 0;}
 }
}
