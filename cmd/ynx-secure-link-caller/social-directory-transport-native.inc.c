/* Included only in the original caller native translation unit. Uses the same
 * L capability, OS-peer checks and exclusive worker flag; no new brand/stdio.
 * SDK sole EARLY_ACK_CONTRACT_R2: Main W74, Node A81, metadata length zero.
 * These frames are transport closure DATA, never a Principal/Source permit. */
typedef struct {
    napi_async_work work;
    napi_deferred deferred;
    napi_ref reference;
    inbound_peer *peer;
    int fd, control, timeout, writing, error;
    int cleanup_error;
    unsigned cleanup_unknown;
    size_t size, progress;
    unsigned char frame[81];
    const char *failure;
} social_directory_job;

static int social_directory_frame(const unsigned char *frame,size_t size,int ack) {
    if(size!=(ack?81u:74u)||frame[0]!=(ack?'A':'W')||big_endian(frame+1)!=(ack?76u:69u)||big_endian(frame+5)!=0||frame[9]!=1)return -1;
    if(ack){
        unsigned closed=frame[74],present=frame[75],kind=frame[76];
        uint32_t code=big_endian(frame+77);
        if(closed>1||present>1||kind>2||(!present&&(kind!=0||code!=0))||(present&&(kind==0||(kind==2&&code!=0))))return -1;
    }
    return 0;
}

static int social_directory_io(social_directory_job *job,int64_t end) {
#ifdef SO_NOSIGPIPE
    if(job->writing){int yes=1;if(setsockopt(job->control,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes)))return -1;}
#endif
    while(job->progress<job->size){
        if(wait_fd(job->control,job->writing?POLLOUT:POLLIN,-1,end))return -1;
        int flags=0;
#ifdef MSG_NOSIGNAL
        flags=MSG_NOSIGNAL;
#endif
        ssize_t n=job->writing?send(job->control,job->frame+job->progress,job->size-job->progress,flags):recv(job->control,job->frame+job->progress,job->size-job->progress,0);
        if(n<0&&(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK))continue;
        if(n<=0){if(!n)errno=ENOTCONN;return -1;}
        job->progress+=(size_t)n;
    }
    return 0;
}

static void social_directory_execute(napi_env env,void *data) {
    (void)env;social_directory_job *job=data;inbound_peer *peer=job->peer;
    caller actual={.control_fd=job->fd,.transfer_fd=-1,.retired=0,.owner_pid=peer->data.owner_pid,.peer_uid=peer->data.peer_uid,.peer_pid=peer->data.peer_pid};
    int64_t now=monotonic_ms();
    if(now<0||actual.owner_pid!=getpid()||atomic_load(&peer->retired)||current(&actual)||peer_matches(job->control,actual.peer_uid,actual.peer_pid)){job->failure="Social original same-channel peer unavailable";goto done;}
    if(social_directory_io(job,now+job->timeout)){job->failure=job->writing?"Social closed ACK incomplete":"Social read-release unavailable or incomplete";goto done;}
    if(social_directory_frame(job->frame,job->size,job->writing)){job->failure="Social exact R2 frame rejected";goto done;}
    if(!job->writing&&(atomic_load(&peer->retired)||current(&actual)||peer_matches(job->control,actual.peer_uid,actual.peer_pid))){job->failure="Social read-release original peer rejected";goto done;}
    /* A is sent only after the actual response loan is physically closed.
     * Its complete write permits Main's immediate fd shutdown. The same owned
     * duplicated fds were checked BEFORE the write and cannot be rebound to a
     * different peer. Expected post-A EOF/retirement is not a partial write or
     * a new permission/current witness; Main still validates A and joins its
     * own descriptors/workers independently. No third frame is introduced. */
done:
    job->error=errno;
    if(close(job->fd)){job->cleanup_unknown|=1;job->cleanup_error=errno;}else job->fd=-1;
    if(close(job->control)){job->cleanup_unknown|=2;if(!job->cleanup_error)job->cleanup_error=errno;}else job->control=-1;
    if(job->cleanup_unknown&&!job->failure){job->failure="Social worker descriptor cleanup unknown";job->error=job->cleanup_error;}
}

static void social_directory_complete(napi_env env,napi_status status,void *data) {
    social_directory_job *job=data;inbound_peer *peer=job->peer;atomic_store(&peer->busy,0);
    if(job->cleanup_unknown){peer->social_cleanup_unknown|=job->cleanup_unknown;if(job->cleanup_unknown&1)peer->social_debt_data_fd=job->fd;if(job->cleanup_unknown&2)peer->social_debt_control_fd=job->control;}
    if(job->failure||status!=napi_ok||(!job->writing&&atomic_load(&peer->retired))){
        stop_inbound(peer);
        napi_value error=failure_value(env,"SOCIAL_CHANNEL_UNKNOWN",job->failure?job->failure:"Social closure worker retired",job->error),progress,raw;
        napi_create_double(env,(double)job->progress,&progress);napi_set_named_property(env,error,job->writing?"bytesWritten":"bytesReceived",progress);
        napi_create_buffer_copy(env,job->progress,job->frame,NULL,&raw);napi_set_named_property(env,error,"frameData",raw);
        if(job->cleanup_unknown){napi_value unknown,number;napi_get_boolean(env,true,&unknown);napi_set_named_property(env,error,"cleanupUnknown",unknown);napi_create_int32(env,job->cleanup_error,&number);napi_set_named_property(env,error,"cleanupErrno",number);}
        napi_reject_deferred(env,job->deferred,error);
    }else{
        napi_value result;
        if(job->writing){peer->social_ack_done=1;napi_get_undefined(env,&result);}
        else{memcpy(peer->social_pair,job->frame+10,64);peer->social_waited=1;napi_create_buffer_copy(env,job->size,job->frame,NULL,&result);}
        napi_resolve_deferred(env,job->deferred,result);
    }
    napi_delete_reference(env,job->reference);napi_delete_async_work(env,job->work);free(job);
}

static napi_value social_directory_start(napi_env env,napi_callback_info info,int writing) {
    size_t count=writing?3u:2u,size=0;napi_value args[3],promise,resource;uint32_t timeout;void *raw=NULL;bool is_buffer=false;
    if(napi_get_cb_info(env,info,&count,args,NULL,NULL)!=napi_ok||count!=(writing?3u:2u)||number_field(env,args[writing?2:1],"timeoutMs",&timeout,30000)||!timeout)return reject(env,"DENIED","Social bounded R2 operation required");
    inbound_peer *peer=tagged(env,args[0],&inbound_tag);int idle=0;
    if(!peer||peer->runtime||peer->data.owner_pid!=getpid()||atomic_load(&peer->retired)||current(&peer->data))return reject(env,"DENIED","Social original L peer required");
    if(writing){
        if(!peer->social_waited||peer->social_ack_selected||napi_is_buffer(env,args[1],&is_buffer)!=napi_ok||!is_buffer||napi_get_buffer_info(env,args[1],&raw,&size)!=napi_ok||social_directory_frame(raw,size,1)||memcmp((unsigned char *)raw+10,peer->social_pair,64))return reject(env,"DENIED","same one original Social W/A pair required");
    }else if(peer->social_wait_selected)return reject(env,"DENIED","Social read-release already selected");
    if(!atomic_compare_exchange_strong(&peer->busy,&idle,1))return reject(env,"DENIED","Social control operation already in flight");
    social_directory_job *job=calloc(1,sizeof(*job));
    if(!job){atomic_store(&peer->busy,0);return reject(env,"UNAVAILABLE","Social worker allocation failed");}
    job->peer=peer;job->writing=writing;job->size=writing?81u:74u;job->timeout=(int)timeout;
    if(writing)memcpy(job->frame,raw,job->size);
    job->fd=fcntl(peer->data.control_fd,F_DUPFD_CLOEXEC,0);job->control=fcntl(peer->channel_fd,F_DUPFD_CLOEXEC,0);
    if(job->fd<0||job->control<0){if(job->fd>=0)close(job->fd);if(job->control>=0)close(job->control);free(job);atomic_store(&peer->busy,0);return reject(env,"UNAVAILABLE","Social owned descriptor duplication failed");}
    if(writing)peer->social_ack_selected=1;else peer->social_wait_selected=1;
    napi_create_reference(env,args[0],1,&job->reference);napi_create_promise(env,&job->deferred,&promise);napi_create_string_utf8(env,"ynx-social-directory-r2",NAPI_AUTO_LENGTH,&resource);
    if(napi_create_async_work(env,NULL,resource,social_directory_execute,social_directory_complete,job,&job->work)!=napi_ok||napi_queue_async_work(env,job->work)!=napi_ok){
        close(job->fd);close(job->control);atomic_store(&peer->busy,0);napi_delete_reference(env,job->reference);if(job->work)napi_delete_async_work(env,job->work);napi_reject_deferred(env,job->deferred,failure_value(env,"UNAVAILABLE","Social worker queue failed",0));free(job);
    }
    return promise;
}
static napi_value social_directory_wait(napi_env env,napi_callback_info info){return social_directory_start(env,info,0);}
static napi_value social_directory_ack(napi_env env,napi_callback_info info){return social_directory_start(env,info,1);}
