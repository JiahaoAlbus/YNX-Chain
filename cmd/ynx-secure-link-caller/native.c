#define _GNU_SOURCE
#include <node_api.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#ifdef __APPLE__
#include <sys/ucred.h>
#endif
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <time.h>
#include <stdatomic.h>
#ifdef YNX_CALLER_FORK_TESTS
#include <sys/wait.h>
#endif

// This tag brands an actual private native allocation in this N-API instance.
// Peer snapshots, object copies and JSON cannot construct it.
static const napi_type_tag caller_tag = {0x6871ca1fd8924b63ULL, 0x948ef1f25a71bd02ULL};

typedef struct {
    int control_fd, transfer_fd, retired;
    pid_t owner_pid, peer_pid;
    uid_t peer_uid;
} caller;

typedef struct {
    napi_async_work work;
    napi_deferred deferred;
    char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
    uid_t uid;
    pid_t pid;
    int timeout_ms, error_number;
    const char *failure;
    caller *value;
} connecting;

static napi_value failure_value(napi_env env, const char *code, const char *message, int number) {
    napi_value text, error, value;
    napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &text);
    napi_create_error(env, NULL, text, &error);
    napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &value);
    napi_set_named_property(env, error, "code", value);
    if (number) {
        napi_create_int32(env, number, &value);
        napi_set_named_property(env, error, "errno", value);
    }
    return error;
}

static napi_value reject(napi_env env, const char *code, const char *message) {
    napi_throw(env, failure_value(env, code, message, 0));
    return NULL;
}

static int peer_identity(int fd, uid_t *uid, pid_t *pid) {
#if defined(__APPLE__)
    struct xucred credentials;
    socklen_t length = sizeof(credentials);
    if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERCRED, &credentials, &length) ||
        length != sizeof(credentials) || credentials.cr_version != XUCRED_VERSION) return -1;
    length = sizeof(*pid);
    if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, pid, &length) || length != sizeof(*pid)) return -1;
    *uid = credentials.cr_uid;
    return *pid > 0 ? 0 : -1;
#elif defined(__linux__)
    struct ucred credentials;
    socklen_t length = sizeof(credentials);
    if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &credentials, &length) || length != sizeof(credentials)) return -1;
    *uid = credentials.uid;
    *pid = credentials.pid;
    return *pid > 0 ? 0 : -1;
#else
    (void)fd; (void)uid; (void)pid;
    errno = ENOTSUP;
    return -1;
#endif
}

static void close_owned(caller *value) {
    // A forked child must not shutdown the parent's shared socket description.
    // Closing only the child's inherited descriptors does not revoke the parent.
    if (!value->retired && value->owner_pid == getpid() && value->control_fd >= 0)
        (void)shutdown(value->control_fd, SHUT_RDWR);
    value->retired = 1;
    if (value->transfer_fd >= 0) { (void)close(value->transfer_fd); value->transfer_fd = -1; }
    if (value->control_fd >= 0) { (void)close(value->control_fd); value->control_fd = -1; }
}

static void finalize(napi_env env, void *data, void *hint) {
    (void)env; (void)hint;
    caller *value = data;
    close_owned(value);
    free(value);
}

static caller *unwrap(napi_env env, napi_value object) {
    bool tagged = false;
    void *data = NULL;
    if (napi_check_object_type_tag(env, object, &caller_tag, &tagged) != napi_ok || !tagged ||
        napi_unwrap(env, object, &data) != napi_ok || !data) return NULL;
    return data;
}

static int current(caller *value) {
    if (getpid() != value->owner_pid) { errno = EPERM; return -1; }
    if (value->retired || value->control_fd < 0) { errno = EBADF; return -1; }
    uid_t uid; pid_t pid;
    if (peer_identity(value->control_fd, &uid, &pid) || uid != value->peer_uid || pid != value->peer_pid) {
        errno = EPERM; return -1;
    }
    struct pollfd event = {.fd = value->control_fd, .events = POLLIN};
    if (poll(&event, 1, 0) < 0 || (event.revents & (POLLERR | POLLHUP | POLLNVAL))) return -1;
    if (event.revents & POLLIN) {
        unsigned char byte;
        ssize_t size = recv(value->control_fd, &byte, 1, MSG_PEEK | MSG_DONTWAIT);
        if (size == 0 || (size < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) {
            errno = ENOTCONN; return -1;
        }
    }
    return 0;
}

static int64_t monotonic_ms(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now)) return -1;
    return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int private_path(const char *path, uid_t uid) {
    char parent[sizeof(((struct sockaddr_un *)0)->sun_path)];
    size_t length = strlen(path);
    if (!length || path[0] != '/' || length >= sizeof(parent)) { errno = EINVAL; return -1; }
    memcpy(parent, path, length + 1);
    char *slash = strrchr(parent, '/');
    if (!slash || slash == parent) { errno = EINVAL; return -1; }
    *slash = 0;
    struct stat directory, socket;
    if (lstat(parent, &directory) || lstat(path, &socket)) return -1;
    if (!S_ISDIR(directory.st_mode) || directory.st_uid != uid || (directory.st_mode & 077) ||
        !S_ISSOCK(socket.st_mode) || socket.st_uid != uid || (socket.st_mode & 077)) {
        errno = EACCES; return -1;
    }
    return 0;
}

static void execute_connect(napi_env env, void *data) {
    (void)env;
    connecting *job = data;
    int fd = -1, control = -1;
    if (private_path(job->path, job->uid)) { job->failure = "private Unix socket owner/mode check failed"; goto failed; }
    fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) { job->failure = "Unix socket creation failed"; goto failed; }
    if (fcntl(fd, F_SETFD, FD_CLOEXEC) || fcntl(fd, F_SETFL, O_NONBLOCK)) { job->failure = "Unix socket flags failed"; goto failed; }
    struct sockaddr_un address;
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    memcpy(address.sun_path, job->path, strlen(job->path) + 1);
    if (connect(fd, (struct sockaddr *)&address, sizeof(address))) {
        if (errno != EINPROGRESS) { job->failure = "Unix socket connect failed"; goto failed; }
        int64_t start = monotonic_ms();
        if (start < 0) { job->failure = "monotonic connect clock failed"; goto failed; }
        int64_t end = start + job->timeout_ms;
        for (;;) {
            int64_t now = monotonic_ms();
            if (now < 0) { job->failure = "monotonic connect clock failed"; goto failed; }
            int64_t left = end - now;
            if (left <= 0) { errno = ETIMEDOUT; job->failure = "Unix socket connect timed out"; goto failed; }
            struct pollfd event = {.fd = fd, .events = POLLOUT};
            int ready = poll(&event, 1, (int)left);
            if (ready < 0 && errno == EINTR) continue;
            if (ready <= 0) { if (!ready) errno = ETIMEDOUT; job->failure = "Unix socket connect wait failed"; goto failed; }
            int error = 0; socklen_t length = sizeof(error);
            if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &length) || error) {
                if (error) errno = error;
                job->failure = "Unix socket connect rejected"; goto failed;
            }
            break;
        }
    }
    uid_t uid; pid_t pid;
    if (peer_identity(fd, &uid, &pid) || uid != job->uid || pid != job->pid) {
        errno = EACCES; job->failure = "actual Unix peer UID/PID mismatch"; goto failed;
    }
    control = fcntl(fd, F_DUPFD_CLOEXEC, 0);
    if (control < 0) { job->failure = "owned control descriptor duplication failed"; goto failed; }
    caller *value = calloc(1, sizeof(*value));
    if (!value) { errno = ENOMEM; job->failure = "native caller allocation failed"; goto failed; }
    value->control_fd = control; value->transfer_fd = fd;
    value->owner_pid = getpid(); value->peer_uid = uid; value->peer_pid = pid;
    job->value = value;
    return;
failed:
    job->error_number = errno;
    if (control >= 0) close(control);
    if (fd >= 0) close(fd);
}

static void complete_connect(napi_env env, napi_status status, void *data) {
    connecting *job = data;
    if (status != napi_ok || !job->value) {
        if (job->value) { close_owned(job->value); free(job->value); }
        napi_reject_deferred(env, job->deferred, failure_value(env, "UNAVAILABLE", job->failure ? job->failure : "native connect work cancelled", job->error_number));
    } else {
        napi_value object;
        if (napi_create_object(env, &object) != napi_ok ||
            napi_type_tag_object(env, object, &caller_tag) != napi_ok ||
            napi_wrap(env, object, job->value, finalize, NULL, NULL) != napi_ok) {
            close_owned(job->value); free(job->value);
            napi_reject_deferred(env, job->deferred, failure_value(env, "UNAVAILABLE", "native caller branding failed", 0));
        } else {
            napi_resolve_deferred(env, job->deferred, object);
        }
    }
    napi_delete_async_work(env, job->work);
    free(job);
}

static int number_field(napi_env env, napi_value object, const char *key, uint32_t *out, uint32_t max) {
    napi_value field; double number;
    if (napi_get_named_property(env, object, key, &field) != napi_ok ||
        napi_get_value_double(env, field, &number) != napi_ok || !(number >= 0 && number <= max) ||
        (double)(uint32_t)number != number) return -1;
    *out = (uint32_t)number; return 0;
}

static napi_value connect_unix(napi_env env, napi_callback_info info) {
    napi_value args[1], path, promise, resource;
    size_t argc = 1, length = 0;
    if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 1) return reject(env, "DENIED", "fixed connect registration required");
    connecting *job = calloc(1, sizeof(*job));
    if (!job) return reject(env, "UNAVAILABLE", "native connect allocation failed");
    uint32_t uid, pid, timeout;
    if (napi_get_named_property(env, args[0], "socketPath", &path) != napi_ok ||
        napi_get_value_string_utf8(env, path, NULL, 0, &length) != napi_ok || length == 0 || length >= sizeof(job->path) ||
        napi_get_value_string_utf8(env, path, job->path, sizeof(job->path), &length) != napi_ok || strlen(job->path) != length ||
        number_field(env, args[0], "serverUID", &uid, UINT32_MAX) ||
        number_field(env, args[0], "serverPID", &pid, INT_MAX) || pid == 0 ||
        number_field(env, args[0], "timeoutMs", &timeout, 30000) || timeout == 0) {
        free(job); return reject(env, "DENIED", "bounded native Unix registration required");
    }
    job->uid = uid; job->pid = (pid_t)pid; job->timeout_ms = (int)timeout;
    napi_create_promise(env, &job->deferred, &promise);
    napi_create_string_utf8(env, "ynx-secure-link-native-connect", NAPI_AUTO_LENGTH, &resource);
    if (napi_create_async_work(env, NULL, resource, execute_connect, complete_connect, job, &job->work) != napi_ok ||
        napi_queue_async_work(env, job->work) != napi_ok) {
        if (job->work) napi_delete_async_work(env, job->work);
        napi_reject_deferred(env, job->deferred, failure_value(env, "UNAVAILABLE", "native connect queue failed", 0));
        free(job);
    }
    return promise;
}

static caller *caller_argument(napi_env env, napi_callback_info info) {
    size_t count = 1; napi_value args[1];
    if (napi_get_cb_info(env, info, &count, args, NULL, NULL) != napi_ok || count != 1) return NULL;
    return unwrap(env, args[0]);
}

static napi_value take_fd(napi_env env, napi_callback_info info) {
    caller *value = caller_argument(env, info);
    if (!value || current(value) || value->transfer_fd < 0) return reject(env, "DENIED", "native descriptor transfer denied");
    napi_value fd;
    napi_create_int32(env, value->transfer_fd, &fd);
    value->transfer_fd = -1; // Node net.Socket now owns this descriptor exactly once.
    return fd;
}

static void set_number(napi_env env, napi_value object, const char *key, uint32_t number) {
    napi_value value; napi_create_uint32(env, number, &value); napi_set_named_property(env, object, key, value);
}
static napi_value inspect_current(napi_env env, napi_callback_info info) {
    caller *value = caller_argument(env, info);
    if (!value || current(value)) return reject(env, "DENIED", "native caller is not a current owned Unix connection");
    napi_value object;
    napi_create_object(env, &object);
    set_number(env, object, "selfPID", (uint32_t)getpid());
    set_number(env, object, "selfUID", (uint32_t)geteuid());
    set_number(env, object, "peerPID", (uint32_t)value->peer_pid);
    set_number(env, object, "peerUID", (uint32_t)value->peer_uid);
    return object;
}

static napi_value retire(napi_env env, napi_callback_info info) {
    caller *value = caller_argument(env, info);
    if (!value) return reject(env, "DENIED", "native caller brand required");
    if (value->owner_pid != getpid()) return reject(env, "DENIED", "forked caller cannot retire its parent's connection");
    close_owned(value);
    napi_value result; napi_get_undefined(env, &result); return result;
}

// Inbound capabilities use distinct tags. An outbound caller, its copies or a
// request/metadata object cannot be unwrapped as a listener or accepted peer.
static const napi_type_tag listener_tag = {0x2b7bcf6b15a34ef9ULL,0x8d4379f24a183e62ULL};
static const napi_type_tag inbound_tag = {0xd1ee1a3735cc4b1cULL,0xa85a905862b794e6ULL};
typedef struct {
    int fd, wake_read, wake_write, timeout_ms;
    pid_t owner_pid, peer_pid;
    uid_t peer_uid;
    atomic_int retired, busy;
} inbound_listener;
typedef struct {
    caller data;
    int channel_fd, timeout_ms, max_frame, queries;
    atomic_int retired, busy;
} inbound_peer;
typedef struct {
    napi_async_work work;
    napi_deferred deferred;
    napi_ref reference;
    inbound_listener *listener;
    inbound_peer *peer;
    int fd, auxiliary, timeout, error;
    const char *failure;
    unsigned char *payload;
    uint32_t size;
} inbound_job;

static void *tagged(napi_env env,napi_value object,const napi_type_tag *tag) {
    bool yes=false; void *value=NULL;
    if(napi_check_object_type_tag(env,object,tag,&yes)!=napi_ok||!yes||napi_unwrap(env,object,&value)!=napi_ok)return NULL;
    return value;
}
static void stop_listener(inbound_listener *value) {
    if(atomic_exchange(&value->retired,1))return;
    if(value->owner_pid==getpid()&&value->wake_write>=0){unsigned char stop='X';(void)write(value->wake_write,&stop,1);}
    if(value->fd>=0){close(value->fd);value->fd=-1;}
    if(value->wake_write>=0){close(value->wake_write);value->wake_write=-1;}
    if(value->wake_read>=0){close(value->wake_read);value->wake_read=-1;}
}
static void stop_inbound(inbound_peer *value) {
    if(atomic_exchange(&value->retired,1))return;
    if(value->channel_fd>=0){if(value->data.owner_pid==getpid())(void)shutdown(value->channel_fd,SHUT_RDWR);close(value->channel_fd);value->channel_fd=-1;}
    close_owned(&value->data);
}
static void finalize_listener(napi_env env,void *data,void *hint){(void)env;(void)hint;inbound_listener *v=data;stop_listener(v);free(v);}
static void finalize_inbound(napi_env env,void *data,void *hint){(void)env;(void)hint;inbound_peer *v=data;stop_inbound(v);free(v);}
static int flagged(int fd){return fcntl(fd,F_SETFD,FD_CLOEXEC)||fcntl(fd,F_SETFL,O_NONBLOCK);}
static int wait_fd(int fd,short events,int wake,int64_t end) {
    for(;;){
        int64_t now=monotonic_ms();if(now<0)return -1;
        int64_t left=end-now;if(left<=0){errno=ETIMEDOUT;return -1;}
        struct pollfd fds[2]={{.fd=fd,.events=events},{.fd=wake,.events=POLLIN}};
        int result=poll(fds,wake>=0?2:1,(int)left);
        if(result<0&&errno==EINTR)continue;
        if(result<=0){if(!result)errno=ETIMEDOUT;return -1;}
        if(wake>=0&&fds[1].revents){errno=ECANCELED;return -1;}
        if(fds[0].revents&events)return 0;
        if(fds[0].revents&(POLLERR|POLLHUP|POLLNVAL)){errno=ENOTCONN;return -1;}
    }
}
static int frame_io(int fd,unsigned char *buffer,size_t length,int writing,int64_t end) {
#ifdef SO_NOSIGPIPE
    if(writing){int no_signal=1;if(setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&no_signal,sizeof(no_signal)))return -1;}
#endif
    size_t at=0;
    while(at<length){
        if(wait_fd(fd,writing?POLLOUT:POLLIN,-1,end))return -1;
        int flags=0;
#ifdef MSG_NOSIGNAL
        flags=MSG_NOSIGNAL;
#endif
        ssize_t n=writing?send(fd,buffer+at,length-at,flags):recv(fd,buffer+at,length-at,0);
        if(n<0&&(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK))continue;
        if(n<=0){if(!n)errno=ENOTCONN;return -1;}at+=(size_t)n;
    }
    return 0;
}
static uint32_t big_endian(const unsigned char *p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static int peer_matches(int fd,uid_t uid,pid_t pid) {uid_t u;pid_t p;return peer_identity(fd,&u,&p)||u!=uid||p!=pid;}

static napi_value listen_inbound(napi_env env,napi_callback_info info) {
    size_t count=1,length=0; napi_value args[1],field,object;
    if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=1)return reject(env,"DENIED","inbound registration required");
    char path[sizeof(((struct sockaddr_un *)0)->sun_path)],parent[sizeof(path)];uint32_t uid,pid,node_uid,timeout;
    if(napi_get_named_property(env,args[0],"socketPath",&field)!=napi_ok||napi_get_value_string_utf8(env,field,NULL,0,&length)!=napi_ok||!length||length>=sizeof(path)||napi_get_value_string_utf8(env,field,path,sizeof(path),&length)!=napi_ok||strlen(path)!=length||path[0]!='/'||
       number_field(env,args[0],"nodeUID",&node_uid,UINT32_MAX)||node_uid!=(uint32_t)geteuid()||number_field(env,args[0],"bridgeUID",&uid,UINT32_MAX)||number_field(env,args[0],"bridgePID",&pid,INT_MAX)||!pid||number_field(env,args[0],"timeoutMs",&timeout,30000)||!timeout)return reject(env,"DENIED","bounded exact inbound registration required");
    memcpy(parent,path,length+1);char *slash=strrchr(parent,'/');if(!slash||slash==parent)return reject(env,"DENIED","private parent required");*slash=0;
    struct stat directory,existing;
    if(lstat(parent,&directory)||!S_ISDIR(directory.st_mode)||directory.st_uid!=geteuid()||(directory.st_mode&077)||lstat(path,&existing)==0||errno!=ENOENT)return reject(env,"DENIED","private parent or unused endpoint required");
    inbound_listener *value=calloc(1,sizeof(*value));if(!value)return reject(env,"UNAVAILABLE","listener allocation failed");
    value->fd=value->wake_read=value->wake_write=-1;value->owner_pid=getpid();value->peer_uid=uid;value->peer_pid=(pid_t)pid;value->timeout_ms=(int)timeout;
    int pipefd[2];if(pipe(pipefd))goto failed;
    value->wake_read=pipefd[0];value->wake_write=pipefd[1];if(flagged(pipefd[0])||flagged(pipefd[1]))goto failed;
    value->fd=socket(AF_UNIX,SOCK_STREAM,0);if(value->fd<0||flagged(value->fd))goto failed;
    struct sockaddr_un address;memset(&address,0,sizeof(address));address.sun_family=AF_UNIX;memcpy(address.sun_path,path,length+1);
    if(bind(value->fd,(struct sockaddr *)&address,sizeof(address))||chmod(path,0600)||listen(value->fd,32))goto failed;
    if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,&listener_tag)!=napi_ok||napi_wrap(env,object,value,finalize_listener,NULL,NULL)!=napi_ok)goto failed;
    return object;
failed:
    stop_listener(value);free(value);return reject(env,"UNAVAILABLE","native listener initialization failed (endpoint is never removed)");
}

static void execute_accept(napi_env env,void *data) {
    (void)env;inbound_job *job=data;inbound_listener *source=job->listener;
    int fd=-1,control=-1;int64_t now=monotonic_ms();if(now<0){job->failure="accept clock failed";goto done;}int64_t end=now+source->timeout_ms;
    if(wait_fd(job->fd,POLLIN,job->auxiliary,end)){if(errno!=ETIMEDOUT&&errno!=ECANCELED)job->failure="accept wait failed";goto done;}
    if(atomic_load(&source->retired))goto done;
    fd=accept(job->fd,NULL,NULL);if(fd<0||flagged(fd)){job->failure="accept failed";goto done;}
    if(peer_matches(fd,source->peer_uid,source->peer_pid)){job->failure="actual inbound Go UID/PID mismatch";goto done;}
    if(wait_fd(fd,POLLIN,job->auxiliary,end)){job->failure="control descriptor marker timeout";goto done;}
    unsigned char marker=0;union {struct cmsghdr alignment;unsigned char bytes[CMSG_SPACE(sizeof(int)*4)];} ancillary;
    memset(&ancillary,0,sizeof(ancillary));struct iovec io={.iov_base=&marker,.iov_len=1};
    struct msghdr message;memset(&message,0,sizeof(message));message.msg_iov=&io;message.msg_iovlen=1;message.msg_control=ancillary.bytes;message.msg_controllen=sizeof(ancillary.bytes);
    ssize_t got=recvmsg(fd,&message,0);int total=0,unknown=0;
    if(got<0){job->failure="control descriptor receive failed";goto done;}
    for(struct cmsghdr *part=CMSG_FIRSTHDR(&message);part;part=CMSG_NXTHDR(&message,part)){
        if(part->cmsg_level!=SOL_SOCKET||part->cmsg_type!=SCM_RIGHTS||part->cmsg_len<CMSG_LEN(0)){unknown=1;continue;}
        size_t bytes=part->cmsg_len-CMSG_LEN(0);if(bytes%sizeof(int))unknown=1;
        for(size_t at=0;at+sizeof(int)<=bytes;at+=sizeof(int)){int received;memcpy(&received,(unsigned char *)CMSG_DATA(part)+at,sizeof(received));total++;if(total==1)control=received;else close(received);}
    }
    if(got!=1||marker!='L'||total!=1||unknown||(message.msg_flags&MSG_CTRUNC)||flagged(control)||peer_matches(control,source->peer_uid,source->peer_pid)){job->failure="exact native L + one same-peer control descriptor required";goto done;}
    int kind=0; socklen_t kindlen=sizeof(kind);struct sockaddr_un local; socklen_t locallen=sizeof(local);
    if(getsockopt(control,SOL_SOCKET,SO_TYPE,&kind,&kindlen)||kind!=SOCK_STREAM||getsockname(control,(struct sockaddr *)&local,&locallen)||local.sun_family!=AF_UNIX){job->failure="private Unix stream control required";goto done;}
    inbound_peer *peer=calloc(1,sizeof(*peer));if(!peer){job->failure="inbound allocation failed";goto done;}
    peer->data.control_fd=fcntl(fd,F_DUPFD_CLOEXEC,0);if(peer->data.control_fd<0){free(peer);job->failure="owned data duplicate failed";goto done;}
    peer->data.transfer_fd=fd;fd=-1;peer->data.owner_pid=getpid();peer->data.peer_uid=source->peer_uid;peer->data.peer_pid=source->peer_pid;
    peer->channel_fd=control;control=-1;job->peer=peer;
done:
    job->error=errno;if(fd>=0)close(fd);if(control>=0)close(control);close(job->fd);close(job->auxiliary);
}

static void complete_accept(napi_env env,napi_status status,void *data) {
    inbound_job *job=data;atomic_store(&job->listener->busy,0);
    if(job->peer&&(status!=napi_ok||atomic_load(&job->listener->retired))){stop_inbound(job->peer);free(job->peer);job->peer=NULL;}
    if(job->failure||status!=napi_ok)napi_reject_deferred(env,job->deferred,failure_value(env,"DENIED",job->failure?job->failure:"native accept cancelled",job->error));
    else if(!job->peer){napi_value null;napi_get_null(env,&null);napi_resolve_deferred(env,job->deferred,null);}
    else {
        napi_value object;
        if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,&inbound_tag)!=napi_ok||napi_wrap(env,object,job->peer,finalize_inbound,NULL,NULL)!=napi_ok){stop_inbound(job->peer);free(job->peer);napi_reject_deferred(env,job->deferred,failure_value(env,"UNAVAILABLE","inbound branding failed",0));}
        else napi_resolve_deferred(env,job->deferred,object);
    }
    napi_delete_reference(env,job->reference);napi_delete_async_work(env,job->work);free(job);
}
static napi_value accept_inbound(napi_env env,napi_callback_info info) {
    size_t count=1;napi_value args[1],promise,resource;
    if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=1)return reject(env,"DENIED","native listener required");
    inbound_listener *value=tagged(env,args[0],&listener_tag);int idle=0;
    if(!value||value->owner_pid!=getpid()||atomic_load(&value->retired)||!atomic_compare_exchange_strong(&value->busy,&idle,1))return reject(env,"DENIED","listener retired or already accepting");
    inbound_job *job=calloc(1,sizeof(*job));if(!job){atomic_store(&value->busy,0);return reject(env,"UNAVAILABLE","accept allocation failed");}
    job->listener=value;job->fd=fcntl(value->fd,F_DUPFD_CLOEXEC,0);job->auxiliary=fcntl(value->wake_read,F_DUPFD_CLOEXEC,0);
    if(job->fd<0||job->auxiliary<0){if(job->fd>=0)close(job->fd);if(job->auxiliary>=0)close(job->auxiliary);free(job);atomic_store(&value->busy,0);return reject(env,"UNAVAILABLE","accept descriptor duplication failed");}
    napi_create_reference(env,args[0],1,&job->reference);napi_create_promise(env,&job->deferred,&promise);napi_create_string_utf8(env,"ynx-inbound-accept",NAPI_AUTO_LENGTH,&resource);
    if(napi_create_async_work(env,NULL,resource,execute_accept,complete_accept,job,&job->work)!=napi_ok||napi_queue_async_work(env,job->work)!=napi_ok){close(job->fd);close(job->auxiliary);atomic_store(&value->busy,0);napi_delete_reference(env,job->reference);if(job->work)napi_delete_async_work(env,job->work);napi_reject_deferred(env,job->deferred,failure_value(env,"UNAVAILABLE","accept queue failed",0));free(job);}
    return promise;
}
static napi_value retire_listener(napi_env env,napi_callback_info info) {
    size_t count=1;napi_value args[1],result;
    if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=1)return reject(env,"DENIED","listener required");
    inbound_listener *value=tagged(env,args[0],&listener_tag);if(!value||value->owner_pid!=getpid())return reject(env,"DENIED","owned listener required");stop_listener(value);napi_get_undefined(env,&result);return result;
}
static napi_value take_inbound(napi_env env,napi_callback_info info) {
    size_t count=1;napi_value args[1],result;if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=1)return reject(env,"DENIED","inbound required");
    inbound_peer *value=tagged(env,args[0],&inbound_tag);if(!value||atomic_load(&value->retired)||current(&value->data)||value->data.transfer_fd<0)return reject(env,"DENIED","owned inbound descriptor required");
    napi_create_int32(env,value->data.transfer_fd,&result);value->data.transfer_fd=-1;return result;
}
static napi_value retire_inbound(napi_env env,napi_callback_info info) {
    size_t count=1;napi_value args[1],result;if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=1)return reject(env,"DENIED","inbound required");
    inbound_peer *value=tagged(env,args[0],&inbound_tag);if(!value||value->data.owner_pid!=getpid())return reject(env,"DENIED","owned inbound required");stop_inbound(value);napi_get_undefined(env,&result);return result;
}

static void execute_inbound_current(napi_env env,void *data) {
    (void)env;inbound_job *job=data;inbound_peer *value=job->peer;int64_t now=monotonic_ms();
    caller actual_data={.control_fd=job->fd,.transfer_fd=-1,.retired=0,.owner_pid=value->data.owner_pid,.peer_uid=value->data.peer_uid,.peer_pid=value->data.peer_pid};
    if(value->data.owner_pid!=getpid()||atomic_load(&value->retired)||now<0||current(&actual_data)||peer_matches(job->auxiliary,value->data.peer_uid,value->data.peer_pid)){job->failure="inbound current peer retired or mismatched";goto done;}
    int64_t end=now+job->timeout;unsigned char command='C',length[4];
    if(frame_io(job->auxiliary,&command,1,1,end)||frame_io(job->auxiliary,length,4,0,end)){job->failure="original Go Current unavailable";goto done;}
    job->size=big_endian(length);if(job->size<4||job->size>(uint32_t)value->max_frame){job->failure="original Go Current refused or frame out of bounds";goto done;}
    job->payload=malloc(job->size);if(!job->payload){job->failure="current allocation failed";goto done;}
    if(frame_io(job->auxiliary,job->payload,job->size,0,end)){job->failure="original Go Current frame incomplete";goto done;}
    uint32_t meta=big_endian(job->payload);if(!meta||meta>65536||meta>job->size-4||atomic_load(&value->retired)||current(&actual_data)){job->failure="original Current metadata/peer rejected";goto done;}
done:
    job->error=errno;close(job->fd);close(job->auxiliary);
}
static void complete_inbound_current(napi_env env,napi_status status,void *data) {
    inbound_job *job=data;atomic_store(&job->peer->busy,0);
    if(job->failure||status!=napi_ok||atomic_load(&job->peer->retired)){stop_inbound(job->peer);napi_reject_deferred(env,job->deferred,failure_value(env,"DENIED",job->failure?job->failure:"inbound current retired",job->error));}
    else {uint32_t size=big_endian(job->payload);napi_value object,metadata,body;napi_create_object(env,&object);napi_create_buffer_copy(env,size,job->payload+4,NULL,&metadata);napi_create_buffer_copy(env,job->size-4-size,job->payload+4+size,NULL,&body);napi_set_named_property(env,object,"metadata",metadata);napi_set_named_property(env,object,"body",body);napi_resolve_deferred(env,job->deferred,object);}
    free(job->payload);napi_delete_reference(env,job->reference);napi_delete_async_work(env,job->work);free(job);
}
static napi_value inbound_current(napi_env env,napi_callback_info info) {
    size_t count=2;napi_value args[2],promise,resource;uint32_t timeout,budget;
    if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=2)return reject(env,"DENIED","inbound and current budget required");
    inbound_peer *value=tagged(env,args[0],&inbound_tag);int idle=0;
    if(!value||value->data.owner_pid!=getpid()||atomic_load(&value->retired)||value->queries>=64||current(&value->data)||number_field(env,args[1],"timeoutMs",&timeout,30000)||!timeout||number_field(env,args[1],"maxFrameBytes",&budget,(16<<20)+65536)||budget<4||!atomic_compare_exchange_strong(&value->busy,&idle,1))return reject(env,"DENIED","live bounded inbound current required");
    value->queries++;value->max_frame=(int)budget;inbound_job *job=calloc(1,sizeof(*job));if(!job){atomic_store(&value->busy,0);return reject(env,"UNAVAILABLE","current allocation failed");}
    job->peer=value;job->timeout=(int)timeout;job->fd=fcntl(value->data.control_fd,F_DUPFD_CLOEXEC,0);job->auxiliary=fcntl(value->channel_fd,F_DUPFD_CLOEXEC,0);
    if(job->fd<0||job->auxiliary<0){if(job->fd>=0)close(job->fd);if(job->auxiliary>=0)close(job->auxiliary);free(job);atomic_store(&value->busy,0);return reject(env,"UNAVAILABLE","current descriptor duplication failed");}
    napi_create_reference(env,args[0],1,&job->reference);napi_create_promise(env,&job->deferred,&promise);napi_create_string_utf8(env,"ynx-inbound-current",NAPI_AUTO_LENGTH,&resource);
    if(napi_create_async_work(env,NULL,resource,execute_inbound_current,complete_inbound_current,job,&job->work)!=napi_ok||napi_queue_async_work(env,job->work)!=napi_ok){close(job->fd);close(job->auxiliary);atomic_store(&value->busy,0);napi_delete_reference(env,job->reference);if(job->work)napi_delete_async_work(env,job->work);napi_reject_deferred(env,job->deferred,failure_value(env,"UNAVAILABLE","current queue failed",0));free(job);}
    return promise;
}

#ifdef YNX_CALLER_FORK_TESTS
// Test-only binary. The child uses only getpid/close/_exit after fork, never
// V8/N-API, allocation, network dispatch or another thread's runtime state.
static napi_value fork_probe(napi_env env, napi_callback_info info) {
    caller *value = caller_argument(env, info);
    if (!value || current(value)) return reject(env, "DENIED", "current native caller required for fork test");
    pid_t child = fork();
    if (child < 0) return reject(env, "UNAVAILABLE", "isolated fork test unavailable");
    if (child == 0) {
        int refused = current(value) != 0 && errno == EPERM;
        close_owned(value);
        _exit(refused ? 0 : 1);
    }
    int status = 0;
    while (waitpid(child, &status, 0) < 0) {
        if (errno != EINTR) return reject(env, "UNAVAILABLE", "isolated fork test join failed");
    }
    napi_value result;
    napi_get_boolean(env, WIFEXITED(status) && WEXITSTATUS(status) == 0 && current(value) == 0, &result);
    return result;
}
#endif

static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor methods[] = {
        {"connectUnix", NULL, connect_unix, NULL, NULL, NULL, napi_default, NULL},
        {"takeFD", NULL, take_fd, NULL, NULL, NULL, napi_default, NULL},
        {"current", NULL, inspect_current, NULL, NULL, NULL, napi_default, NULL},
        {"retire", NULL, retire, NULL, NULL, NULL, napi_default, NULL},
        {"listenInbound",NULL,listen_inbound,NULL,NULL,NULL,napi_default,NULL},
        {"acceptInbound",NULL,accept_inbound,NULL,NULL,NULL,napi_default,NULL},
        {"retireListener",NULL,retire_listener,NULL,NULL,NULL,napi_default,NULL},
        {"takeInboundFD",NULL,take_inbound,NULL,NULL,NULL,napi_default,NULL},
        {"currentInbound",NULL,inbound_current,NULL,NULL,NULL,napi_default,NULL},
        {"retireInbound",NULL,retire_inbound,NULL,NULL,NULL,napi_default,NULL},
#ifdef YNX_CALLER_FORK_TESTS
        {"forkProbe", NULL, fork_probe, NULL, NULL, NULL, napi_default, NULL},
#endif
    };
    napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
