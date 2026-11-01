/* PUBLIC controlled caller only. This main is never part of a Native image,
 * NAPI module or product factory. Its argv are test DATA from the original
 * P09 owner's pinned fixture plus the parent's actual spawned child PID.
 * It exercises the SAME frozen private client/header, not a second protocol
 * implementation, a profile JSON installer or an Auth/Root Source provider.
 */
#ifndef YNX_LINK_RESOURCE_CURRENT_HELD_TEST_CALLER
#error Compile this PUBLIC caller only with YNX_LINK_RESOURCE_CURRENT_HELD_TEST_CALLER
#endif
#include "resource_current_client_v2.h"
#include "resource-current-peer.hpp"
#include "resource-current-held-identity.hpp"
#include <array>
#include <atomic>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <limits>
#include <string>
#include <sys/stat.h>
#include <unistd.h>

namespace {
struct PublicFence {
    std::atomic<int> borrows{0}, releases{0};
    static int32_t current(void *p) { return static_cast<PublicFence *>(p)->borrows.load() == 1 ? 0 : 61; }
    static int32_t retain(void *p) { int zero = 0;return static_cast<PublicFence *>(p)->borrows.compare_exchange_strong(zero, 1) ? 0 : 62; }
    static void release(void *p) { auto *s = static_cast<PublicFence *>(p);s->releases.fetch_add(1);s->borrows.fetch_sub(1); }
};
bool decimal(const char *text, uint64_t maximum, uint64_t &out) {
    const size_t size = std::strlen(text);if (!size || size > 20 || (size > 1 && text[0] == '0')) return false;
    uint64_t n = 0;for (size_t i = 0; i < size; ++i) {
        const char c = text[i];if (c < '0' || c > '9' || n > (maximum - static_cast<unsigned>(c - '0')) / 10) return false;
        n = n * 10 + static_cast<unsigned>(c - '0');
    }
    if (!n || n > maximum) return false;out = n;return true;
}
bool copy(char *to, size_t capacity, const char *from) {
    size_t size = std::strlen(from);if (!size || size >= capacity) return false;std::memcpy(to, from, size + 1);return true;
}
bool digest(const char *text, uint8_t out[32]) {
    if (std::strlen(text) != 64) return false;
    for (size_t i = 0; i < 32; ++i) {
        unsigned value = 0;for (size_t j = 0; j < 2; ++j) {
            char c = text[2 * i + j];unsigned digit;
            if (c >= '0' && c <= '9') digit = static_cast<unsigned>(c - '0');
            else if (c >= 'a' && c <= 'f') digit = static_cast<unsigned>(c - 'a' + 10);
            else return false;
            value = value * 16 + digit;
        }
        out[i] = static_cast<uint8_t>(value);
    }
    return true;
}
bool persist(int directory, const std::string &name, const uint8_t *bytes, size_t size) {
    int fd = ::openat(directory, name.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) return false;
    size_t at = 0;bool ok = true;
    while (at < size) {
        ssize_t written = ::write(fd, bytes + at, size - at);
        if (written > 0) at += static_cast<size_t>(written);
        else if (written < 0 && errno == EINTR) continue;
        else { ok = false;break; }
    }
    const int close_result = ::close(fd);
    return ok && close_result == 0;
}
bool chunked(const ynx_link_resource_current_packet_v1 &p) {
    std::string headers(reinterpret_cast<const char *>(p.headers_original), p.headers_original_size);
    for (char &c : headers) if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
    return headers.find("\r\ntransfer-encoding: chunked\r\n") != std::string::npos;
}
}

int main(int argc,char **argv){
    if(argc!=11){std::cerr<<"PUBLIC held fixture only: socket spawnedPID pinnedImage imageBytes imageSHA source instance resource normal|chunked ownedOutput\n";return 2;}
    ynx_link_resource_current_profile_v2 profile{};profile.version=2;profile.size=sizeof(profile);auto &p=profile.peer;p.version=1;p.size=sizeof(p);p.peer_uid=::geteuid();p.timeout_ms=10000;
    uint64_t pid=0;std::string mode(argv[9]);
    if(!decimal(argv[2],std::numeric_limits<int32_t>::max(),pid)||!decimal(argv[4],128ULL<<20,p.image_bytes)||!digest(argv[5],p.image_sha256)||!copy(p.socket_path,sizeof(p.socket_path),argv[1])||!copy(p.image_path,sizeof(p.image_path),argv[3])||!copy(p.source_id,sizeof(p.source_id),argv[6])||!copy(p.instance_id,sizeof(p.instance_id),argv[7])||!copy(p.resource_key,sizeof(p.resource_key),argv[8])||(mode!="normal"&&mode!="chunked"))return 2;
    p.peer_pid=static_cast<int32_t>(pid);std::string failure;
    using namespace ynx::resource_current_detail;
    ProcessStart start;HeldProcessIdentity server,caller;
    if(!process_start(p.peer_pid,start,failure)||!observe_held_process(p.peer_pid,server,failure)||!observe_held_process(::getpid(),caller,failure)||server.image_path!=p.image_path||server.image_sha256!=argv[5]||server.uid!=p.peer_uid||!copy(profile.expected_server_start_identity,sizeof(profile.expected_server_start_identity),server.start_identity.c_str()))return 3;
    p.start_kind=start.kind;p.start_a=start.a;p.start_b=start.b;
    uint64_t bytes=0;std::array<uint8_t,32> hash{};
    if(!image_digest(p.image_path,bytes,hash.data(),failure)||bytes!=p.image_bytes||std::memcmp(hash.data(),p.image_sha256,32))return 3;
    struct stat info{};if(::lstat(argv[10],&info)||!S_ISDIR(info.st_mode)||info.st_uid!=::geteuid()||(info.st_mode&07777)!=0700)return 3;
    int directory=::open(argv[10],O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(directory<0)return 3;
    auto *root=new PublicFence;
    ynx_link_private_client_source_fence_v1 fence{root,PublicFence::current,PublicFence::retain,PublicFence::release};
    ynx_link_resource_current_client_v2 *client=nullptr;
    const ynx_link_resource_current_packet_v2 *packet=nullptr;
    const ResourceIdentity expected{p.source_id,p.instance_id,p.resource_key};CurrentData before;
    std::array<size_t,2> sizes{};size_t reads=0;bool saw_chunked=false,ok=true;std::string session;
    auto adopt=[&](const char *name,HeldAction action,bool data,size_t index){
        if(!packet)return false;
        const auto &t=packet->transport;
        bool saved_body=persist(directory,std::string(name)+".body",t.body,t.body_size);
        bool saved_headers=persist(directory,std::string(name)+".headers",t.headers_original,t.headers_original_size);
        HeldReply reply;bool accepted=t.packet_present&&t.body_complete&&t.status_code==200&&decode_held_response(std::string(reinterpret_cast<const char*>(t.body),t.body_size),t.request_id,p.peer_uid,::getpid(),expected,server,caller,action,reply,failure);
        if(accepted){if(session.empty())session=reply.observation.session_id;else accepted=session==reply.observation.session_id;}
        if(accepted&&data){
            ++reads;sizes[index]=t.body_size;saw_chunked=saw_chunked||chunked(t);
            accepted=t.valid_current_data&&reply.has_data&&reply.code=="DATA_ONLY";
            if(accepted&&index)accepted=before.epoch==reply.data.epoch&&before.sequence==reply.data.sequence&&before.head==reply.data.head&&before.issued_at_ms<=reply.data.issued_at_ms;
            if(accepted&&!index)before=reply.data;
            if(mode=="chunked")accepted=accepted&&t.body_size>2048&&chunked(t);
        }
        if(accepted&&!data){accepted=!reply.has_data;switch(action){case HeldAction::retire:accepted=accepted&&reply.code=="RETIRED";break;case HeldAction::join:accepted=accepted&&reply.code=="DRAINED";break;case HeldAction::close:accepted=accepted&&reply.code=="CLOSED";break;case HeldAction::current:accepted=false;break;}}
        bool released=ynx_link_resource_current_release_packet_v2(client,packet)==0;packet=nullptr;
        return saved_body&&saved_headers&&accepted&&released;
    };
    int code=ynx_link_resource_current_open_v2(&profile,&fence,&client,&packet);
    bool first_adopted=packet?adopt("response-0",HeldAction::current,true,0):false;ok=code==0&&client&&first_adopted;
    if(ok){code=ynx_link_resource_current_read_v2(client,&packet);bool adopted=packet?adopt("response-1",HeldAction::current,true,1):false;ok=code==0&&adopted;}
    int retire_code=0,join_code=0,close_code=0,free_code=5;uint8_t joined=0,physical=0;
    if(client){
        retire_code=ynx_link_resource_current_retire_v2(client,&packet);bool adopted=packet?adopt("retire",HeldAction::retire,false,0):false;ok=ok&&retire_code==0&&adopted;
        if(adopted){
            join_code=ynx_link_resource_current_join_v2(client,10000,&joined,&packet);bool joined_packet=packet?adopt("join",HeldAction::join,false,0):false;
            ok=ok&&join_code==5&&!joined&&joined_packet;
            if(joined_packet){join_code=ynx_link_resource_current_join_v2(client,0,&joined,&packet);ok=ok&&join_code==0&&joined&&packet==nullptr;}
        }
        if(joined){
            close_code=ynx_link_resource_current_close_v2(client,&physical,&packet);bool closed_packet=packet?adopt("close",HeldAction::close,false,0):false;
            ok=ok&&close_code==5&&!physical&&closed_packet&&root->borrows.load()==1&&root->releases.load()==0;
            if(closed_packet){close_code=ynx_link_resource_current_close_v2(client,&physical,&packet);ok=ok&&close_code==0&&physical&&packet==nullptr;}
        }
    }
    ynx_link_resource_current_lifetime_v2 life{};int native=0,system=0,first=client?ynx_link_resource_current_first_error_v2(client,&native,&system):code;
    if(client)(void)ynx_link_resource_current_get_lifetime_v2(client,&life);
    if(client&&physical)free_code=ynx_link_resource_current_free_v2(client);
    const bool drained=joined&&physical&&free_code==0&&life.remote_close_ack&&life.local_physical_complete&&!life.remote_unknown&&root->borrows.load()==0&&root->releases.load()==1;
    ok=ok&&drained&&first==0&&reads==2&&session.size()>0;if(::close(directory))ok=false;
    std::cout<<"{\"PUBLIC\":true,\"transportOnly\":true,\"heldVersion\":2,\"passed\":"<<(ok?"true":"false")<<",\"sameNativeClient\":true,\"readCount\":"<<reads<<",\"bodyBytes\":["<<sizes[0]<<','<<sizes[1]<<"],\"chunkedObserved\":"<<(saw_chunked?"true":"false")<<",\"sameSession\":"<<(!session.empty()?"true":"false")<<",\"drained\":"<<(drained?"true":"false")<<",\"remoteCloseAck\":"<<(life.remote_close_ack?"true":"false")<<",\"remoteUnknown\":"<<(life.remote_unknown?"true":"false")<<",\"firstCode\":"<<first<<",\"nativeCode\":"<<native<<",\"systemErrno\":"<<system<<",\"retireCode\":"<<retire_code<<",\"joinCode\":"<<join_code<<",\"closeCode\":"<<close_code<<",\"nativeReleaseCount\":"<<root->releases.load()<<",\"actualAuthFence\":false,\"RootAdmission\":false,\"SourceAdmission\":false}\n";
    return ok?0:1;
}
