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
    int resource_close_selected, resource_close_errno;
    unsigned resource_close_unknown;
    int resource_sideband_selected;
    dev_t original_socket_device;
    ino_t original_socket_inode;
    mode_t original_socket_mode;
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
    unsigned cleanup_unknown;
    int cleanup_number, debt_control_fd, debt_transfer_fd;
} connecting;

static void close_connecting_fds(connecting *job,int control,int transfer) {
    if(control>=0&&close(control)){job->cleanup_unknown|=1;job->cleanup_number=errno;job->debt_control_fd=control;}
    if(transfer>=0&&close(transfer)){job->cleanup_unknown|=2;if(!job->cleanup_number)job->cleanup_number=errno;job->debt_transfer_fd=transfer;}
}

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
    // The resource successor records each actual close once. An indeterminate
    // close must never be replayed by a legacy retire/finalizer on a reused fd.
    if (value->resource_close_selected) return;
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
    if (!value->resource_close_unknown) free(value);
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
    struct stat original;
    if(fstat(control,&original)||!S_ISSOCK(original.st_mode)){
        free(value);job->failure="original Unix socket identity unavailable";goto failed;
    }
    value->original_socket_device=original.st_dev;value->original_socket_inode=original.st_ino;value->original_socket_mode=original.st_mode;
    job->value = value;
    return;
failed:
    job->error_number = errno;
    close_connecting_fds(job,control,fd);
}

static void complete_connect(napi_env env, napi_status status, void *data) {
    connecting *job = data;
    if (status != napi_ok || !job->value) {
        if (job->value) { (void)shutdown(job->value->control_fd,SHUT_RDWR);close_connecting_fds(job,job->value->control_fd,job->value->transfer_fd);free(job->value); }
        napi_value error=failure_value(env,"UNAVAILABLE",job->failure?job->failure:"native connect work cancelled",job->error_number);
        if(job->cleanup_unknown){napi_value value;napi_get_boolean(env,true,&value);napi_set_named_property(env,error,"cleanupUnknown",value);napi_create_int32(env,job->cleanup_number,&value);napi_set_named_property(env,error,"cleanupErrno",value);}
        napi_reject_deferred(env,job->deferred,error);
    } else {
        napi_value object;
        if (napi_create_object(env, &object) != napi_ok ||
            napi_type_tag_object(env, object, &caller_tag) != napi_ok ||
            napi_wrap(env, object, job->value, finalize, NULL, NULL) != napi_ok) {
            (void)shutdown(job->value->control_fd,SHUT_RDWR);close_connecting_fds(job,job->value->control_fd,job->value->transfer_fd);free(job->value);
            napi_value error=failure_value(env,"UNAVAILABLE","native caller branding failed",0);
            if(job->cleanup_unknown){napi_value value;napi_get_boolean(env,true,&value);napi_set_named_property(env,error,"cleanupUnknown",value);napi_create_int32(env,job->cleanup_number,&value);napi_set_named_property(env,error,"cleanupErrno",value);}
            napi_reject_deferred(env,job->deferred,error);
        } else {
            napi_resolve_deferred(env, job->deferred, object);
        }
    }
    napi_delete_async_work(env, job->work);
    // A failed actual close is an owned numeric descriptor debt, not a retry
    // instruction. Keep this private record even if no caller was published.
    if(!job->cleanup_unknown)free(job);
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

// Terminal HTTP framing is not a live-connection Current. P08 deliberately
// closes its original HTTP connection after a complete response. The private
// resource owner may call this ONLY after observing incoming.complete: it
// verifies the same retained kernel endpoint, not HUP liveness or any Source.
// All prewrite/in-flight gates continue to use the original strict current().
static napi_value inspect_task_read_resource_peer(napi_env env,napi_callback_info info) {
    caller *value=caller_argument(env,info);uid_t uid=(uid_t)-1;pid_t pid=-1;
    const char *phase=NULL;int number=0,available=0,ended=0;struct stat original;memset(&original,0,sizeof(original));
    if(!value)phase="original-allocation";
    else if(value->owner_pid!=getpid())phase="original-process";
    else if(value->retired||value->resource_close_selected)phase="original-retired";
    else if(value->control_fd<0)phase="original-descriptor";
    else if(fstat(value->control_fd,&original)){phase="original-socket-syscall";number=errno;}
    else if(!S_ISSOCK(original.st_mode))phase="original-socket-type";
    else if(original.st_dev!=value->original_socket_device)phase="original-socket-device";
    else if(original.st_ino!=value->original_socket_inode)phase="original-socket-inode";
    // Socket permission/read-write bits change on Darwin after orderly FIN
    // (actual 0140666 -> 0140000). They are not object identity. Compare the
    // socket type plus the same retained object's device/inode, not those bits.
    else if((original.st_mode&S_IFMT)!=(value->original_socket_mode&S_IFMT))phase="original-socket-mode";
    if(!phase&&peer_identity(value->control_fd,&uid,&pid)){
        number=errno;phase="terminal-peer-syscall";
        // Darwin LOCAL_PEERPID reports ENOTCONN after normal server FIN.
        // This is not a live-peer success or a fresh identity observation.
        // The caller's exclusive native allocation has retained this same fd
        // since actual UID/PID capture and strict prewrite Current. It has not
        // closed/transferred/reconnected it. Require actual EOF on that same
        // socket plus the original fstat, and report the observation honestly.
        if(number==ENOTCONN){
            unsigned char byte;ssize_t n=recv(value->control_fd,&byte,1,MSG_PEEK|MSG_DONTWAIT);
            if(n==0){ended=1;phase=NULL;uid=value->peer_uid;pid=value->peer_pid;}
        }
    }else if(!phase){
        available=1;
        if(uid!=value->peer_uid)phase="terminal-peer-uid";
        else if(pid!=value->peer_pid)phase="terminal-peer-pid";
    }
    if(phase){
        napi_value error=failure_value(env,"DENIED","same original resource endpoint required",number),part;
        napi_create_string_utf8(env,phase,NAPI_AUTO_LENGTH,&part);napi_set_named_property(env,error,"phase",part);
        napi_create_int32(env,(int32_t)pid,&part);napi_set_named_property(env,error,"observedPID",part);
        if(value){char identity[192];snprintf(identity,sizeof(identity),"device=%llu inode=%llu mode=%u",(unsigned long long)value->original_socket_device,(unsigned long long)value->original_socket_inode,(unsigned)value->original_socket_mode);napi_create_string_utf8(env,identity,NAPI_AUTO_LENGTH,&part);napi_set_named_property(env,error,"expectedSocketIdentity",part);snprintf(identity,sizeof(identity),"device=%llu inode=%llu mode=%u",(unsigned long long)original.st_dev,(unsigned long long)original.st_ino,(unsigned)original.st_mode);napi_create_string_utf8(env,identity,NAPI_AUTO_LENGTH,&part);napi_set_named_property(env,error,"observedSocketIdentity",part);}
        napi_throw(env,error);return NULL;
    }
    napi_value result,flag;napi_create_object(env,&result);
    set_number(env,result,"selfPID",(uint32_t)getpid());set_number(env,result,"selfUID",(uint32_t)geteuid());
    set_number(env,result,"peerPID",(uint32_t)pid);set_number(env,result,"peerUID",(uint32_t)uid);
    napi_get_boolean(env,false,&flag);napi_set_named_property(env,result,"livenessProved",flag);
    napi_get_boolean(env,available!=0,&flag);napi_set_named_property(env,result,"peerIdentityAvailable",flag);
    napi_get_boolean(env,ended!=0,&flag);napi_set_named_property(env,result,"terminalEOFObserved",flag);
    return result;
}

// Separate physical close observations for the finite3 resource successor.
// Same native allocation/tag; no new authority/Source brand. Unknown numeric
// descriptors stay in this retained allocation and are never closed again.
static napi_value retire_task_read_resource(napi_env env,napi_callback_info info) {
    caller *value=caller_argument(env,info);
    if(!value||value->owner_pid!=getpid())return reject(env,"DENIED","same original resource caller required");
    if(!value->resource_close_selected){
        value->resource_close_selected=1;value->retired=1;
        if(value->control_fd>=0&&shutdown(value->control_fd,SHUT_RDWR)&&errno!=ENOTCONN)
            value->resource_close_errno=errno;
        if(value->transfer_fd>=0){
            if(close(value->transfer_fd)){value->resource_close_unknown|=1;if(!value->resource_close_errno)value->resource_close_errno=errno;}
            else value->transfer_fd=-1;
        }
        if(value->control_fd>=0){
            if(close(value->control_fd)){value->resource_close_unknown|=2;if(!value->resource_close_errno)value->resource_close_errno=errno;}
            else value->control_fd=-1;
        }
    }
    napi_value result,flag;napi_create_object(env,&result);
    napi_get_boolean(env,value->resource_close_unknown==0,&flag);napi_set_named_property(env,result,"physicalDone",flag);
    napi_get_boolean(env,value->resource_close_errno!=0||value->resource_close_unknown!=0,&flag);napi_set_named_property(env,result,"errorPresent",flag);
    set_number(env,result,"errorNumber",(uint32_t)value->resource_close_errno);
    set_number(env,result,"unknownCloseBits",value->resource_close_unknown);
    return result;
}

// Same caller allocation and actual data UDS, with a NEW socketpair. A dup of
// control_fd is NOT a sideband: the receiver must get exactly one SCM_RIGHTS
// descriptor and marker R before its one original execute HTTP request.
static int wait_fd(int fd,short events,int wake,int64_t end);
typedef struct {
    napi_async_work work;napi_deferred deferred;napi_ref reference;
    int data_fd,node_fd,transfer_fd,timeout,error,marker_written;
    unsigned cleanup_unknown;int cleanup_error;
    pid_t owner_pid,peer_pid;uid_t peer_uid;
    const char *failure;
} task_read_sideband_job;

static void task_read_sideband_close(task_read_sideband_job *job,int *fd,unsigned bit) {
    if(*fd<0)return;
    if(close(*fd)){job->cleanup_unknown|=bit;if(!job->cleanup_error)job->cleanup_error=errno;}
    else *fd=-1;
}
static void task_read_sideband_execute(napi_env env,void *data) {
    (void)env;task_read_sideband_job *job=data;
    caller actual={.control_fd=job->data_fd,.transfer_fd=-1,.owner_pid=job->owner_pid,.peer_uid=job->peer_uid,.peer_pid=job->peer_pid};
    int64_t now=monotonic_ms();
    if(now<0||current(&actual)){job->failure="original resource peer unavailable before R";goto done;}
#ifdef SO_NOSIGPIPE
    {int yes=1;if(setsockopt(job->data_fd,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes))){job->failure="resource R signal guard failed";goto done;}}
#endif
    for(;;){
        if(wait_fd(job->data_fd,POLLOUT,-1,now+job->timeout)){job->failure="resource R write deadline";goto done;}
        unsigned char marker=0x52;_Alignas(struct cmsghdr) unsigned char rights[CMSG_SPACE(sizeof(int))];memset(rights,0,sizeof(rights));
        struct iovec iov={.iov_base=&marker,.iov_len=1};
        struct msghdr message={0};message.msg_iov=&iov;message.msg_iovlen=1;message.msg_control=rights;message.msg_controllen=sizeof(rights);
        struct cmsghdr *cmsg=CMSG_FIRSTHDR(&message);cmsg->cmsg_level=SOL_SOCKET;cmsg->cmsg_type=SCM_RIGHTS;cmsg->cmsg_len=CMSG_LEN(sizeof(int));memcpy(CMSG_DATA(cmsg),&job->transfer_fd,sizeof(int));
        int flags=0;
#ifdef MSG_NOSIGNAL
        flags=MSG_NOSIGNAL;
#endif
        ssize_t n=sendmsg(job->data_fd,&message,flags);
        if(n<0&&(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK))continue;
        if(n!=1){job->failure="resource R descriptor transfer incomplete";goto done;}
        job->marker_written=1;break;
    }
    if(current(&actual))job->failure="original resource peer unavailable after R";
done:
    job->error=errno;
    task_read_sideband_close(job,&job->data_fd,1);
    task_read_sideband_close(job,&job->transfer_fd,2);
    if(job->cleanup_unknown&&!job->failure){job->failure="resource sideband worker close unknown";job->error=job->cleanup_error;}
}
static void task_read_sideband_complete(napi_env env,napi_status status,void *data) {
    task_read_sideband_job *job=data;napi_value out,part,error;
    if(status!=napi_ok&&!job->failure)job->failure="resource sideband worker cancelled";
    napi_create_object(env,&out);
    napi_create_int32(env,job->node_fd,&part);napi_set_named_property(env,out,"fd",part);
    napi_get_boolean(env,job->marker_written!=0,&part);napi_set_named_property(env,out,"markerWritten",part);
    napi_get_boolean(env,job->cleanup_unknown!=0,&part);napi_set_named_property(env,out,"cleanupUnknown",part);
    napi_get_boolean(env,job->failure!=NULL,&part);napi_set_named_property(env,out,"errorPresent",part);
    if(job->failure)error=failure_value(env,"RESOURCE_CONTROL_UNKNOWN",job->failure,job->error);
    else napi_get_null(env,&error);
    if(job->cleanup_unknown){napi_get_boolean(env,true,&part);napi_set_named_property(env,error,"cleanupUnknown",part);napi_create_int32(env,job->cleanup_error,&part);napi_set_named_property(env,error,"cleanupErrno",part);}
    napi_set_named_property(env,out,"error",error);
    // fd ownership is transferred only in this one result, even on a partial
    // error. JS must adopt it before inspecting errorPresent.
    napi_resolve_deferred(env,job->deferred,out);job->node_fd=-1;
    if(job->reference)napi_delete_reference(env,job->reference);
    if(job->work)napi_delete_async_work(env,job->work);
    if(!job->cleanup_unknown)free(job); // Retain unknown numeric fd debts once.
}
static napi_value open_task_read_sideband(napi_env env,napi_callback_info info) {
    size_t n=2;napi_value args[2],promise,resource;uint32_t timeout;
    if(napi_get_cb_info(env,info,&n,args,NULL,NULL)!=napi_ok||n!=2||number_field(env,args[1],"timeoutMs",&timeout,30000)||!timeout)
        return reject(env,"DENIED","bounded original resource sideband required");
    caller *value=unwrap(env,args[0]);
    if(!value||value->resource_sideband_selected||current(value))return reject(env,"DENIED","one original resource sideband required");
    task_read_sideband_job *job=calloc(1,sizeof(*job));
    if(!job)return reject(env,"UNAVAILABLE","resource sideband allocation failed");
    job->data_fd=job->node_fd=job->transfer_fd=-1;job->timeout=(int)timeout;
    job->owner_pid=value->owner_pid;job->peer_uid=value->peer_uid;job->peer_pid=value->peer_pid;
    if(napi_create_promise(env,&job->deferred,&promise)!=napi_ok||napi_create_reference(env,args[0],1,&job->reference)!=napi_ok){free(job);return reject(env,"UNAVAILABLE","resource sideband owner retention failed");}
    value->resource_sideband_selected=1;
    int pair[2];
    if(socketpair(AF_UNIX,SOCK_STREAM,0,pair)){job->failure="resource socketpair failed";goto failed;}
    job->node_fd=pair[0];job->transfer_fd=pair[1];
    if(fcntl(pair[0],F_SETFD,FD_CLOEXEC)||fcntl(pair[0],F_SETFL,O_NONBLOCK)||fcntl(pair[1],F_SETFD,FD_CLOEXEC)||fcntl(pair[1],F_SETFL,O_NONBLOCK)){
        job->failure="resource socketpair flags failed";goto failed;
    }
    job->data_fd=fcntl(value->control_fd,F_DUPFD_CLOEXEC,0);
    if(job->data_fd<0){job->failure="resource data descriptor retention failed";goto failed;}
    if(napi_create_string_utf8(env,"ynx-task-read-resource-sideband",NAPI_AUTO_LENGTH,&resource)!=napi_ok||
       napi_create_async_work(env,NULL,resource,task_read_sideband_execute,task_read_sideband_complete,job,&job->work)!=napi_ok||
       napi_queue_async_work(env,job->work)!=napi_ok){job->failure="resource sideband queue failed";goto failed;}
    return promise;
failed:
    job->error=errno;task_read_sideband_close(job,&job->data_fd,1);task_read_sideband_close(job,&job->transfer_fd,2);
    task_read_sideband_complete(env,napi_ok,job);return promise;
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
// Ordinary Go HTTP runtime custody is NOT a sealed TLS authority ingress.
// Separate native tags and marker prevent either profile borrowing the other.
static const napi_type_tag runtime_listener_tag = {0x9fb52e7cae417830ULL,0x4f0719a1da63bc25ULL};
static const napi_type_tag runtime_peer_tag = {0x8320c479ae56d1f0ULL,0xa1638f205bc94d72ULL};
typedef struct {
    int fd, wake_read, wake_write, timeout_ms, runtime;
    pid_t owner_pid, peer_pid;
    uid_t peer_uid;
    atomic_int retired, busy;
} inbound_listener;
typedef struct {
    caller data;
    int channel_fd, timeout_ms, max_frame, queries, runtime, runtime_terminal;
    int social_wait_selected, social_waited, social_ack_selected, social_ack_done;
    unsigned social_cleanup_unknown;
    int social_debt_data_fd, social_debt_control_fd;
    unsigned char social_pair[64];
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
static void finalize_inbound(napi_env env,void *data,void *hint){(void)env;(void)hint;inbound_peer *v=data;stop_inbound(v);if(!v->social_cleanup_unknown)free(v);}
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

static napi_value listen_inbound_profile(napi_env env,napi_callback_info info,int runtime) {
    size_t count=1,length=0; napi_value args[1],field,object;
    if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=1)return reject(env,"DENIED","inbound registration required");
    char path[sizeof(((struct sockaddr_un *)0)->sun_path)],parent[sizeof(path)];uint32_t uid,pid,node_uid,timeout;
    if(napi_get_named_property(env,args[0],"socketPath",&field)!=napi_ok||napi_get_value_string_utf8(env,field,NULL,0,&length)!=napi_ok||!length||length>=sizeof(path)||napi_get_value_string_utf8(env,field,path,sizeof(path),&length)!=napi_ok||strlen(path)!=length||path[0]!='/'||
       number_field(env,args[0],"nodeUID",&node_uid,UINT32_MAX)||node_uid!=(uint32_t)geteuid()||number_field(env,args[0],"bridgeUID",&uid,UINT32_MAX)||number_field(env,args[0],"bridgePID",&pid,INT_MAX)||!pid||number_field(env,args[0],"timeoutMs",&timeout,30000)||!timeout)return reject(env,"DENIED","bounded exact inbound registration required");
    memcpy(parent,path,length+1);char *slash=strrchr(parent,'/');if(!slash||slash==parent)return reject(env,"DENIED","private parent required");*slash=0;
    struct stat directory,existing;
    if(lstat(parent,&directory)||!S_ISDIR(directory.st_mode)||directory.st_uid!=geteuid()||(directory.st_mode&077)||lstat(path,&existing)==0||errno!=ENOENT)return reject(env,"DENIED","private parent or unused endpoint required");
    inbound_listener *value=calloc(1,sizeof(*value));if(!value)return reject(env,"UNAVAILABLE","listener allocation failed");
    value->fd=value->wake_read=value->wake_write=-1;value->owner_pid=getpid();value->peer_uid=uid;value->peer_pid=(pid_t)pid;value->timeout_ms=(int)timeout;value->runtime=runtime;
    int pipefd[2];if(pipe(pipefd))goto failed;
    value->wake_read=pipefd[0];value->wake_write=pipefd[1];if(flagged(pipefd[0])||flagged(pipefd[1]))goto failed;
    value->fd=socket(AF_UNIX,SOCK_STREAM,0);if(value->fd<0||flagged(value->fd))goto failed;
    struct sockaddr_un address;memset(&address,0,sizeof(address));address.sun_family=AF_UNIX;memcpy(address.sun_path,path,length+1);
    if(bind(value->fd,(struct sockaddr *)&address,sizeof(address))||chmod(path,0600)||listen(value->fd,32))goto failed;
    if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,runtime?&runtime_listener_tag:&listener_tag)!=napi_ok||napi_wrap(env,object,value,finalize_listener,NULL,NULL)!=napi_ok)goto failed;
    return object;
failed:
    stop_listener(value);free(value);return reject(env,"UNAVAILABLE","native listener initialization failed (endpoint is never removed)");
}
static napi_value listen_inbound(napi_env env,napi_callback_info info){return listen_inbound_profile(env,info,0);}
static napi_value listen_runtime(napi_env env,napi_callback_info info){return listen_inbound_profile(env,info,1);}

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
    if(got!=1||marker!=(source->runtime?'A':'L')||total!=1||unknown||(message.msg_flags&MSG_CTRUNC)||flagged(control)||peer_matches(control,source->peer_uid,source->peer_pid)){job->failure="exact native profile marker + one same-peer control descriptor required";goto done;}
    int kind=0; socklen_t kindlen=sizeof(kind);struct sockaddr_un local; socklen_t locallen=sizeof(local);
    if(getsockopt(control,SOL_SOCKET,SO_TYPE,&kind,&kindlen)||kind!=SOCK_STREAM||getsockname(control,(struct sockaddr *)&local,&locallen)||local.sun_family!=AF_UNIX){job->failure="private Unix stream control required";goto done;}
    inbound_peer *peer=calloc(1,sizeof(*peer));if(!peer){job->failure="inbound allocation failed";goto done;}
    peer->data.control_fd=fcntl(fd,F_DUPFD_CLOEXEC,0);if(peer->data.control_fd<0){free(peer);job->failure="owned data duplicate failed";goto done;}
    peer->data.transfer_fd=fd;fd=-1;peer->data.owner_pid=getpid();peer->data.peer_uid=source->peer_uid;peer->data.peer_pid=source->peer_pid;
    peer->channel_fd=control;peer->runtime=source->runtime;control=-1;job->peer=peer;
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
        if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,job->peer->runtime?&runtime_peer_tag:&inbound_tag)!=napi_ok||napi_wrap(env,object,job->peer,finalize_inbound,NULL,NULL)!=napi_ok){stop_inbound(job->peer);free(job->peer);napi_reject_deferred(env,job->deferred,failure_value(env,"UNAVAILABLE","inbound branding failed",0));}
        else napi_resolve_deferred(env,job->deferred,object);
    }
    napi_delete_reference(env,job->reference);napi_delete_async_work(env,job->work);free(job);
}
static napi_value accept_inbound_profile(napi_env env,napi_callback_info info,int runtime) {
    size_t count=1;napi_value args[1],promise,resource;
    if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=1)return reject(env,"DENIED","native listener required");
    inbound_listener *value=tagged(env,args[0],runtime?&runtime_listener_tag:&listener_tag);int idle=0;
    if(!value||value->owner_pid!=getpid()||atomic_load(&value->retired)||!atomic_compare_exchange_strong(&value->busy,&idle,1))return reject(env,"DENIED","listener retired or already accepting");
    inbound_job *job=calloc(1,sizeof(*job));if(!job){atomic_store(&value->busy,0);return reject(env,"UNAVAILABLE","accept allocation failed");}
    job->listener=value;job->fd=fcntl(value->fd,F_DUPFD_CLOEXEC,0);job->auxiliary=fcntl(value->wake_read,F_DUPFD_CLOEXEC,0);
    if(job->fd<0||job->auxiliary<0){if(job->fd>=0)close(job->fd);if(job->auxiliary>=0)close(job->auxiliary);free(job);atomic_store(&value->busy,0);return reject(env,"UNAVAILABLE","accept descriptor duplication failed");}
    napi_create_reference(env,args[0],1,&job->reference);napi_create_promise(env,&job->deferred,&promise);napi_create_string_utf8(env,"ynx-inbound-accept",NAPI_AUTO_LENGTH,&resource);
    if(napi_create_async_work(env,NULL,resource,execute_accept,complete_accept,job,&job->work)!=napi_ok||napi_queue_async_work(env,job->work)!=napi_ok){close(job->fd);close(job->auxiliary);atomic_store(&value->busy,0);napi_delete_reference(env,job->reference);if(job->work)napi_delete_async_work(env,job->work);napi_reject_deferred(env,job->deferred,failure_value(env,"UNAVAILABLE","accept queue failed",0));free(job);}
    return promise;
}
static napi_value accept_inbound(napi_env env,napi_callback_info info){return accept_inbound_profile(env,info,0);}
static napi_value accept_runtime(napi_env env,napi_callback_info info){return accept_inbound_profile(env,info,1);}
static napi_value retire_listener_profile(napi_env env,napi_callback_info info,int runtime) {
    size_t count=1;napi_value args[1],result;
    if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=1)return reject(env,"DENIED","listener required");
    inbound_listener *value=tagged(env,args[0],runtime?&runtime_listener_tag:&listener_tag);if(!value||value->owner_pid!=getpid())return reject(env,"DENIED","owned listener required");stop_listener(value);napi_get_undefined(env,&result);return result;
}
static napi_value retire_listener(napi_env env,napi_callback_info info){return retire_listener_profile(env,info,0);}
static napi_value retire_runtime_listener(napi_env env,napi_callback_info info){return retire_listener_profile(env,info,1);}
static napi_value take_inbound_profile(napi_env env,napi_callback_info info,int runtime) {
    size_t count=1;napi_value args[1],result;if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=1)return reject(env,"DENIED","inbound required");
    inbound_peer *value=tagged(env,args[0],runtime?&runtime_peer_tag:&inbound_tag);if(!value||atomic_load(&value->retired)||current(&value->data)||value->data.transfer_fd<0)return reject(env,"DENIED","owned inbound descriptor required");
    napi_create_int32(env,value->data.transfer_fd,&result);value->data.transfer_fd=-1;return result;
}
static napi_value take_inbound(napi_env env,napi_callback_info info){return take_inbound_profile(env,info,0);}
static napi_value take_runtime(napi_env env,napi_callback_info info){return take_inbound_profile(env,info,1);}
static napi_value retire_inbound_profile(napi_env env,napi_callback_info info,int runtime) {
    size_t count=1;napi_value args[1],result;if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=1)return reject(env,"DENIED","inbound required");
    inbound_peer *value=tagged(env,args[0],runtime?&runtime_peer_tag:&inbound_tag);if(!value||value->data.owner_pid!=getpid())return reject(env,"DENIED","owned inbound required");stop_inbound(value);napi_get_undefined(env,&result);return result;
}
static napi_value retire_inbound(napi_env env,napi_callback_info info){return retire_inbound_profile(env,info,0);}
static napi_value retire_runtime(napi_env env,napi_callback_info info){return retire_inbound_profile(env,info,1);}

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
static napi_value inbound_current_profile(napi_env env,napi_callback_info info,int runtime) {
    size_t count=2;napi_value args[2],promise,resource;uint32_t timeout,budget;
    if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=2)return reject(env,"DENIED","inbound and current budget required");
    inbound_peer *value=tagged(env,args[0],runtime?&runtime_peer_tag:&inbound_tag);int idle=0;
    if(!value||value->data.owner_pid!=getpid()||atomic_load(&value->retired)||(runtime&&value->runtime_terminal)||(!runtime&&value->social_wait_selected)||value->queries>=64||current(&value->data)||number_field(env,args[1],"timeoutMs",&timeout,30000)||!timeout||number_field(env,args[1],"maxFrameBytes",&budget,(16<<20)+65536)||budget<4||!atomic_compare_exchange_strong(&value->busy,&idle,1))return reject(env,"DENIED","live bounded inbound current required");
    value->queries++;value->max_frame=(int)budget;inbound_job *job=calloc(1,sizeof(*job));if(!job){atomic_store(&value->busy,0);return reject(env,"UNAVAILABLE","current allocation failed");}
    job->peer=value;job->timeout=(int)timeout;job->fd=fcntl(value->data.control_fd,F_DUPFD_CLOEXEC,0);job->auxiliary=fcntl(value->channel_fd,F_DUPFD_CLOEXEC,0);
    if(job->fd<0||job->auxiliary<0){if(job->fd>=0)close(job->fd);if(job->auxiliary>=0)close(job->auxiliary);free(job);atomic_store(&value->busy,0);return reject(env,"UNAVAILABLE","current descriptor duplication failed");}
    napi_create_reference(env,args[0],1,&job->reference);napi_create_promise(env,&job->deferred,&promise);napi_create_string_utf8(env,"ynx-inbound-current",NAPI_AUTO_LENGTH,&resource);
    if(napi_create_async_work(env,NULL,resource,execute_inbound_current,complete_inbound_current,job,&job->work)!=napi_ok||napi_queue_async_work(env,job->work)!=napi_ok){close(job->fd);close(job->auxiliary);atomic_store(&value->busy,0);napi_delete_reference(env,job->reference);if(job->work)napi_delete_async_work(env,job->work);napi_reject_deferred(env,job->deferred,failure_value(env,"UNAVAILABLE","current queue failed",0));free(job);}
    return promise;
}
static napi_value inbound_current(napi_env env,napi_callback_info info){return inbound_current_profile(env,info,0);}
static napi_value runtime_current(napi_env env,napi_callback_info info){return inbound_current_profile(env,info,1);}

#include "social-directory-transport-native.inc.c"

typedef struct {
    napi_async_work work;
    napi_deferred deferred;
    napi_ref reference;
    inbound_peer *peer;
    int fd, control, timeout, error, dispatched, valid_response, status, error_present;
    uint32_t request_size, response_size, response_limit, operation;
    size_t written, received;
    unsigned char *request, *response;
    const char *failure;
} runtime_job;

static int runtime_io(int fd,unsigned char *bytes,size_t length,int writing,int64_t end,size_t *progress) {
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
        ssize_t n=writing?send(fd,bytes+at,length-at,flags):recv(fd,bytes+at,length-at,0);
        if(n<0&&(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK))continue;
        if(n<=0){if(!n)errno=ENOTCONN;return -1;}
        at+=(size_t)n;*progress+=(size_t)n;
    }
    return 0;
}
static void runtime_number(napi_env env,napi_value object,const char *name,double number) {
    napi_value value;napi_create_double(env,number,&value);napi_set_named_property(env,object,name,value);
}
static void runtime_boolean(napi_env env,napi_value object,const char *name,int yes) {
    napi_value value;napi_get_boolean(env,yes!=0,&value);napi_set_named_property(env,object,name,value);
}
static napi_value runtime_response(napi_env env,runtime_job *job,int complete) {
    napi_value object,body;napi_create_object(env,&object);
    runtime_number(env,object,"statusCode",job->status);
    runtime_boolean(env,object,"errorPresent",job->error_present);
    runtime_boolean(env,object,"complete",complete);
    runtime_boolean(env,object,"dataOnly",1);
    size_t size=job->received>3?job->received-3:0;
    napi_create_buffer_copy(env,size,size?job->response+3:NULL,NULL,&body);
    napi_set_named_property(env,object,"body",body);return object;
}
static void execute_runtime(napi_env env,void *data) {
    (void)env;runtime_job *job=data;inbound_peer *value=job->peer;int64_t now=monotonic_ms();
    caller actual={.control_fd=job->fd,.transfer_fd=-1,.owner_pid=value->data.owner_pid,.peer_uid=value->data.peer_uid,.peer_pid=value->data.peer_pid};
    if(value->data.owner_pid!=getpid()||atomic_load(&value->retired)||now<0||current(&actual)||peer_matches(job->control,value->data.peer_uid,value->data.peer_pid)){job->failure="runtime original peer unavailable";goto done;}
    int64_t end=now+job->timeout;unsigned char header[6]={'T',(unsigned char)job->operation,(unsigned char)(job->request_size>>24),(unsigned char)(job->request_size>>16),(unsigned char)(job->request_size>>8),(unsigned char)job->request_size},length[4];
    job->dispatched=1; // Once a T write is attempted, no failure proves no effect.
    if(runtime_io(job->control,header,sizeof(header),1,end,&job->written)||runtime_io(job->control,job->request,job->request_size,1,end,&job->written)){job->failure="runtime original request write failed";goto done;}
    size_t prefix=0;
    if(runtime_io(job->control,length,4,0,end,&prefix)){job->failure="runtime original acknowledgement unavailable";goto done;}
    job->response_size=big_endian(length);
    if(job->response_size<3||job->response_size>job->response_limit+3){job->failure="runtime response frame bounds refused";goto done;}
    job->response=malloc(job->response_size);if(!job->response){job->failure="runtime response allocation failed";goto done;}
    if(runtime_io(job->control,job->response,3,0,end,&job->received)){job->failure="runtime response header incomplete";goto done;}
    job->status=((int)job->response[0]<<8)|job->response[1];job->error_present=job->response[2];
    if(job->status<100||job->status>599||job->error_present>1){job->failure="runtime response status or error flag refused";goto done;}
    job->valid_response=1;
    if(runtime_io(job->control,job->response+3,job->response_size-3,0,end,&job->received)){job->failure="runtime response body incomplete";goto done;}
    if(atomic_load(&value->retired)||current(&actual)||peer_matches(job->control,value->data.peer_uid,value->data.peer_pid)){job->failure="runtime original peer retired after exchange";goto done;}
done:
    job->error=errno;close(job->fd);close(job->control);
}
static void complete_runtime(napi_env env,napi_status status,void *data) {
    runtime_job *job=data;atomic_store(&job->peer->busy,0);
    if(job->failure||status!=napi_ok||atomic_load(&job->peer->retired)){
        stop_inbound(job->peer);
        napi_value error=failure_value(env,"RUNTIME_UNAVAILABLE",job->failure?job->failure:"runtime original request retired",job->error),progress;
        runtime_boolean(env,error,"dispatchPossible",job->dispatched);
        napi_create_object(env,&progress);runtime_number(env,progress,"requestBytesWritten",(double)job->written);runtime_number(env,progress,"bytesReceived",job->received>3?(double)(job->received-3):0);napi_set_named_property(env,error,"responseProgress",progress);
        if(job->valid_response)napi_set_named_property(env,error,"responseData",runtime_response(env,job,0));
        napi_reject_deferred(env,job->deferred,error);
    }else{
        if(job->operation==8)job->peer->runtime_terminal=1;
        napi_resolve_deferred(env,job->deferred,runtime_response(env,job,1));
    }
    free(job->request);free(job->response);napi_delete_reference(env,job->reference);napi_delete_async_work(env,job->work);free(job);
}
static napi_value exchange_runtime(napi_env env,napi_callback_info info) {
    size_t count=4,size=0;napi_value args[4],promise,resource;uint32_t operation,timeout,limit;double operation_number;void *bytes=NULL;bool buffer=false;
    if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=4||napi_get_value_double(env,args[1],&operation_number)!=napi_ok||operation_number<1||operation_number>8||napi_get_value_uint32(env,args[1],&operation)!=napi_ok||operation_number!=(double)operation||napi_is_buffer(env,args[2],&buffer)!=napi_ok||!buffer||napi_get_buffer_info(env,args[2],&bytes,&size)!=napi_ok||!size||size>(1<<20)||number_field(env,args[3],"timeoutMs",&timeout,30000)||!timeout||number_field(env,args[3],"maxResponseBytes",&limit,32<<20)||!limit)return reject(env,"DENIED","bounded closed runtime operation required");
    inbound_peer *value=tagged(env,args[0],&runtime_peer_tag);int idle=0;
    if(!value||value->data.owner_pid!=getpid()||atomic_load(&value->retired)||value->runtime_terminal||value->queries>=64||current(&value->data)||!atomic_compare_exchange_strong(&value->busy,&idle,1))return reject(env,"DENIED","same live runtime request required");
    value->queries++;runtime_job *job=calloc(1,sizeof(*job));if(!job){atomic_store(&value->busy,0);return reject(env,"UNAVAILABLE","runtime allocation failed");}
    job->peer=value;job->operation=operation;job->request_size=(uint32_t)size;job->timeout=(int)timeout;job->response_limit=limit;
    job->request=malloc(size);job->fd=fcntl(value->data.control_fd,F_DUPFD_CLOEXEC,0);job->control=fcntl(value->channel_fd,F_DUPFD_CLOEXEC,0);
    if(!job->request||job->fd<0||job->control<0){if(job->fd>=0)close(job->fd);if(job->control>=0)close(job->control);free(job->request);free(job);atomic_store(&value->busy,0);return reject(env,"UNAVAILABLE","runtime owned allocation failed");}
    memcpy(job->request,bytes,size);
    napi_create_reference(env,args[0],1,&job->reference);napi_create_promise(env,&job->deferred,&promise);napi_create_string_utf8(env,"ynx-original-task-runtime",NAPI_AUTO_LENGTH,&resource);
    if(napi_create_async_work(env,NULL,resource,execute_runtime,complete_runtime,job,&job->work)!=napi_ok||napi_queue_async_work(env,job->work)!=napi_ok){close(job->fd);close(job->control);free(job->request);atomic_store(&value->busy,0);napi_delete_reference(env,job->reference);if(job->work)napi_delete_async_work(env,job->work);napi_reject_deferred(env,job->deferred,failure_value(env,"UNAVAILABLE","runtime worker queue failed",0));free(job);}
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
        {"inspectOriginalTaskReadResourcePeer",NULL,inspect_task_read_resource_peer,NULL,NULL,NULL,napi_default,NULL},
        {"retireOriginalTaskReadResource",NULL,retire_task_read_resource,NULL,NULL,NULL,napi_default,NULL},
        {"openTaskReadResourceSideband",NULL,open_task_read_sideband,NULL,NULL,NULL,napi_default,NULL},
        {"waitSocialDirectoryReadRelease",NULL,social_directory_wait,NULL,NULL,NULL,napi_default,NULL},
        {"writeSocialDirectoryClosedAck",NULL,social_directory_ack,NULL,NULL,NULL,napi_default,NULL},
        {"listenTaskRuntime",NULL,listen_runtime,NULL,NULL,NULL,napi_default,NULL},
        {"acceptTaskRuntime",NULL,accept_runtime,NULL,NULL,NULL,napi_default,NULL},
        {"retireTaskRuntimeListener",NULL,retire_runtime_listener,NULL,NULL,NULL,napi_default,NULL},
        {"takeTaskRuntimeFD",NULL,take_runtime,NULL,NULL,NULL,napi_default,NULL},
        {"currentTaskRuntime",NULL,runtime_current,NULL,NULL,NULL,napi_default,NULL},
        {"exchangeTaskRuntime",NULL,exchange_runtime,NULL,NULL,NULL,napi_default,NULL},
        {"retireTaskRuntime",NULL,retire_runtime,NULL,NULL,NULL,napi_default,NULL},
#ifdef YNX_CALLER_FORK_TESTS
        {"forkProbe", NULL, fork_probe, NULL, NULL, NULL, napi_default, NULL},
#endif
    };
    napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
