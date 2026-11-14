// Only an owned loopback/output diagnostic. Not Arti/Nym, a privacy route or NE authority.
#include <arpa/inet.h>
#include <sys/socket.h>
#include <poll.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
#include <signal.h>

int main(void) {
    signal(SIGPIPE, SIG_IGN);
    int listener=socket(AF_INET,SOCK_STREAM,0);
    struct sockaddr_in address={.sin_len=sizeof(address),.sin_family=AF_INET};address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    if(listener<0||bind(listener,(struct sockaddr *)&address,sizeof(address))||listen(listener,1))return 70;
    socklen_t size=sizeof(address);if(getsockname(listener,(struct sockaddr *)&address,&size))return 71;
    printf("{\"fixtureReady\":true,\"pid\":%d,\"port\":%u}\r\n",getpid(),ntohs(address.sin_port));fflush(stdout);
    for(;;){
        struct pollfd fds[2]={{STDIN_FILENO,POLLIN|POLLHUP,0},{listener,POLLIN,0}};
        if(poll(fds,2,100)<0)return 72;
        if(fds[0].revents&(POLLIN|POLLHUP)){char byte;if(read(STDIN_FILENO,&byte,1)<=0){close(listener);return 0;}}
        if(fds[1].revents&POLLIN){int peer=accept(listener,NULL,NULL);if(peer<0)return 73;char command=0;if(read(peer,&command,1)!=1)return 74;
            if(command=='F'){
                char block[4096];memset(block,'X',sizeof(block));
                for(int i=0;i<512;i++){size_t offset=0;while(offset<sizeof(block)){ssize_t n=write(STDOUT_FILENO,block+offset,sizeof(block)-offset);if(n<=0)return 75;offset+=(size_t)n;}}
                write(peer,"DONE",4);
            }else if(command=='C'){close(STDOUT_FILENO);write(peer,"CLOSED",6);}else return 76;
            close(peer);
        }
    }
}
