#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "resource_current_client_v2.h"
#include "resource-current-peer.hpp"
#include "resource-current-held-identity.hpp"
#include "resource-current-held-bound.hpp"
#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <fcntl.h>
#include <map>
#include <memory>
#include <mutex>
#include <poll.h>
#include <string>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

// The bounded HTTP entity reader below is reused verbatim from frozen r1.
// Only P09's original four held-reader operations/observations are added.
namespace {
using Clock = std::chrono::steady_clock;
using namespace ynx::resource_current_detail;
constexpr int denied=1,bounds=2,unavailable=3,cancelled=4,draining=5,native_current=6,closed=7,protocol=8,timeout=9,remote_unknown=10;
struct State;
struct Slot {
    std::atomic<int> owner_pid{0},ready{0},retired{0},closed{0},freed{0},local_error{0};
    std::mutex mutex;
    std::shared_ptr<State> state;
};
std::array<Slot,1024> slots;
std::atomic<size_t> next_slot{0};
struct Packet {
    ynx_link_resource_current_packet_v2 full{};
    ynx_link_resource_current_packet_v1 &view;
    bool inflight=true;
    std::array<uint8_t,4096> headers{};
    std::array<uint8_t,16385> body{};
    std::array<char,81> id{},session{};
    Packet():view(full.transport){view.headers_original=headers.data();view.body=body.data();view.request_id=id.data();full.session_id=session.data();}
};
struct State {
    Slot *slot;
    const ynx_link_resource_current_profile_v1 profile;
    const ynx_link_resource_current_profile_v2 held_profile;
    const ynx_link_private_client_source_fence_v1 fence;
    const bool endpoint_bound;
    const HeldEndpointBinding original_endpoint;
    std::mutex mutex,first_mutex,fd_lifetime;
    std::condition_variable changed;
    std::atomic<int> fd{-1},first{0};
    std::atomic<bool> lost{false},possible{false},borrow_unknown{false},close_unknown{false};
    int native_first=0,errno_first=0;
    bool fence_held=false,busy=true,joined=false,closing=false;
    uint32_t active=1;
    uint64_t request_serial=0;
    std::string session;
    bool partial=false,remote_retired=false,remote_joined=false,remote_closed=false;
    HeldProcessIdentity server,caller;
    std::unique_ptr<PeerLease> peer;
    struct stat directory_stamp{},socket_stamp{};
    std::map<const ynx_link_resource_current_packet_v2*,std::unique_ptr<Packet>> packets;
    State(Slot *s,const ynx_link_resource_current_profile_v2&p,const ynx_link_private_client_source_fence_v1&f,const HeldEndpointBinding*bound):slot(s),profile(p.peer),held_profile(p),fence(f),endpoint_bound(bound!=nullptr),original_endpoint(bound?*bound:HeldEndpointBinding{}),peer(new PeerLease){}
    void remember(int code,int native=0,int system=0){if(!code)return;std::lock_guard<std::mutex>g(first_mutex);if(!first.load()){native_first=native;errno_first=system;first.store(code,std::memory_order_release);slot->local_error.store(code,std::memory_order_release);}}
};
Slot *cell(ynx_link_resource_current_client_v2 *value){uintptr_t at=reinterpret_cast<uintptr_t>(value),begin=reinterpret_cast<uintptr_t>(slots.data());if(at<begin||at-begin>=sizeof(slots)||(at-begin)%sizeof(Slot))return nullptr;return &slots[(at-begin)/sizeof(Slot)];}
std::shared_ptr<State> pin(ynx_link_resource_current_client_v2*value){Slot*s=cell(value);if(!s||s->owner_pid.load()!=::getpid()||s->freed.load())return {};std::lock_guard<std::mutex>g(s->mutex);return s->state;}
int owned(const std::shared_ptr<State>&s){if(!s||s->slot->owner_pid.load()!=::getpid())return denied;if(s->slot->closed.load()||s->slot->freed.load())return closed;return 0;}
void shutdown_original(const std::shared_ptr<State>&s){if(s->slot->owner_pid.load()!=::getpid())return;std::lock_guard<std::mutex>g(s->fd_lifetime);int fd=s->fd.load();if(fd>=0)(void)::shutdown(fd,SHUT_RDWR);}
void lose(const std::shared_ptr<State>&s,int code,int system=0){s->remember(code,0,system);s->slot->retired.store(1);s->lost.store(true);shutdown_original(s);s->changed.notify_all();}
ynx_link_resource_current_lifetime_v2 lifetime_locked(const std::shared_ptr<State>&s){ynx_link_resource_current_lifetime_v2 v{};v.local_retired=s->slot->retired.load();v.local_joined=s->joined;v.local_physical_complete=s->slot->closed.load();v.remote_acquisition_possible=s->possible.load();v.remote_session_observed=!s->session.empty();v.remote_partial_acquired=s->partial;v.remote_retired_ack=s->remote_retired;v.remote_joined_ack=s->remote_joined;v.remote_close_ack=s->remote_closed;v.remote_unknown=s->lost.load()&&s->possible.load()&&!s->remote_closed;return v;}
void publish_packet(const std::shared_ptr<State>&s,Packet*packet){if(!packet)return;packet->full.lifetime=lifetime_locked(s);if(!s->session.empty())std::memcpy(packet->session.data(),s->session.c_str(),s->session.size()+1);}
struct Active {
    std::shared_ptr<State>s;Packet**packet;bool*started;
    ~Active(){if(!*started)return;std::lock_guard<std::mutex>g(s->mutex);if(*packet){publish_packet(s,*packet);(*packet)->inflight=false;}--s->active;s->busy=false;s->changed.notify_all();}
};
const char *operation(HeldAction a){switch(a){case HeldAction::current:return "resource_current";case HeldAction::retire:return "resource_current_retire";case HeldAction::join:return "resource_current_join";case HeldAction::close:return "resource_current_close";}return "";}
bool text(const char *value, size_t capacity) {
    const size_t size = ::strnlen(value, capacity);
    if (!size || size == capacity) return false;
    return ynx::resource_current_detail::json_impl::identity(std::string(value, size));
}
bool path_text(const char *value, size_t capacity) {
    const size_t size = ::strnlen(value, capacity);
    if (size < 2 || size == capacity || value[0] != '/' || !ynx::resource_current_detail::json_impl::utf8(std::string(value, size))) return false;
    for (size_t i = 0; i < size; ++i) if (static_cast<unsigned char>(value[i]) < 0x20 || value[i] == 0x7f) return false;
    const std::string path(value, size);
    return path.find("//") == std::string::npos && path.find("/../") == std::string::npos && path.find("/./") == std::string::npos &&
        path.size() >= 2 && path.substr(path.size() - 2) != "/." && (path.size() < 3 || path.substr(path.size() - 3) != "/..");
}
bool valid_profile(const ynx_link_resource_current_profile_v1 &p) {
    bool digest = false; for (uint8_t b : p.image_sha256) digest = digest || b != 0;
    if (p.version != 1 || p.size != sizeof(p) || p.peer_pid <= 0 || p.peer_uid != ::geteuid() ||
        !p.start_a || !p.image_bytes || p.image_bytes > (128ULL << 20) || !digest || !p.timeout_ms || p.timeout_ms > 10000 ||
        !path_text(p.socket_path, sizeof(p.socket_path)) || !path_text(p.image_path, sizeof(p.image_path)) ||
        !text(p.source_id, sizeof(p.source_id)) || !text(p.instance_id, sizeof(p.instance_id)) || !text(p.resource_key, sizeof(p.resource_key))) return false;
#if defined(__APPLE__)
    return p.start_kind == YNX_LINK_RESOURCE_CURRENT_DARWIN_START_V1 && p.start_b < 1000000;
#else
    return p.start_kind == YNX_LINK_RESOURCE_CURRENT_LINUX_START_V1 && p.start_b == 0;
#endif
}
bool same_endpoint(const struct stat &a, const struct stat &b) {
    return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_uid == b.st_uid && a.st_mode == b.st_mode;
}
bool endpoint(const std::shared_ptr<State> &s, bool first) {
    std::string path(s->profile.socket_path);const size_t slash = path.rfind('/');
    if (!slash || slash == std::string::npos) return false;
    struct stat directory{}, socket{};
    if (::lstat(path.substr(0, slash).c_str(), &directory) || ::lstat(path.c_str(), &socket) || !S_ISDIR(directory.st_mode) ||
        !S_ISSOCK(socket.st_mode) || directory.st_uid != s->profile.peer_uid || socket.st_uid != s->profile.peer_uid ||
        (directory.st_mode & 07777) != 0700 || (socket.st_mode & 07777) != 0600) return false;
    if (s->endpoint_bound && (static_cast<uint64_t>(directory.st_dev) != s->original_endpoint.directory_device ||
        static_cast<uint64_t>(directory.st_ino) != s->original_endpoint.directory_inode ||
        static_cast<uint64_t>(socket.st_dev) != s->original_endpoint.socket_device ||
        static_cast<uint64_t>(socket.st_ino) != s->original_endpoint.socket_inode)) return false;
    if (first) { s->directory_stamp = directory; s->socket_stamp = socket; return true; }
    return same_endpoint(directory, s->directory_stamp) && same_endpoint(socket, s->socket_stamp);
}
int budget(const std::shared_ptr<State>&s,Clock::time_point end){int code=owned(s);if(code)return code;if(s->lost.load())return remote_unknown;return Clock::now()<end?0:timeout;}
int wait_fd(const std::shared_ptr<State>&s,short event,Clock::time_point end){for(;;){int code=budget(s,end);if(code)return code;auto ms=std::chrono::duration_cast<std::chrono::milliseconds>(end-Clock::now()).count();struct pollfd p{s->fd.load(),event,0};int ready=::poll(&p,1,static_cast<int>(std::max<int64_t>(1,ms)));if(ready<0&&errno==EINTR)continue;if(ready<0)return unavailable;if(!ready)return timeout;if(p.revents&event)return 0;if(p.revents&(POLLERR|POLLHUP|POLLNVAL))return denied;}}
int native_fence(const std::shared_ptr<State>&s){int code=owned(s);if(code)return code;if(s->slot->retired.load())return cancelled;int original=0;try{original=s->fence.current(s->fence.ctx);}catch(...){s->remember(unavailable);s->borrow_unknown.store(true);return unavailable;}if(original){s->remember(native_current,original);s->slot->retired.store(1);return native_current;}return s->slot->retired.load()?cancelled:0;}
int actual_peer(const std::shared_ptr<State>&s,Clock::time_point end){int code=budget(s,end);if(code)return code;if(!endpoint(s,false))return denied;std::string failure;if(!s->peer->current(s->fd.load(),failure))return denied;HeldProcessIdentity server,caller;if(!observe_held_process(s->profile.peer_pid,server,failure)||!same_held_process(server,s->server)||!observe_held_process(::getpid(),caller,failure)||!same_held_process(caller,s->caller))return denied;struct pollfd p{s->fd.load(),POLLIN,0};if(::poll(&p,1,0)<0||(p.revents&(POLLERR|POLLHUP|POLLNVAL)))return denied;if(p.revents&POLLIN){uint8_t b;ssize_t n=::recv(s->fd.load(),&b,1,MSG_PEEK|MSG_DONTWAIT);if(n==0||(n<0&&errno!=EINTR&&errno!=EAGAIN&&errno!=EWOULDBLOCK))return denied;if(n>0)return protocol;}return budget(s,end);}
int receive(const std::shared_ptr<State> &s, uint8_t *to, size_t count, size_t &received, Clock::time_point end) {
    while (received < count) {
        int code = budget(s, end); if (code) return code;
        ssize_t got = ::recv(s->fd.load(), to + received, count - received, 0);
        if (got > 0) { received += static_cast<size_t>(got); continue; }
        if (!got) return denied;
        if (errno == EINTR) continue;
        if (errno != EAGAIN && errno != EWOULDBLOCK) return unavailable;
        if ((code = wait_fd(s, POLLIN, end))) return code;
    }
    return 0;
}
int line(const std::shared_ptr<State> &s, std::string &out, size_t maximum, Clock::time_point end) {
    out.clear();
    while (out.size() < maximum) {
        uint8_t byte = 0;size_t got = 0;int code = receive(s, &byte, 1, got, end);if (code) return code;
        out.push_back(static_cast<char>(byte));
        if (out.size() >= 2 && out.substr(out.size() - 2) == "\r\n") { out.resize(out.size() - 2); return 0; }
    }
    return bounds;
}
std::string lower(std::string value) { for (char &c : value) if (c >= 'A' && c <= 'Z') c += 'a' - 'A'; return value; }
bool decimal(const std::string &value, size_t &out) {
    if (value.empty() || value.size() > 8) return false;
    size_t n = 0;for (char c : value) { if (c < '0' || c > '9') return false; n = n * 10 + static_cast<unsigned>(c - '0'); }
    out = n;return true;
}
int response(const std::shared_ptr<State> &s, Packet &packet, Clock::time_point end) {
    size_t header = 0;
    while (header < packet.headers.size()) {
        size_t got = 0;int code = receive(s, packet.headers.data() + header, 1, got, end);header += got;packet.view.headers_original_size = header;
        if (code) return code;
        if (header >= 4 && std::memcmp(packet.headers.data() + header - 4, "\r\n\r\n", 4) == 0) break;
    }
    if (header == packet.headers.size()) return bounds;
    std::string headers(reinterpret_cast<char *>(packet.headers.data()), header);
    const size_t first = headers.find("\r\n");
    if (first == std::string::npos || first < 12 || headers.compare(0, 9, "HTTP/1.1 ") || headers[9] < '1' || headers[9] > '5' ||
        headers[10] < '0' || headers[10] > '9' || headers[11] < '0' || headers[11] > '9' || (first > 12 && headers[12] != ' ')) return protocol;
    packet.view.status_code = (headers[9] - '0') * 100 + (headers[10] - '0') * 10 + headers[11] - '0';
    packet.view.packet_present = 1;
    bool have_length = false, chunked = false, mime = false;size_t length = 0, at = first + 2;
    std::map<std::string, std::string> fields;
    while (at + 2 < headers.size()) {
        const size_t next = headers.find("\r\n", at);if (next == std::string::npos || next == at) break;
        const size_t colon = headers.find(':', at);if (colon == std::string::npos || colon >= next || colon == at) return protocol;
        std::string name = lower(headers.substr(at, colon - at));
        for (char c : name) if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return protocol;
        size_t begin = colon + 1;while (begin < next && headers[begin] == ' ') ++begin;
        std::string value = headers.substr(begin, next - begin);
        for (char c : value) if (static_cast<unsigned char>(c) < 0x20 || c == 0x7f) return protocol;
        if (!fields.emplace(name, value).second) return protocol;
        at = next + 2;
    }
    if (fields.count("content-length")) { have_length = decimal(fields["content-length"], length);if (!have_length || length > 16384) return bounds; }
    if (fields.count("transfer-encoding")) { chunked = lower(fields["transfer-encoding"]) == "chunked";if (!chunked || have_length) return protocol; }
    if (fields.count("content-encoding")) return protocol;
    mime = fields.count("content-type") && lower(fields["content-type"]) == "application/json";
    if (!mime || (!have_length && !chunked)) return protocol;
    if (have_length) {
        size_t got = 0;int code = receive(s, packet.body.data(), length, got, end);packet.view.body_size = got;packet.view.partial_response_bytes = got;
        if (code) return code;
    } else {
        for (;;) {
            std::string text;int code = line(s, text, 128, end);if (code) return code;
            if (text.empty() || text.size() > 8) return protocol;
            uint64_t size = 0;for (char c : text) {
                int digit = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
                if (digit < 0) return protocol;size = size * 16 + static_cast<unsigned>(digit);
            }
            if (!size) { code = line(s, text, 128, end);if (code) return code;if (!text.empty()) return protocol;break; }
            if (size > 16384 - packet.view.body_size) return bounds;
            size_t got = 0;code = receive(s, packet.body.data() + packet.view.body_size, static_cast<size_t>(size), got, end);
            packet.view.body_size += got;packet.view.partial_response_bytes = packet.view.body_size;if (code) return code;
            code = line(s, text, 2, end);if (code) return code;if (!text.empty()) return protocol;
        }
    }
    packet.view.body_complete = 1;
    return 0;
}
int request(const std::shared_ptr<State>&s,HeldAction action,Packet&packet,Clock::time_point end){
    const char*op=operation(action);std::string body="{\"version\":\"YNX-NETWORK-LOCAL-IPC/v1\",\"id\":\""+std::string(packet.id.data())+"\",\"operation\":\""+op+"\",\"payload\":{}}";
    std::string wire="POST /v1/call HTTP/1.1\r\nHost: localipc\r\nContent-Type: application/json\r\nContent-Length: "+std::to_string(body.size())+"\r\n\r\n"+body;
    int code=actual_peer(s,end);if(code)return code;
    if(action==HeldAction::current&&(code=native_fence(s)))return code;
    size_t at=0;
    while(at<wire.size()){
        if((code=budget(s,end)))return code;
        if(!at){if(action==HeldAction::current&&s->slot->retired.load())return cancelled;packet.view.dispatch_possible=1;if(action==HeldAction::current)s->possible.store(true);}
#if defined(__linux__)
        constexpr int flags=MSG_NOSIGNAL;
#else
        constexpr int flags=0;
#endif
        ssize_t n=::send(s->fd.load(),wire.data()+at,wire.size()-at,flags);if(n>0){at+=static_cast<size_t>(n);continue;}if(n<0&&errno==EINTR)continue;if(n<0&&(errno==EAGAIN||errno==EWOULDBLOCK)){if((code=wait_fd(s,POLLOUT,end)))return code;continue;}return unavailable;
    }
    return response(s,packet,end);
}
int begin(const std::shared_ptr<State>&s,HeldAction action){std::lock_guard<std::mutex>g(s->mutex);int code=owned(s);if(code)return code;if(s->lost.load())return remote_unknown;if(s->busy)return draining;if(action==HeldAction::current&&(s->slot->retired.load()||s->first.load()))return s->first.load()?s->first.load():cancelled;if(s->active==UINT32_MAX)return bounds;++s->active;s->busy=true;s->joined=false;return 0;}
Packet *reserve(const std::shared_ptr<State>&s,HeldAction action,const ynx_link_resource_current_packet_v2**out){std::lock_guard<std::mutex>g(s->mutex);if(s->packets.size()>=32||s->request_serial==UINT64_MAX)return nullptr;auto owned=std::make_unique<Packet>();Packet*p=owned.get();std::string id="lrc2-"+std::to_string(++s->request_serial);std::memcpy(p->id.data(),id.c_str(),id.size()+1);p->full.operation=operation(action);s->packets.emplace(&p->full,std::move(owned));*out=&p->full;return p;}
bool accept_observation(const std::shared_ptr<State>&s,const HeldReply&r){std::lock_guard<std::mutex>g(s->mutex);const auto&o=r.observation;if(!s->session.empty()&&s->session!=o.session_id)return false;if((s->partial&&!o.partial_acquired)||(s->remote_retired&&!o.retired)||(s->remote_joined&&!o.joined)||(s->remote_closed&&!o.physical_complete))return false;if(s->session.empty())s->session=o.session_id;s->partial=o.partial_acquired;s->remote_retired=o.retired;s->remote_joined=o.joined;s->remote_closed=o.physical_complete;return true;}
void packet_error(const std::shared_ptr<State>&s,Packet*p,int code){if(!p)return;p->view.error_code=s->first.load()?s->first.load():code;std::lock_guard<std::mutex>g(s->first_mutex);p->view.native_current_code=s->native_first;p->view.system_errno=s->errno_first;}
int exchange(const std::shared_ptr<State>&s,HeldAction action,Packet*&packet,const ynx_link_resource_current_packet_v2**out,Clock::time_point end){
    packet=reserve(s,action,out);if(!packet)return bounds;
    if(action==HeldAction::current){int code=native_fence(s);if(code){s->remember(code);packet_error(s,packet,code);return code;}}
    int code=request(s,action,*packet,end);
    if(code){if(code==cancelled||code==native_current){s->remember(code);s->slot->retired.store(1);}else lose(s,code,code==unavailable?errno:code==timeout?ETIMEDOUT:0);packet_error(s,packet,code);return code;}
    HeldReply reply;std::string failure;const ResourceIdentity resource{s->profile.source_id,s->profile.instance_id,s->profile.resource_key};
    if(packet->view.status_code!=200||!decode_held_response(std::string(reinterpret_cast<char*>(packet->body.data()),packet->view.body_size),packet->id.data(),s->profile.peer_uid,::getpid(),resource,s->server,s->caller,action,reply,failure)){lose(s,protocol);packet_error(s,packet,protocol);return protocol;}
    if((code=actual_peer(s,end))){lose(s,code,code==unavailable?errno:0);packet_error(s,packet,code);return code;}
    // A claimed CLOSED flag is not acknowledged until the original post-peer
    // check succeeds. Failed provenance must never become cached close truth.
    if(!accept_observation(s,reply)){lose(s,protocol);packet_error(s,packet,protocol);return protocol;}
    if(action==HeldAction::current){
        if(reply.code!="DATA_ONLY"||!reply.has_data)code=unavailable;
        else {auto now=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();if(now<0||reply.data.issued_at_ms>static_cast<uint64_t>(now)||reply.data.expires_at_ms<=static_cast<uint64_t>(now))code=denied;}
        if(!code)code=native_fence(s);
        if(code){s->remember(code);s->slot->retired.store(1);}else packet->view.valid_current_data=1;
    }
    packet_error(s,packet,code);return code?code:s->first.load();
}
int perform(const std::shared_ptr<State>&s,HeldAction action,uint32_t ms,const ynx_link_resource_current_packet_v2**out){Packet*packet=nullptr;bool started=false;Active active{s,&packet,&started};try{int code=begin(s,action);if(code)return code;started=true;return exchange(s,action,packet,out,Clock::now()+std::chrono::milliseconds(ms));}catch(...){if(s->possible.load())lose(s,unavailable);else s->remember(unavailable);packet_error(s,packet,unavailable);return unavailable;}}
std::string hex_digest(const uint8_t digest[32]){static const char d[]="0123456789abcdef";std::string out;out.reserve(64);for(size_t i=0;i<32;++i){out.push_back(d[digest[i]>>4]);out.push_back(d[digest[i]&15]);}return out;}
bool valid_held_profile(const ynx_link_resource_current_profile_v2&p){return p.version==2&&p.size==sizeof(p)&&valid_profile(p.peer)&&::strnlen(p.expected_server_start_identity,sizeof(p.expected_server_start_identity))>0&&::strnlen(p.expected_server_start_identity,sizeof(p.expected_server_start_identity))<sizeof(p.expected_server_start_identity);}
int local_join(const std::shared_ptr<State>&s,uint32_t ms,uint8_t*completed){std::unique_lock<std::mutex>g(s->mutex);if(s->borrow_unknown.load()||s->close_unknown.load())return s->first.load()?s->first.load():unavailable;if(s->possible.load()&&!s->remote_joined)return s->lost.load()?remote_unknown:draining;const auto ready=[&]{return !s->active&&s->packets.empty()&&(!s->closing||s->slot->closed.load());};if(!ready()&&(!ms||!s->changed.wait_for(g,std::chrono::milliseconds(ms),ready)))return draining;s->joined=true;*completed=1;return s->first.load();}
}
static int32_t open_impl_v2(const ynx_link_resource_current_profile_v2*p,const ynx_link_private_client_source_fence_v1*f,const HeldEndpointBinding*bound,ynx_link_resource_current_client_v2**out,const ynx_link_resource_current_packet_v2**out_packet){
    if(!out||!out_packet)return denied;*out=nullptr;*out_packet=nullptr;if(!p||!f||!f->ctx||!f->current||!f->retain||!f->release||!valid_held_profile(*p))return denied;
    std::shared_ptr<State>s;Packet*packet=nullptr;bool started=false;Active active{s,&packet,&started};
    try {
        size_t index=next_slot.load();while(index<slots.size()&&!next_slot.compare_exchange_weak(index,index+1)){}if(index>=slots.size())return bounds;
        Slot&slot=slots[index];s=std::make_shared<State>(&slot,*p,*f,bound);active.s=s;started=true;
        {std::lock_guard<std::mutex>g(slot.mutex);slot.state=s;slot.owner_pid.store(::getpid());}
        *out=reinterpret_cast<ynx_link_resource_current_client_v2*>(&slot);
        int retained=0;try{retained=f->retain(f->ctx);}catch(...){s->borrow_unknown.store(true);s->remember(unavailable);s->slot->retired.store(1);return unavailable;}
        if(retained){s->remember(native_current,retained);s->slot->retired.store(1);return native_current;}s->fence_held=true;
        int code=native_fence(s);if(code){s->slot->retired.store(1);return code;}
        if(!endpoint(s,true)){s->remember(denied,0,errno);s->slot->retired.store(1);return denied;}
        int fd=::socket(AF_UNIX,SOCK_STREAM,0);{std::lock_guard<std::mutex>g(s->fd_lifetime);s->fd.store(fd);}
        if(fd<0||::fcntl(fd,F_SETFD,FD_CLOEXEC)||::fcntl(fd,F_SETFL,O_NONBLOCK)){s->remember(unavailable,0,errno);s->slot->retired.store(1);return unavailable;}
#if defined(__APPLE__)
        int one=1;if(::setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&one,sizeof(one))){s->remember(unavailable,0,errno);s->slot->retired.store(1);return unavailable;}
#endif
        auto end=Clock::now()+std::chrono::milliseconds(s->profile.timeout_ms);struct sockaddr_un address{};address.sun_family=AF_UNIX;std::memcpy(address.sun_path,s->profile.socket_path,std::strlen(s->profile.socket_path)+1);
        if((code=budget(s,end))){s->remember(code);return code;}
        if(::connect(fd,reinterpret_cast<sockaddr*>(&address),sizeof(address))){if(errno!=EINPROGRESS||(code=wait_fd(s,POLLOUT,end))){if(!code)code=unavailable;s->remember(code,0,errno);s->slot->retired.store(1);return code;}int e=0;socklen_t n=sizeof(e);if(::getsockopt(fd,SOL_SOCKET,SO_ERROR,&e,&n)||e){s->remember(unavailable,0,e?e:errno);s->slot->retired.store(1);return unavailable;}}
        std::string failure;HeldProcessIdentity observed;
        if(!endpoint(s,false)||!s->peer->capture(fd,s->profile,failure)||!observe_held_process(s->profile.peer_pid,observed,failure)||
            observed.pid!=s->profile.peer_pid||observed.uid!=s->profile.peer_uid||observed.start_identity!=s->held_profile.expected_server_start_identity||observed.image_path!=s->profile.image_path||observed.image_sha256!=hex_digest(s->profile.image_sha256)||!observe_held_process(::getpid(),s->caller,failure)){
            s->remember(denied);s->slot->retired.store(1);return denied;}
        s->server=std::move(observed);code=exchange(s,HeldAction::current,packet,out_packet,end);if(!code)s->slot->ready.store(1);return code;
    }catch(...){if(s){if(s->possible.load())lose(s,unavailable);else s->remember(unavailable);s->slot->retired.store(1);packet_error(s,packet,unavailable);}return unavailable;}
}
extern "C" int32_t ynx_link_resource_current_open_v2(const ynx_link_resource_current_profile_v2*p,const ynx_link_private_client_source_fence_v1*f,ynx_link_resource_current_client_v2**out,const ynx_link_resource_current_packet_v2**packet){return open_impl_v2(p,f,nullptr,out,packet);}
int32_t ynx::resource_current_detail::open_bound_resource_current_v2(const ynx_link_resource_current_profile_v2*p,const ynx_link_private_client_source_fence_v1*f,const HeldEndpointBinding&bound,ynx_link_resource_current_client_v2**out,const ynx_link_resource_current_packet_v2**packet){return open_impl_v2(p,f,&bound,out,packet);}
extern "C" int32_t ynx_link_resource_current_current_local_v2(ynx_link_resource_current_client_v2*p){Slot*s=cell(p);if(!s||s->owner_pid.load()!=::getpid())return denied;if(s->freed.load()||s->closed.load())return closed;int first=s->local_error.load();return first?first:s->retired.load()?cancelled:!s->ready.load()?unavailable:0;}
extern "C" int32_t ynx_link_resource_current_read_v2(ynx_link_resource_current_client_v2*p,const ynx_link_resource_current_packet_v2**out){if(!out)return denied;*out=nullptr;auto s=pin(p);if(!s)return denied;if(!s->slot->ready.load())return s->first.load()?s->first.load():unavailable;return perform(s,HeldAction::current,s->profile.timeout_ms,out);}
extern "C" int32_t ynx_link_resource_current_release_packet_v2(ynx_link_resource_current_client_v2*p,const ynx_link_resource_current_packet_v2*packet){auto s=pin(p);if(!s||!packet)return denied;std::lock_guard<std::mutex>g(s->mutex);auto it=s->packets.find(packet);if(it==s->packets.end())return denied;if(it->second->inflight)return draining;s->packets.erase(it);s->changed.notify_all();return 0;}
extern "C" int32_t ynx_link_resource_current_retire_v2(ynx_link_resource_current_client_v2*p,const ynx_link_resource_current_packet_v2**out){if(!out)return denied;*out=nullptr;auto s=pin(p);if(!s)return denied;s->slot->retired.store(1);{std::lock_guard<std::mutex>g(s->mutex);if(!s->possible.load()||s->remote_retired)return s->first.load();if(s->lost.load())return remote_unknown;}return perform(s,HeldAction::retire,s->profile.timeout_ms,out);}
extern "C" int32_t ynx_link_resource_current_join_v2(ynx_link_resource_current_client_v2*p,uint32_t ms,uint8_t*complete,const ynx_link_resource_current_packet_v2**out){if(!out||!complete)return denied;*out=nullptr;*complete=0;if(ms>10000)return bounds;auto s=pin(p);if(!s)return denied;if(!s->slot->retired.load())return draining;bool need=false;{std::lock_guard<std::mutex>g(s->mutex);if(s->possible.load()&&!s->remote_joined){if(s->lost.load())return remote_unknown;if(!s->remote_retired||!ms)return draining;need=true;}}if(need){int code=perform(s,HeldAction::join,std::min(ms,s->profile.timeout_ms),out);return code?code:draining;}return local_join(s,ms,complete);}
extern "C" int32_t ynx_link_resource_current_close_v2(ynx_link_resource_current_client_v2*p,uint8_t*complete,const ynx_link_resource_current_packet_v2**out){
    if(!out||!complete)return denied;*out=nullptr;*complete=0;auto s=pin(p);if(!s)return denied;bool need=false;
    {std::lock_guard<std::mutex>g(s->mutex);if(s->slot->closed.load()){*complete=1;return s->first.load();}if(!s->slot->retired.load()||s->active||!s->packets.empty()||s->closing)return draining;if(s->borrow_unknown.load()||s->close_unknown.load())return s->first.load()?s->first.load():unavailable;if(s->possible.load()&&!s->remote_closed){if(s->lost.load())return remote_unknown;if(!s->remote_joined)return draining;need=true;}if(!need){s->joined=true;s->closing=true;}}
    if(need){int code=perform(s,HeldAction::close,s->profile.timeout_ms,out);return code?code:draining;}
    int error=0;{std::lock_guard<std::mutex>g(s->fd_lifetime);int fd=s->fd.exchange(-1);if(fd>=0&&::close(fd))error=errno;}
    std::string failure;if(error||(s->peer&&!s->peer->close(failure))){s->close_unknown.store(true);s->remember(unavailable,0,error);std::lock_guard<std::mutex>g(s->mutex);s->changed.notify_all();return unavailable;}s->peer.reset();
    try{if(s->fence_held){s->fence.release(s->fence.ctx);s->fence_held=false;}}catch(...){s->close_unknown.store(true);s->remember(unavailable);std::lock_guard<std::mutex>g(s->mutex);s->changed.notify_all();return unavailable;}
    {std::lock_guard<std::mutex>g(s->mutex);s->slot->closed.store(1);s->changed.notify_all();}*complete=1;return s->first.load();
}
extern "C" int32_t ynx_link_resource_current_get_lifetime_v2(ynx_link_resource_current_client_v2*p,ynx_link_resource_current_lifetime_v2*out){if(!out)return denied;*out={};auto s=pin(p);if(!s)return denied;std::lock_guard<std::mutex>g(s->mutex);*out=lifetime_locked(s);return 0;}
extern "C" int32_t ynx_link_resource_current_first_error_v2(ynx_link_resource_current_client_v2*p,int32_t*native,int32_t*system){if(!native||!system)return denied;*native=*system=0;auto s=pin(p);if(!s)return denied;std::lock_guard<std::mutex>g(s->first_mutex);*native=s->native_first;*system=s->errno_first;return s->first.load();}
extern "C" int32_t ynx_link_resource_current_free_v2(ynx_link_resource_current_client_v2*p){Slot*s=cell(p);if(!s||s->owner_pid.load()!=::getpid())return denied;std::lock_guard<std::mutex>g(s->mutex);if(!s->state||!s->closed.load())return draining;s->freed.store(1);s->state.reset();return 0;}
