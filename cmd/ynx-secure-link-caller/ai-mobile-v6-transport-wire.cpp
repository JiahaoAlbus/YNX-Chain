#include "ai-mobile-v6-transport-wire.hpp"
#include <limits>
#include <string_view>

namespace ynx::ai_mobile_v6::physical::wire {
namespace {
constexpr std::size_t header_max = 262144, request_body_max = 2U << 20;
bool fail(std::string &why, const char *message) { why = message;return false; }
bool digit(unsigned char c) { return c >= '0' && c <= '9'; }
bool token(unsigned char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || digit(c) ||
        std::string_view("!#$%&'*+-.^_`|~").find(static_cast<char>(c)) != std::string_view::npos;
}
std::string lower(std::string_view value) {
    std::string out(value);
    for (char &c : out) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c + ('a' - 'A'));
    return out;
}
std::string_view ows(std::string_view value) {
    while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) value.remove_prefix(1);
    while (!value.empty() && (value.back() == ' ' || value.back() == '\t')) value.remove_suffix(1);
    return value;
}
bool length(std::string_view value, std::size_t &out) {
    if (value.empty()) return false;
    std::size_t number = 0;
    for (unsigned char c : value) {
        if (!digit(c) || number > (std::numeric_limits<std::size_t>::max() - (c - '0')) / 10) return false;
        number = number * 10 + (c - '0');
    }
    out = number;return true;
}
}
bool check_request_head(const std::string &head, const std::string &method,
                        const std::string &path, const std::string &authority,
                        std::size_t body_size, std::size_t header_limit,
                        std::string &why) {
    why.clear();
    if (!header_limit || header_limit > header_max || head.size() > header_limit)
        return fail(why, "request header bound");
    if (method != "GET" && method != "POST") return fail(why, "request method framing");
    if (body_size > request_body_max || (method == "GET" && body_size)) return fail(why, "request body bound");
    // Original origin-form target only. Query and percent/dot bytes remain
    // uninterpreted: SDK/Native owns route/canonical/body qualification.
    if (path.empty() || path.front() != '/' || path.compare(0, 2, "//") == 0)
        return fail(why, "request target framing");
    for (unsigned char c : path) if (c <= 0x20 || c == 0x7f || c == '#' || c == '\\')
        return fail(why, "request target framing");
    if (authority.empty()) return fail(why, "request authority framing");
    for (unsigned char c : authority) if (c <= 0x20 || c >= 0x7f ||
        std::string_view("/@?#\\,").find(static_cast<char>(c)) != std::string_view::npos)
        return fail(why, "request authority framing");
    const auto first_end = head.find("\r\n");
    if (first_end == std::string::npos || head.compare(0, first_end, method + " " + path + " HTTP/1.1") != 0)
        return fail(why, "original request line mismatch");
    const auto terminator = head.find("\r\n\r\n");
    if (terminator == std::string::npos || terminator + 4 != head.size())
        return fail(why, "original request head termination");
    bool host_seen = false, length_seen = false, connection_seen = false;
    std::size_t content_length = 0, at = first_end + 2;
    while (at < head.size() - 2) {
        const auto end = head.find("\r\n", at);
        if (end == std::string::npos || end == at) return fail(why, "request field framing");
        const std::string_view line(head.data() + at, end - at);
        const auto colon = line.find(':');
        if (colon == std::string_view::npos || colon == 0) return fail(why, "request field framing");
        for (unsigned char c : line.substr(0, colon)) if (!token(c)) return fail(why, "request field name");
        for (unsigned char c : line.substr(colon + 1)) if ((c < 0x20 && c != '\t') || c == 0x7f)
            return fail(why, "request field value");
        const auto name = lower(line.substr(0, colon));const auto value = ows(line.substr(colon + 1));
        if (name == "host") {
            if (host_seen || value != authority) return fail(why, "original request Host mismatch");
            host_seen = true;
        } else if (name == "content-length") {
            if (length_seen || !length(value, content_length)) return fail(why, "request content length framing");
            length_seen = true;
        } else if (name == "connection") {
            // Close is the only permitted connection directive. No nominated
            // header, upgrade, hop-by-hop extension or keep-alive negotiation.
            if (connection_seen || lower(value) != "close") return fail(why, "request connection framing");
            connection_seen = true;
        } else if (name == "transfer-encoding" || name == "te" || name == "trailer" || name == "upgrade" ||
            name == "keep-alive" || name == "expect" || name == "http2-settings" || name.compare(0, 6, "proxy-") == 0)
            return fail(why, "unsupported request transport field");
        at = end + 2;
    }
    if (at != head.size() - 2 || !host_seen) return fail(why, "request Host required");
    if ((method == "POST" && !length_seen) || (length_seen && content_length != body_size))
        return fail(why, "original request body length mismatch");
    return true;
}
} // namespace ynx::ai_mobile_v6::physical::wire
