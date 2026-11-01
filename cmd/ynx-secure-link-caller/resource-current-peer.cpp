#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "resource-current-peer.hpp"
#include <algorithm>
#include <array>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <limits>
#include <sstream>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#include <bsm/libbsm.h>
#include <libproc.h>
#include <mach/vm_prot.h>
#include <sys/ucred.h>
#include <sys/un.h>
#elif defined(__linux__)
#include <openssl/evp.h>
#else
#error resource_current requires Darwin or Linux kernel process identity
#endif

namespace ynx::resource_current_detail {
namespace {
constexpr uint64_t image_limit = 128ULL << 20;
struct FD {
    int value = -1;
    ~FD() { if (value >= 0) ::close(value); }
    bool finish() {
        const int original = value;value = -1;
        return original < 0 || ::close(original) == 0;
    }
    FD() = default;
    FD(const FD &) = delete;
    FD &operator=(const FD &) = delete;
};
bool denied(std::string &failure, const char *reason) { failure = reason; return false; }
bool same_file(const struct stat &a, const struct stat &b) {
    return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size &&
#if defined(__APPLE__)
        a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
        a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec;
#else
        a.st_mtim.tv_sec == b.st_mtim.tv_sec && a.st_mtim.tv_nsec == b.st_mtim.tv_nsec &&
        a.st_ctim.tv_sec == b.st_ctim.tv_sec && a.st_ctim.tv_nsec == b.st_ctim.tv_nsec;
#endif
}
bool digest_fd(int fd, uint64_t expected, uint8_t output[32], std::string &failure) {
    struct stat before{}, after{};
    if (::fstat(fd, &before) || !S_ISREG(before.st_mode) || before.st_size <= 0 ||
        static_cast<uint64_t>(before.st_size) > image_limit || static_cast<uint64_t>(before.st_size) != expected)
        return denied(failure, "bounded actual executable file required");
#if defined(__APPLE__)
    CC_SHA256_CTX context;
    if (CC_SHA256_Init(&context) != 1) return denied(failure, "image digest unavailable");
#else
    struct Digest {
        EVP_MD_CTX *p = EVP_MD_CTX_new();
        ~Digest() { EVP_MD_CTX_free(p); }
    } context;
    if (!context.p || EVP_DigestInit_ex(context.p, EVP_sha256(), nullptr) != 1)
        return denied(failure, "image digest unavailable");
#endif
    std::array<uint8_t, 16384> buffer{};
    uint64_t at = 0;
    while (at < expected) {
        size_t count = static_cast<size_t>(std::min<uint64_t>(buffer.size(), expected - at));
        ssize_t size = ::pread(fd, buffer.data(), count, static_cast<off_t>(at));
        if (size < 0 && errno == EINTR) continue;
        if (size <= 0) return denied(failure, "actual executable short read");
#if defined(__APPLE__)
        if (CC_SHA256_Update(&context, buffer.data(), static_cast<CC_LONG>(size)) != 1)
#else
        if (EVP_DigestUpdate(context.p, buffer.data(), static_cast<size_t>(size)) != 1)
#endif
            return denied(failure, "actual executable digest failed");
        at += static_cast<uint64_t>(size);
    }
    uint8_t extra = 0;
    if (::pread(fd, &extra, 1, static_cast<off_t>(expected)) != 0 || ::fstat(fd, &after) || !same_file(before, after))
        return denied(failure, "actual executable changed during digest");
#if defined(__APPLE__)
    if (CC_SHA256_Final(output, &context) != 1) return denied(failure, "actual executable digest failed");
#else
    unsigned size = 0;
    if (EVP_DigestFinal_ex(context.p, output, &size) != 1 || size != 32) return denied(failure, "actual executable digest failed");
#endif
    return true;
}
#if defined(__linux__)
bool linux_start(int directory, ProcessStart &out, std::string &failure) {
    FD file;
    file.value = ::openat(directory, "stat", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (file.value < 0) return denied(failure, "original proc stat unavailable");
    std::array<char, 8193> raw{};
    ssize_t size = ::read(file.value, raw.data(), raw.size());
    if (size <= 0 || size >= static_cast<ssize_t>(raw.size())) return denied(failure, "bounded original proc stat required");
    std::string text(raw.data(), static_cast<size_t>(size));
    const size_t close = text.rfind(')');
    if (close == std::string::npos || close + 2 >= text.size() || text[close + 1] != ' ')
        return denied(failure, "original proc stat malformed");
    std::istringstream fields(text.substr(close + 2));
    std::string value;
    for (unsigned i = 0; i <= 19; ++i) if (!(fields >> value)) return denied(failure, "original process start missing");
    uint64_t ticks = 0;
    if (value.empty()) return denied(failure, "original process start missing");
    for (char c : value) {
        if (c < '0' || c > '9' || ticks > (UINT64_MAX - static_cast<unsigned>(c - '0')) / 10)
            return denied(failure, "original process start invalid");
        ticks = ticks * 10 + static_cast<unsigned>(c - '0');
    }
    if (!ticks) return denied(failure, "original process start invalid");
    out = {YNX_LINK_RESOURCE_CURRENT_LINUX_START_V1, ticks, 0};
    return true;
}
#endif
}

bool process_start(int32_t pid, ProcessStart &out, std::string &failure) {
    if (pid <= 0) return denied(failure, "positive process PID required");
#if defined(__APPLE__)
    struct proc_bsdinfo info{};
    if (::proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info) || info.pbi_pid != static_cast<uint32_t>(pid) ||
        !info.pbi_start_tvsec || info.pbi_start_tvusec >= 1000000)
        return denied(failure, "kernel process start unavailable");
    out = {YNX_LINK_RESOURCE_CURRENT_DARWIN_START_V1, info.pbi_start_tvsec, info.pbi_start_tvusec};
    return true;
#else
    FD directory;
    std::string name = "/proc/" + std::to_string(pid);
    directory.value = ::open(name.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    return directory.value >= 0 ? linux_start(directory.value, out, failure) : denied(failure, "original proc directory unavailable");
#endif
}

bool image_digest(const std::string &path, uint64_t &bytes, uint8_t digest[32], std::string &failure) {
    FD file;
    file.value = ::open(path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    struct stat info{};
    if (file.value < 0 || ::fstat(file.value, &info) || info.st_size <= 0 || static_cast<uint64_t>(info.st_size) > image_limit)
        return denied(failure, "bounded image pin file unavailable");
    const uint64_t size = static_cast<uint64_t>(info.st_size);
    if (!digest_fd(file.value, size, digest, failure)) return false;
    bytes = size;
    return true;
}

struct PeerLease::Impl {
    ynx_link_resource_current_profile_v1 profile{};
    FD image, proc_directory;
    struct stat image_stat{};
    bool captured = false;
    bool close_unknown = false;
#if defined(__APPLE__)
    audit_token_t token{};
    uint64_t region = 0;
#endif
    bool peer(int fd, std::string &failure, bool first) {
        uint32_t uid = 0;
        int32_t pid = 0;
#if defined(__APPLE__)
        struct xucred credentials{};
        socklen_t size = sizeof(credentials);
        if (::getsockopt(fd, SOL_LOCAL, LOCAL_PEERCRED, &credentials, &size) || size != sizeof(credentials) ||
            credentials.cr_version != XUCRED_VERSION) return denied(failure, "original socket credentials unavailable");
        size = sizeof(pid);
        if (::getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) || size != sizeof(pid)) return denied(failure, "original socket PID unavailable");
        uid = credentials.cr_uid;
        audit_token_t actual{};
        size = sizeof(actual);
        if (::getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &actual, &size) || size != sizeof(actual) ||
            audit_token_to_pid(actual) != pid) return denied(failure, "original socket audit identity unavailable");
        if (first) token = actual;
        else if (std::memcmp(&token, &actual, sizeof(token))) return denied(failure, "original socket process generation changed");
#else
        (void)first;
        struct ucred credentials{};
        socklen_t size = sizeof(credentials);
        if (::getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &credentials, &size) || size != sizeof(credentials))
            return denied(failure, "original socket credentials unavailable");
        uid = credentials.uid; pid = credentials.pid;
#endif
        return uid == profile.peer_uid && pid == profile.peer_pid ? true : denied(failure, "original socket UID/PID mismatch");
    }
    bool start(std::string &failure) {
        ProcessStart actual;
#if defined(__APPLE__)
        if (!process_start(profile.peer_pid, actual, failure)) return false;
#else
        if (!linux_start(proc_directory.value, actual, failure)) return false;
#endif
        return actual.kind == profile.start_kind && actual.a == profile.start_a && actual.b == profile.start_b ? true :
            denied(failure, "original process start mismatch");
    }
#if defined(__APPLE__)
    bool mapped_main(std::string &failure, bool first) {
        char path[PROC_PIDPATHINFO_MAXSIZE]{};
        if (::proc_pidpath_audittoken(&token, path, sizeof(path)) <= 0 || std::string(path) != profile.image_path)
            return denied(failure, "original executable audit path changed");
        uint64_t address = first ? 0 : region;
        for (unsigned i = 0; i < (first ? 128U : 1U); ++i) {
            struct proc_regionwithpathinfo info{};
            if (::proc_pidinfo(profile.peer_pid, PROC_PIDREGIONPATHINFO, address, &info, sizeof(info)) != sizeof(info))
                return denied(failure, "original executable vnode region unavailable");
            const auto &map = info.prp_prinfo;
            const auto &node = info.prp_vip.vip_vi.vi_stat;
            if (!map.pri_size || map.pri_address > UINT64_MAX - map.pri_size || map.pri_address + map.pri_size <= address)
                return denied(failure, "original executable region bound invalid");
            if ((map.pri_protection & VM_PROT_EXECUTE) && std::string(info.prp_vip.vip_path) == profile.image_path &&
                node.vst_dev == static_cast<uint32_t>(image_stat.st_dev) && node.vst_ino == image_stat.st_ino &&
                node.vst_size == image_stat.st_size) { region = map.pri_address; return true; }
            address = map.pri_address + map.pri_size;
        }
        return denied(failure, "original main executable vnode not found within bound");
    }
#endif
    bool executable(std::string &failure, bool first) {
        FD actual;
#if defined(__APPLE__)
        if (!mapped_main(failure, first)) return false;
        actual.value = ::open(profile.image_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
#else
        (void)first;
        // This is deliberately the held proc-directory's kernel magic link,
        // not a readlink result reopened as a caller-controlled filesystem path.
        actual.value = ::openat(proc_directory.value, "exe", O_RDONLY | O_CLOEXEC);
        std::array<char, 4096> path{};
        ssize_t size = ::readlinkat(proc_directory.value, "exe", path.data(), path.size());
        if (size <= 0 || size >= static_cast<ssize_t>(path.size()) || std::string(path.data(), static_cast<size_t>(size)) != profile.image_path)
            return denied(failure, "original executable kernel path changed");
#endif
        struct stat info{};
        if (actual.value < 0 || ::fstat(actual.value, &info) || !same_file(info, image_stat))
            return denied(failure, "original executable file identity changed");
        uint8_t digest[32]{};
        if (!digest_fd(actual.value, profile.image_bytes, digest, failure) || std::memcmp(digest, profile.image_sha256, 32))
            return denied(failure, "original executable checksum changed");
        return true;
    }
};

PeerLease::PeerLease() : state(new Impl) {}
PeerLease::~PeerLease() = default;
bool PeerLease::capture(int fd, const ynx_link_resource_current_profile_v1 &profile, std::string &failure) {
    if (state->captured) return denied(failure, "original peer already captured");
    state->profile = profile;
    if (!state->peer(fd, failure, true)) return false;
#if defined(__linux__)
    std::string directory = "/proc/" + std::to_string(profile.peer_pid);
    state->proc_directory.value = ::open(directory.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (state->proc_directory.value < 0) return denied(failure, "original proc-directory lease unavailable");
    state->image.value = ::openat(state->proc_directory.value, "exe", O_RDONLY | O_CLOEXEC);
#else
    char path[PROC_PIDPATHINFO_MAXSIZE]{};
    if (::proc_pidpath_audittoken(&state->token, path, sizeof(path)) <= 0 || std::string(path) != profile.image_path)
        return denied(failure, "original executable audit path mismatch");
    state->image.value = ::open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
#endif
    if (state->image.value < 0 || ::fstat(state->image.value, &state->image_stat) || !S_ISREG(state->image_stat.st_mode))
        return denied(failure, "original executable lease unavailable");
    if (!state->start(failure) || !state->executable(failure, true) || !state->start(failure) || !state->peer(fd, failure, false)) return false;
    state->captured = true;
    return true;
}
bool PeerLease::current(int fd, std::string &failure) {
    if (!state->captured) return denied(failure, "original peer is not captured");
    return state->peer(fd, failure, false) && state->start(failure) && state->executable(failure, false) &&
        state->start(failure) && state->peer(fd, failure, false);
}
bool PeerLease::close(std::string &failure) {
    if (state->close_unknown) return denied(failure, "original peer descriptor close remains unknown");
    const bool image_closed = state->image.finish();
    const bool proc_closed = state->proc_directory.finish();
    state->captured = false;
    if (!image_closed || !proc_closed) {
        state->close_unknown = true;
        return denied(failure, "original peer descriptor close failed; no retry");
    }
    return true;
}
}
