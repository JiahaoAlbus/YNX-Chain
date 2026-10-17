#include "original-source-verifier-io.h"
#include <cassert>
#include <csignal>
#include <sys/wait.h>
#include <iostream>
#include <string>
static bool writeAll(int fd,std::size_t bytes){unsigned char data[1024]{};while(bytes){auto n=write(fd,data,std::min(bytes,sizeof(data)));if(n<=0)return false;bytes-=(std::size_t)n;}return true;}
static std::string run(unsigned mode){
 int in[2],out[2],err[2];assert(pipe(in)==0&&pipe(out)==0&&pipe(err)==0);
 pid_t child=fork();assert(child>=0); // No retry on resource pressure.
 if(child==0){
  close(in[1]);close(out[0]);close(err[0]);
  if(mode==1){(void)writeAll(out[1],65537);_exit(0);}
  if(mode==2){(void)writeAll(err[1],70000);_exit(0);}
  if(mode==3||mode==4){signal(SIGTERM,SIG_IGN);if(mode==3){close(out[1]);close(err[1]);}for(;;)pause();}
  // Bidirectional pressure: output before draining a >pipe-capacity input.
  if(!writeAll(out[1],60000))_exit(3);
  unsigned char data[4096];std::size_t total=0;ssize_t n;
  while((n=read(in[0],data,sizeof(data)))>0)total+=(std::size_t)n;
  close(in[0]);close(out[1]);close(err[1]);_exit(total==131072?0:4);
 }
 close(in[0]);close(out[1]);close(err[1]);
 bool reaped=false,closed=false;int status=0;std::string failure;
 auto reap=[&](){if(!reaped){pid_t r=waitpid(child,&status,WNOHANG);assert(r==0||r==child);reaped=r==child;}return !reaped;};
 std::vector<unsigned char> input(131072);
 const auto before=std::chrono::steady_clock::now();
 try{auto result=ynx_auth_private::boundedVerifierIO(in[1],out[0],err[0],input.data(),input.size(),[&](){assert(!closed);closed=true;return close(in[1])==0;},reap,mode>=3?50:2000);assert(mode==0&&result.size()==60000);}
 catch(const std::runtime_error &e){failure=e.what();}
 auto elapsed=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-before).count();
 // Only the unreaped original PUBLIC fixture child may be killed, never a
 // PID discovered by search. Reap before returning even on a helper failure.
 if(!reaped){pid_t r=waitpid(child,&status,WNOHANG);assert(r==0||r==child);if(r==0){assert(kill(child,SIGKILL)==0);assert(waitpid(child,&status,0)==child);}reaped=true;}
 if(!closed)close(in[1]);close(out[0]);close(err[0]);
 assert(reaped);if(mode>=3)assert(elapsed<1000);
 return failure;
}
int main(){
 assert(run(0).empty());
 assert(run(1)=="AUTH_IDENTITY_VERIFIER_OUTPUT_CAPACITY");
 assert(run(2)=="AUTH_IDENTITY_VERIFIER_STDERR_REJECTED");
 assert(run(3)=="AUTH_IDENTITY_VERIFIER_TIMEOUT_UNKNOWN");
 assert(run(4)=="AUTH_IDENTITY_VERIFIER_TIMEOUT_UNKNOWN");
 std::cout<<"PASS actual borrowed-pipe pump: duplex backpressure, output cap, stderr rejection, closed-output live child, stuck input; all five owned fixture children reaped\n";
}
