#include "device-management-operation-fence.h"
#include <cassert>
#include <csignal>
#include <cstdlib>
#include <sys/wait.h>
#include <pwd.h>
using namespace ynx_auth_private;
static std::array<unsigned char,32> fill(unsigned char c){std::array<unsigned char,32>a{};a.fill(c);return a;}
int main(){
 const passwd*user=getpwuid(getuid());assert(user&&user->pw_dir);std::string pattern=std::string(user->pw_dir)+"/.codex/ynx-management-fence-XXXXXX";std::vector<char> parent(pattern.begin(),pattern.end());parent.push_back('\0');assert(mkdtemp(parent.data()));
 ManagementOriginalBinding b{fill(1),fill(2),fill(3),fill(4),fill(5),fill(6),fill(7),12345};
 int pipefd[2];assert(pipe(pipefd)==0);pid_t pid=fork();assert(pid>=0);
 if(pid==0){close(pipefd[0]);HostDirfdJournal journal;try{journal.open(parent.data(),"journal");ManagementOperationFence f(journal,b);f.reserve();char ok='1';if(write(pipefd[1],&ok,1)!=1)_exit(3);for(;;)pause();}catch(...){_exit(4);}}
 close(pipefd[1]);char received=0;assert(read(pipefd[0],&received,1)==1&&received=='1');close(pipefd[0]);assert(kill(pid,SIGKILL)==0);int status=0;assert(waitpid(pid,&status,0)==pid&&WIFSIGNALED(status)&&WTERMSIG(status)==SIGKILL);
 HostDirfdJournal journal;journal.openProductDeviceV4PendingExisting(parent.data(),"journal");
 ManagementOperationFence original(journal,b);assert(original.observe()==ManagementOperationFence::Observation::MATCHED_ORIGINAL);
 bool denied=false;try{original.reserve();}catch(const std::exception&){denied=true;}assert(denied);
 auto changed=b;changed.replayKey=fill(8);ManagementOperationFence alternate(journal,changed);assert(alternate.observe()==ManagementOperationFence::Observation::MISMATCH);denied=false;try{alternate.reserve();}catch(const std::exception&){denied=true;}assert(denied);
 changed=b;changed.bodyDigest=fill(9);ManagementOperationFence alteredBody(journal,changed);assert(alteredBody.observe()==ManagementOperationFence::Observation::MISMATCH);
 for(unsigned field=0;field<4;++field){changed=b;if(field==0)changed.actor=fill(11);if(field==1)changed.session=fill(11);if(field==2)changed.proofDigest=fill(11);if(field==3)changed.expiresMs++;ManagementOperationFence different(journal,changed);assert(different.observe()==ManagementOperationFence::Observation::MISMATCH);denied=false;try{different.reserve();}catch(const std::exception&){denied=true;}assert(denied);}
 changed=b;changed.operation=fill(10);ManagementOperationFence absent(journal,changed);assert(absent.observe()==ManagementOperationFence::Observation::UNKNOWN);
 assert(journal.close());return 0;
}
