#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "resource-current-held-identity.hpp"
#include "resource-current-peer.hpp"
#include <array>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#include <libproc.h>
#else
#include <openssl/evp.h>
#endif

namespace ynx::resource_current_detail {
namespace {
bool deny(std::string &failure, const char *reason) { failure = reason;return false; }
struct File {
    int fd = -1;
    ~File() { if (fd >= 0) ::close(fd); }
    bool finish() { int original = fd;fd = -1;return original < 0 || ::close(original) == 0; }
};
bool fingerprint(int fd, uint8_t digest[32], std::string &failure) {
    struct stat before{}, after{};
    if (::fstat(fd, &before) || !S_ISREG(before.st_mode) || before.st_size <= 0 || static_cast<uint64_t>(before.st_size) > (128ULL << 20))
        return deny(failure, "bounded original observed image required");
#if defined(__APPLE__)
    CC_SHA256_CTX context;if (CC_SHA256_Init(&context) != 1) return false;
#else
    struct Context { EVP_MD_CTX *value = EVP_MD_CTX_new();~Context() { EVP_MD_CTX_free(value); } } context;
    if (!context.value || EVP_DigestInit_ex(context.value, EVP_sha256(), nullptr) != 1) return false;
#endif
    std::array<uint8_t, 16384> buffer{};
    off_t at = 0;
    while (at < before.st_size) {
        size_t count = buffer.size();if (before.st_size - at < static_cast<off_t>(count)) count = static_cast<size_t>(before.st_size - at);
        ssize_t size = ::pread(fd, buffer.data(), count, at);
        if (size < 0 && errno == EINTR) continue;
        if (size <= 0) return deny(failure, "original observed image short read");
#if defined(__APPLE__)
        if (CC_SHA256_Update(&context, buffer.data(), static_cast<CC_LONG>(size)) != 1) return false;
#else
        if (EVP_DigestUpdate(context.value, buffer.data(), static_cast<size_t>(size)) != 1) return false;
#endif
        at += size;
    }
    uint8_t extra;
    if (::pread(fd, &extra, 1, at) != 0 || ::fstat(fd, &after) || before.st_dev != after.st_dev || before.st_ino != after.st_ino || before.st_size != after.st_size)
        return deny(failure, "original observed image changed");
#if defined(__APPLE__)
    if (before.st_mtimespec.tv_sec != after.st_mtimespec.tv_sec || before.st_mtimespec.tv_nsec != after.st_mtimespec.tv_nsec ||
        before.st_ctimespec.tv_sec != after.st_ctimespec.tv_sec || before.st_ctimespec.tv_nsec != after.st_ctimespec.tv_nsec || CC_SHA256_Final(digest, &context) != 1) return false;
#else
    unsigned bytes = 0;
    if (before.st_mtim.tv_sec != after.st_mtim.tv_sec || before.st_mtim.tv_nsec != after.st_mtim.tv_nsec ||
        before.st_ctim.tv_sec != after.st_ctim.tv_sec || before.st_ctim.tv_nsec != after.st_ctim.tv_nsec ||
        EVP_DigestFinal_ex(context.value, digest, &bytes) != 1 || bytes != 32) return false;
#endif
    return true;
}
std::string hex(const uint8_t digest[32]) {
    static const char letters[] = "0123456789abcdef";std::string result;result.reserve(64);
    for (size_t i = 0; i < 32; ++i) { result.push_back(letters[digest[i] >> 4]);result.push_back(letters[digest[i] & 15]); }
    return result;
}
#if defined(__linux__)
bool boot_id(std::string &out) {
    File file;file.fd = ::open("/proc/sys/kernel/random/boot_id", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);if (file.fd < 0) return false;
    std::array<char, 38> value{};ssize_t size = ::read(file.fd, value.data(), value.size());
    if (size == 37 && value[36] == '\n') --size;
    if (size != 36) return false;
    for (size_t i = 0; i < 36; ++i) {
        bool hyphen = i == 8 || i == 13 || i == 18 || i == 23;
        if (hyphen ? value[i] != '-' : !((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f'))) return false;
    }
    out.assign(value.data(), 36);return file.finish();
}
#endif
}
bool same_held_process(const HeldProcessIdentity &a, const HeldProcessIdentity &b) {
    return a.pid == b.pid && a.uid == b.uid && a.start_identity == b.start_identity && a.image_path == b.image_path && a.image_sha256 == b.image_sha256;
}
bool observe_held_process(int32_t pid, HeldProcessIdentity &out, std::string &failure) {
    ProcessStart before, after;
    if (pid <= 0 || !process_start(pid, before, failure)) return false;
    HeldProcessIdentity result;result.pid = pid;
    File file, directory;
#if defined(__APPLE__)
    struct proc_bsdinfo info{};
    std::array<char, PROC_PIDPATHINFO_MAXSIZE> path{};
    if (::proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info) || info.pbi_pid != static_cast<uint32_t>(pid) ||
        ::proc_pidpath(pid, path.data(), static_cast<uint32_t>(path.size())) <= 0) return deny(failure, "native observed process unavailable");
    result.uid = info.pbi_uid;result.image_path = path.data();
    result.start_identity = "darwin:" + std::to_string(before.a) + ":" + std::to_string(before.b);
    file.fd = ::open(path.data(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
#else
    std::string name = "/proc/" + std::to_string(pid);directory.fd = ::open(name.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    struct stat proc{};if (directory.fd < 0 || ::fstat(directory.fd, &proc)) return deny(failure, "native original proc directory unavailable");
    result.uid = proc.st_uid;
    std::array<char, 4096> path{};ssize_t size = ::readlinkat(directory.fd, "exe", path.data(), path.size());
    if (size <= 0 || size >= static_cast<ssize_t>(path.size())) return deny(failure, "native executable path unavailable");
    result.image_path.assign(path.data(), static_cast<size_t>(size));
    // Follow only this held proc directory's kernel executable magic link.
    file.fd = ::openat(directory.fd, "exe", O_RDONLY | O_CLOEXEC);
    std::string boot;if (!boot_id(boot)) return deny(failure, "native boot identity unavailable");
    result.start_identity = "linux:" + boot + ":" + std::to_string(before.a);
#endif
    std::array<uint8_t, 32> digest{};
    if (file.fd < 0 || !fingerprint(file.fd, digest.data(), failure) || !process_start(pid, after, failure) ||
        before.kind != after.kind || before.a != after.a || before.b != after.b) return deny(failure, "native process identity changed while observed");
    result.image_sha256 = hex(digest.data());
    if (!file.finish() || !directory.finish()) return deny(failure, "native identity descriptor close unknown");
    out = std::move(result);failure.clear();return true;
}
}
