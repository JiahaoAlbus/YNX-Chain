struct Connection {int accepted=-1;pid_t child=-1;};
static Connection connection(){
 char directory[]="/tmp/ynx-auth-r138-socket-XXXXXX";assert(mkdtemp(directory));
 std::string name=std::string(directory)+"/peer";assert(name.size()<sizeof(sockaddr_un{}.sun_path));
 int listener=socket(AF_UNIX,SOCK_STREAM,0);assert(listener>=0);sockaddr_un address{};address.sun_family=AF_UNIX;std::memcpy(address.sun_path,name.c_str(),name.size()+1);
 assert(!bind(listener,(sockaddr*)&address,sizeof(address))&&!listen(listener,1));pid_t child=fork();assert(child>=0);
 if(!child){::close(listener);int client=socket(AF_UNIX,SOCK_STREAM,0);if(client<0||connect(client,(sockaddr*)&address,sizeof(address)))_exit(71);char finish;ssize_t n=read(client,&finish,1);::close(client);_exit(n==1?0:72);}
 int accepted=accept(listener,nullptr,nullptr);assert(accepted>=0);::close(listener);assert(!unlink(name.c_str())&&!rmdir(directory));return {accepted,child};
}
static void finish(Connection&c){char byte=0;assert(write(c.accepted,&byte,1)==1);::close(c.accepted);c.accepted=-1;int status=0;assert(waitpid(c.child,&status,0)==c.child&&WIFEXITED(status)&&WEXITSTATUS(status)==0);c.child=-1;}
