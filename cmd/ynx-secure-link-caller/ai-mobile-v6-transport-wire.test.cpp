#ifndef YNX_LINK_AI_MOBILE_V6_WIRE_PUBLIC_TEST
#error PUBLIC DATA framing controls only; never link this fixture into a producer
#endif
#include "ai-mobile-v6-transport-wire.hpp"
#include <algorithm>
#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

namespace {
namespace wire = ynx::ai_mobile_v6::physical::wire;
std::size_t controls = 0;
void check(bool yes, const char *why) { ++controls;if (!yes) throw std::runtime_error(why); }
const std::string host = "captured.native.test:8443", target = "/v6/original/%2e?q=unchanged";
std::string head(const std::string &method = "GET", const std::string &fields = "", const std::string &path = target) {
    return method + " " + path + " HTTP/1.1\r\nHost: " + host + "\r\n" + fields + "\r\n";
}
bool valid(const std::string &raw, const std::string &method = "GET", std::size_t bytes = 0, std::size_t cap = 262144) {
    std::string why = "old cause";const auto original = raw;
    const bool ok = wire::check_request_head(raw, method, target, host, bytes, cap, why);
    check(raw == original, "checker rewrote original HTTP head");
    check(ok ? why.empty() : !why.empty(), "framing diagnostic stale/missing");return ok;
}
void originalBytes() {
    check(valid(head()), "original GET head rejected");
    check(valid(head("GET", "Content-Length: 0\r\nConnection: close\r\n")), "zero GET framing rejected");
    check(valid(head("POST", "Content-Length: 0\r\n"), "POST"), "empty POST framing rejected");
    std::vector<uint8_t> body{'{', 0, 0xff, '}', '\n'};
    const auto originalBody = body;
    const auto raw = head("POST", "content-length:\t0005 \t\r\nhOsT-Data: original\r\nAuthorization: opaque ORIGINAL  bytes\r\nConnection: CLOSE\r\n");
    check(valid(raw, "POST", body.size()), "original opaque POST framing rejected");
    // This helper has only body_size. It does not inspect, bless, serialize or
    // hash a canonical35/16/E5/body. Native owns the actual immutable body.
    body[0] ^= 1;check(valid(raw, "POST", body.size()), "HTTP helper invented business/body authorization");body = originalBody;
    std::vector<uint8_t> sent(raw.begin(), raw.end());sent.insert(sent.end(), body.begin(), body.end());
    check(std::equal(raw.begin(), raw.end(), sent.begin()) && std::vector<uint8_t>(sent.begin() + static_cast<std::ptrdiff_t>(raw.size()), sent.end()) == originalBody && body == originalBody,
        "original header/body send framing changed bytes");
    std::string why;
    for (const auto &path : {std::string("/not-a-finite7-route"), std::string("/a/../b?x=%2F"), std::string("/")})
        check(wire::check_request_head(head("GET", "", path), "GET", path, host, 0, 262144, why), "HTTP DATA helper imposed finite7 business routes");
}
void refusals() {
    for (const auto &fields : {
        "Host: captured.native.test:8443\r\n", "hOsT: captured.native.test:8443\r\n", "Host : captured.native.test:8443\r\n",
        "Content-Length: 0\r\ncontent-length: 0\r\n", "Content-Length: 0, 0\r\n", "Content-Length: +0\r\n",
        "Content-Length: -0\r\n", "Content-Length: 184467440737095516160\r\n", "Transfer-Encoding: chunked\r\n",
        "Content-Length: 0\r\nTransfer-Encoding: identity\r\n", "TE: trailers\r\n", "Trailer: X-Final\r\n",
        "Upgrade: websocket\r\n", "Proxy-Connection: close\r\n", "Proxy-Authorization: original\r\n",
        "Keep-Alive: timeout=1\r\n", "Expect: 100-continue\r\n", "HTTP2-Settings: data\r\n",
        "Connection: keep-alive\r\n", "Connection: close, X-Original\r\n", "Connection: close\r\nConnection: close\r\n",
        " Bad: folded\r\n", "X-Bad: original\r\n\tcontinued\r\n", "Bad(Name): value\r\n", "X-Bad: value\nInjected: yes\r\n"})
        check(!valid(head("GET", fields)), "ambiguous/hijacked request framing accepted");
    check(!valid(head("GET", "Content-Length: 1\r\n")), "GET declared nonempty body");
    check(!valid(head(), "GET", 1), "GET raw body accepted");
    check(!valid(head("POST"), "POST", 0), "POST missing original length accepted");
    check(!valid(head("POST", "Content-Length: 4\r\n"), "POST", 5), "POST body size mismatch accepted");
    check(!valid(head() + "extra"), "head included trailing body/next request");
    check(!valid(head().substr(0, head().size() - 1)), "incomplete head accepted");
    auto raw = head();raw.replace(raw.find(host), host.size(), "other.native.test");check(!valid(raw), "different captured Host accepted");
    raw = head();raw.replace(raw.find("HTTP/1.1"), 8, "HTTP/1.0");check(!valid(raw), "different HTTP version accepted");
    raw = head();raw.erase(raw.find("Host:"), std::string("Host: " + host + "\r\n").size());check(!valid(raw), "missing Host accepted");
    raw = head("GET", "X-Original: abc\r\n");raw[raw.find("abc")] = '\0';check(!valid(raw), "NUL header value accepted");
    raw = head("GET", "X-Original: abc\r\n");raw[raw.find("abc")] = '\x7f';check(!valid(raw), "DEL header value accepted");
    std::string why;
    for (const auto &method : {"PUT", "CONNECT", "get", "POST\r\nInjected"})
        check(!wire::check_request_head(head(method), method, target, host, 0, 262144, why), "unsupported method accepted");
    for (const auto &path : {std::string("https://other/x"), std::string("//other/x"), std::string("/a#fragment"), std::string("/bad path"),
        std::string("/a\r\nInjected: x"), std::string("/a\0b", 4), std::string("/a\\b"), std::string()})
        check(!wire::check_request_head(head("GET", "", path), "GET", path, host, 0, 262144, why), "non-origin/injected target accepted");
    for (const auto &authority : {"other.native.test", "a@other", "a/path", "a#b", "a\r\nX: yes", "a b", ""})
        check(!wire::check_request_head(head(), "GET", target, authority, 0, 262144, why), "different/injected captured authority accepted");
}
void bounds() {
    constexpr std::size_t maximum = 2U << 20;
    check(valid(head("POST", "Content-Length: " + std::to_string(maximum) + "\r\n"), "POST", maximum), "2MiB POST boundary rejected");
    check(!valid(head("POST", "Content-Length: " + std::to_string(maximum + 1) + "\r\n"), "POST", maximum + 1), "POST hard bound exceeded");
    check(!valid(head("POST", "Content-Length: 0\r\n"), "POST", std::numeric_limits<std::size_t>::max()), "overflow body_size accepted");
    const std::string base = head("GET", "X-Pad: \r\n");const std::string large = head("GET", "X-Pad: " + std::string(262144 - base.size(), 'a') + "\r\n");
    check(large.size() == 262144 && valid(large), "inclusive request header cap rejected");
    check(!valid(large, "GET", 0, 262143) && !valid(large + "x") && !valid(head(), "GET", 0, 0) && !valid(head(), "GET", 0, 262145), "request header bound bypassed");
}
struct Input final : wire::Reader {
    std::string bytes;std::size_t at = 0, step;bool throw_at_end;
    Input(std::string raw, std::size_t fragment = 7, bool throws = false) : bytes(std::move(raw)), step(fragment), throw_at_end(throws) {}
    std::size_t read(uint8_t *out, std::size_t cap) override {
        if (at == bytes.size()) { if (throw_at_end) throw std::runtime_error("original-reader-cause");return 0; }
        const auto n = std::min({cap, step, bytes.size() - at});std::copy_n(bytes.data() + at, n, out);at += n;return n;
    }
};
void responseData() {
    std::string why;wire::Response response;wire::Limits limits;
    const std::string body("{\0\xff}\n", 5), original = "HTTP/1.1 403 Original\r\nContent-Length: 5\r\n\r\n";
    Input cl(original + body);check(wire::read_response(cl, limits, response, why) && response.status_code == 403 && response.body_complete && response.headers_original == original &&
        std::string(response.body.begin(), response.body.end()) == body, "HTTP DATA response changed bytes or graded business status");
    Input chunks("HTTP/1.1 200 Original\r\nTransfer-Encoding: chunked\r\nTrailer: X-Original\r\n\r\n5\r\n" + body + "\r\n0\r\nX-Original: retained\r\n\r\n");
    check(wire::read_response(chunks, limits, response, why) && response.body_complete && std::string(response.body.begin(), response.body.end()) == body && response.trailers_original == "X-Original: retained\r\n\r\n", "chunked alias did not preserve original DATA");
    Input truncated(original + body.substr(0, 3));check(!wire::read_response(truncated, limits, response, why) && !response.body_complete && response.body.size() == 3, "truncated response prefix was dropped");
    Input throwing(original + body.substr(0, 3), 7, true);bool observed = false;
    try { (void)wire::read_response(throwing, limits, response, why); } catch (const std::runtime_error &e) { observed = std::string(e.what()) == "original-reader-cause"; }
    check(observed && !response.body_complete && response.body.size() == 3, "original reader exception/prefix lost");
    Input ambiguous("HTTP/1.1 200 Original\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n");
    check(!wire::read_response(ambiguous, limits, response, why) && !response.body_complete, "response alias accepted ambiguous framing");
    Input cap(original + body);limits.body_bytes = 1048577;limits.wire_bytes = limits.header_bytes + limits.body_bytes + 65536;
    check(!wire::read_response(cap, limits, response, why), "response alias silently expanded frozen entity cap");
}
}
int main() {
    try {
        originalBytes();refusals();bounds();responseData();
        std::cout << "{\"status\":\"PASS\",\"groups\":4,\"controls\":" << controls << ",\"pureHTTPFraming\":true,\"businessCodecExecuted\":false,\"networkOrCryptoExecuted\":false,\"RootAdmission\":false,\"SourceAdmission\":false}\n";return 0;
    } catch (const std::exception &e) { std::cerr << e.what() << '\n';return 1; }
}
