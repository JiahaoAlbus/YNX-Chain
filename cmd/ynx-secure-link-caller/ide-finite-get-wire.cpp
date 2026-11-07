#include "ide-finite-get-wire.hpp"
#include <algorithm>
#include <array>
#include <limits>
#include <string_view>
#include <utility>

namespace ynx::ide_finite_get::wire {
namespace {
constexpr std::size_t header_max = 262144, body_max = 1048576, overhead_max = 65536;
constexpr std::size_t proof_max = 196608;

bool deny(std::string &why, const char *message) { why = message;return false; }
bool digit(char c) { return c >= '0' && c <= '9'; }
bool alpha(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
bool token_char(unsigned char c) {
    return alpha(static_cast<char>(c)) || digit(static_cast<char>(c)) ||
        std::string_view("!#$%&'*+-.^_`|~").find(static_cast<char>(c)) != std::string_view::npos;
}
bool token(std::string_view value) {
    if (value.empty()) return false;
    for (unsigned char c : value) if (!token_char(c)) return false;
    return true;
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
bool decimal(std::string_view value, std::size_t &out) {
    if (value.empty()) return false;
    std::size_t number = 0;
    for (char c : value) {
        if (!digit(c) || number > (std::numeric_limits<std::size_t>::max() - static_cast<unsigned>(c - '0')) / 10) return false;
        number = number * 10 + static_cast<unsigned>(c - '0');
    }
    out = number;return true;
}
bool day(std::string_view value) {
    if (value.size() != 10 || value[4] != '-' || value[7] != '-') return false;
    for (std::size_t i = 0; i < value.size(); ++i) if (i != 4 && i != 7 && !digit(value[i])) return false;
    const unsigned year = static_cast<unsigned>((value[0]-'0')*1000+(value[1]-'0')*100+(value[2]-'0')*10+value[3]-'0');
    const unsigned month = static_cast<unsigned>((value[5]-'0')*10+value[6]-'0');
    const unsigned number = static_cast<unsigned>((value[8]-'0')*10+value[9]-'0');
    if (month < 1 || month > 12 || number < 1) return false;
    static constexpr unsigned days[] = {31,28,31,30,31,30,31,31,30,31,30,31};
    const unsigned maximum = days[month-1] + (month == 2 && year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) ? 1U : 0U);
    // Matches the SDK's Date.parse + exact ISO day roundtrip, including 0000.
    return number <= maximum;
}
bool authority(std::string_view value) {
    if (value.empty() || value.size() > 1024) return false;
    const auto colon = value.find(':');
    auto host = colon == std::string_view::npos ? value : value.substr(0, colon);
    if (host.empty() || host.size() > 253 || host.back() == '.') return false;
    std::size_t label = 0;
    for (std::size_t i = 0; i < host.size(); ++i) {
        const char c = host[i];
        if (c == '.') {
            if (!label || label > 63 || host[i-1] == '-') return false;
            label = 0;
        } else {
            if (!((c >= 'a' && c <= 'z') || digit(c) || c == '-') || (!label && c == '-')) return false;
            ++label;
        }
    }
    if (!label || label > 63 || host.back() == '-') return false;
    if (colon == std::string_view::npos) return true;
    const auto port = value.substr(colon+1);
    std::size_t number;
    return !port.empty() && (port.size() == 1 || port.front() != '0') && decimal(port, number) && number > 0 && number <= 65535;
}

class Input {
public:
    Input(Reader &reader, std::size_t maximum) : reader_(reader), maximum_(maximum) {}
    bool get(std::uint8_t &out, std::string &why) {
        if (at_ == size_ && !fill(why)) return false;
        out = buffer_[at_++];return true;
    }
    std::string_view available() const {
        return {reinterpret_cast<const char *>(buffer_.data() + at_), size_ - at_};
    }
    void consume(std::size_t size) { at_ += size; }
    bool more(std::string &why) { return at_ != size_ || fill(why); }
    bool eof() const { return eof_; }
private:
    Reader &reader_;
    std::size_t maximum_, wire_ = 0, at_ = 0, size_ = 0;
    bool eof_ = false;
    std::array<std::uint8_t, 8192> buffer_{};
    bool fill(std::string &why) {
        if (eof_) return false;
        const std::size_t remaining = maximum_ - wire_;
        const std::size_t capacity = remaining ? std::min(buffer_.size(), remaining) : 1;
        // Reader exceptions are deliberately not translated or suppressed.
        const auto received = reader_.read(buffer_.data(), capacity);
        if (received > capacity) return deny(why, "invalid bounded reader result");
        if (!received) { eof_ = true;return false; }
        if (received > remaining) return deny(why, "response wire bound");
        wire_ += received;at_ = 0;size_ = received;return true;
    }
};

bool raw_line(Input &input, std::string &raw, std::size_t capacity, std::string_view &line, std::string &why) {
    const auto start = raw.size();
    bool carriage = false;
    for (;;) {
        if (raw.size() >= capacity) return deny(why, "response header bound");
        std::uint8_t c;
        if (!input.get(c, why)) return why.empty() ? deny(why, "truncated HTTP line") : false;
        raw.push_back(static_cast<char>(c));
        if (carriage) {
            if (c != '\n') return deny(why, "invalid HTTP line ending");
            line = std::string_view(raw).substr(start, raw.size()-start-2);return true;
        }
        if (c == '\n') return deny(why, "invalid HTTP line ending");
        carriage = c == '\r';
    }
}

void available_body(Input &input, Response &out, std::size_t maximum, std::size_t count = std::numeric_limits<std::size_t>::max()) {
    const auto bytes = input.available();
    const auto size = std::min({bytes.size(), maximum - out.body.size(), count});
    out.body.insert(out.body.end(), bytes.begin(), bytes.begin() + static_cast<std::ptrdiff_t>(size));
    input.consume(size);
}

void failed_header_prefix(Input &input, Response &out, const Limits &limits, std::size_t block_start) {
    const auto pending = input.available();
    const auto prefix_size = std::min<std::size_t>(3, out.headers_original.size() - block_start);
    std::string probe = out.headers_original.substr(out.headers_original.size() - prefix_size);
    probe.append(pending);
    const auto marker = probe.find("\r\n\r\n");
    const auto header_part = marker == std::string::npos ? pending.size() : marker + 4 - prefix_size;
    const auto retain = std::min(header_part, limits.header_bytes - out.headers_original.size());
    out.headers_original.append(pending.data(), retain);
    if (marker != std::string::npos && header_part <= pending.size()) {
        input.consume(header_part);available_body(input, out, limits.body_bytes);
    }
}

bool field(std::string_view line, std::string &name, std::string_view &value) {
    if (line.empty() || line.front() == ' ' || line.front() == '\t') return false;
    const auto colon = line.find(':');
    if (colon == std::string_view::npos || !token(line.substr(0, colon))) return false;
    value = line.substr(colon+1);
    for (unsigned char c : value) if ((c < 0x20 && c != '\t') || c == 0x7f) return false;
    name = lower(line.substr(0, colon));value = ows(value);return true;
}
bool names(std::string_view value, std::vector<std::string> &out) {
    for (;;) {
        const auto comma = value.find(',');
        const auto name = ows(value.substr(0, comma));
        if (!token(name)) return false;
        const auto normalized = lower(name);
        if (std::find(out.begin(), out.end(), normalized) != out.end()) return false;
        out.push_back(normalized);
        if (comma == std::string_view::npos) return true;
        value.remove_prefix(comma+1);
    }
}
bool forbidden_trailer(const std::string &name) {
    for (const char *forbidden : {"content-length", "transfer-encoding", "host", "connection", "trailer", "te", "upgrade",
        "keep-alive", "authorization", "proxy-authorization", "proxy-authenticate", "www-authenticate", "authentication-info",
        "proxy-authentication-info", "cookie", "set-cookie", "content-encoding", "content-type", "content-range",
        "cache-control", "location", "vary"}) if (name == forbidden) return true;
    return false;
}
struct Header {
    int status = 0;
    bool length_present = false, chunked = false, http11 = true, trailer_present = false;
    std::size_t length = 0;
    std::vector<std::string> trailers, connection;
};

bool parse_header(std::string_view block, Header &header, Response &out, std::string &why) {
    const auto end = block.find("\r\n");
    const auto status = block.substr(0, end);
    if (end == std::string_view::npos || status.size() < 13 ||
        (status.substr(0, 9) != "HTTP/1.1 " && status.substr(0, 9) != "HTTP/1.0 ") ||
        !digit(status[9]) || !digit(status[10]) || !digit(status[11]) || status[12] != ' ')
        return deny(why, "invalid HTTP status line");
    for (unsigned char c : status.substr(13)) if ((c < 0x20 && c != '\t') || c == 0x7f)
        return deny(why, "invalid HTTP status line");
    header.status = (status[9]-'0')*100+(status[10]-'0')*10+status[11]-'0';
    if (header.status < 100 || header.status > 599) return deny(why, "invalid HTTP status code");
    out.status_code = header.status;header.http11 = status.substr(0, 8) == "HTTP/1.1";
    block.remove_prefix(end+2);
    while (block != "\r\n") {
        const auto stop = block.find("\r\n");
        if (stop == std::string_view::npos) return deny(why, "invalid HTTP field block");
        std::string name;std::string_view value;
        if (!field(block.substr(0, stop), name, value)) return deny(why, "invalid HTTP field");
        if (name == "content-length") {
            if (header.length_present || !decimal(value, header.length)) return deny(why, "invalid duplicate content length");
            header.length_present = true;
        } else if (name == "transfer-encoding") {
            if (header.chunked || lower(value) != "chunked") return deny(why, "unsupported transfer encoding");
            header.chunked = true;
        } else if (name == "trailer") {
            if (header.trailer_present || !names(value, header.trailers)) return deny(why, "invalid trailer declaration");
            header.trailer_present = true;
        } else if (name == "connection" && !names(value, header.connection)) return deny(why, "invalid connection field");
        block.remove_prefix(stop+2);
    }
    if (header.chunked && (header.length_present || !header.http11)) return deny(why, "ambiguous response framing");
    if (header.trailer_present && !header.chunked) return deny(why, "trailer without chunked framing");
    for (const auto &name : header.trailers) if (forbidden_trailer(name) ||
        std::find(header.connection.begin(), header.connection.end(), name) != header.connection.end())
        return deny(why, "forbidden trailer declaration");
    return true;
}

bool body_bytes(Input &input, std::size_t count, Response &out, const Limits &limits, std::string &why) {
    if (count > limits.body_bytes - out.body.size()) {
        available_body(input, out, limits.body_bytes, count);
        return deny(why, "response body bound");
    }
    while (count) {
        if (!input.more(why)) return why.empty() ? deny(why, "truncated response body") : false;
        const auto bytes = input.available();
        const auto take = std::min(count, bytes.size());
        out.body.insert(out.body.end(), bytes.begin(), bytes.begin() + static_cast<std::ptrdiff_t>(take));
        input.consume(take);count -= take;
    }
    return true;
}

bool chunk_size(std::string_view line, std::size_t &out) {
    std::size_t at = 0, number = 0, digits = 0;
    for (; at < line.size(); ++at) {
        const char c = line[at];unsigned n;
        if (digit(c)) n = static_cast<unsigned>(c-'0');
        else if (c >= 'a' && c <= 'f') n = static_cast<unsigned>(c-'a'+10);
        else if (c >= 'A' && c <= 'F') n = static_cast<unsigned>(c-'A'+10);
        else break;
        if (++digits > 16 || number > (std::numeric_limits<std::size_t>::max()-n)/16) return false;
        number = number*16+n;
    }
    if (!digits) return false;
    auto skip = [&] { while (at < line.size() && (line[at] == ' ' || line[at] == '\t')) ++at; };
    while (at < line.size()) {
        skip();if (at == line.size() || line[at++] != ';') return false;
        skip();const auto begin = at;
        while (at < line.size() && token_char(static_cast<unsigned char>(line[at]))) ++at;
        if (at == begin) return false;
        skip();
        if (at < line.size() && line[at] == '=') {
            ++at;skip();if (at == line.size()) return false;
            if (line[at] == '"') {
                ++at;bool closed = false;
                while (at < line.size()) {
                    unsigned char c = static_cast<unsigned char>(line[at++]);
                    if (c == '"') { closed = true;break; }
                    if (c == '\\') {
                        if (at == line.size()) return false;
                        c = static_cast<unsigned char>(line[at++]);
                    }
                    if ((c < 0x20 && c != '\t') || c == 0x7f) return false;
                }
                if (!closed) return false;
            } else {
                const auto begin_value = at;
                while (at < line.size() && token_char(static_cast<unsigned char>(line[at]))) ++at;
                if (at == begin_value) return false;
            }
        }
    }
    out = number;return true;
}

bool chunks(Input &input, const Header &header, const Limits &limits, Response &out, std::string &why) {
    for (;;) {
        std::string raw;std::string_view line;
        if (!raw_line(input, raw, overhead_max, line, why)) return false;
        std::size_t count;
        if (!chunk_size(line, count)) return deny(why, "invalid chunk size or extension");
        if (count == 0) break;
        if (!body_bytes(input, count, out, limits, why)) return false;
        std::uint8_t first, second;
        if (!input.get(first, why)) return why.empty() ? deny(why, "truncated chunk delimiter") : false;
        if (first != '\r') return deny(why, "invalid chunk delimiter");
        if (!input.get(second, why)) return why.empty() ? deny(why, "truncated chunk delimiter") : false;
        if (second != '\n') return deny(why, "invalid chunk delimiter");
    }
    std::vector<std::string> observed;
    for (;;) {
        std::string_view line;
        if (!raw_line(input, out.trailers_original, limits.header_bytes - out.headers_original.size(), line, why)) return false;
        if (line.empty()) return true;
        std::string name;std::string_view value;
        if (!field(line, name, value) || forbidden_trailer(name) ||
            std::find(header.connection.begin(), header.connection.end(), name) != header.connection.end() ||
            std::find(observed.begin(), observed.end(), name) != observed.end() ||
            (header.trailer_present && std::find(header.trailers.begin(), header.trailers.end(), name) == header.trailers.end()))
            return deny(why, "invalid forbidden or undeclared trailer");
        observed.push_back(std::move(name));
    }
}
} // namespace

bool validate_route(const std::string &path, const std::string &opid, std::string &why) {
    why.clear();
    if (opid.size() < 16 || opid.size() > 128) return deny(why, "invalid original operation identifier");
    for (char c : opid) if (!alpha(c) && !digit(c) && c != '_' && c != '-') return deny(why, "invalid original operation identifier");
    const std::string prefix = "/api/v1/ide/deployments/" + opid;
    if (path.size() < prefix.size() || path.compare(0, prefix.size(), prefix) != 0) return deny(why, "foreign finite GET route");
    const std::string_view suffix(path.data()+prefix.size(), path.size()-prefix.size());
    for (const char *fixed : {"", "/logs", "/runtime", "/usage", "/usage/records"}) if (suffix == fixed) return true;
    if (suffix.size() >= 9 && suffix.substr(0, 9) == "/billing/") {
        const auto period = suffix.substr(9);
        if (period.size() >= 10 && day(period.substr(0, 10)) &&
            (period.size() == 10 || period.substr(10) == "/native-intent")) return true;
    }
    return deny(why, "foreign finite GET route");
}

bool build_request(const std::string &host, const std::string &opid, const std::string &path,
                   const std::string &proof, std::string &out, std::string &why) {
    why.clear();
    if (!validate_route(path, opid, why)) return false;
    if (!authority(host)) return deny(why, "invalid fixed HTTPS authority");
    if (proof.empty() || proof.size() > proof_max) return deny(why, "original proof header bound");
    for (unsigned char c : proof) if (c < 0x20 || c == 0x7f) return deny(why, "invalid original proof header bytes");
    const std::string prefix = "GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\nx-ynx-product-session-proof-v4: ";
    static const std::string ending = "\r\nConnection: close\r\n\r\n";
    if (prefix.size() + ending.size() > header_max || proof.size() > header_max - prefix.size() - ending.size())
        return deny(why, "request header bound");
    std::string request;request.reserve(prefix.size()+proof.size()+ending.size());
    request.append(prefix);request.append(proof);request.append(ending);out = std::move(request);return true;
}

bool read_response(Reader &reader, const Limits &limits, Response &out, std::string &why) {
    why.clear();out.status_code = 0;out.headers_original.clear();out.trailers_original.clear();out.body.clear();out.body_complete = false;
    if (!limits.header_bytes || limits.header_bytes > header_max || limits.body_bytes > body_max ||
        !limits.wire_bytes || limits.wire_bytes > limits.header_bytes + limits.body_bytes + overhead_max)
        return deny(why, "invalid fixed response limits");
    Input input(reader, limits.wire_bytes);
    Header final;
    unsigned informational = 0;
    for (;;) {
        const auto start = out.headers_original.size();
        for (;;) {
            std::string_view line;
            if (!raw_line(input, out.headers_original, limits.header_bytes, line, why)) {
                failed_header_prefix(input, out, limits, start);return false;
            }
            if (line.empty()) break;
        }
        Header header;
        if (!parse_header(std::string_view(out.headers_original).substr(start), header, out, why)) {
            available_body(input, out, limits.body_bytes);return false;
        }
        if (header.status >= 200) { final = std::move(header);break; }
        if (header.status == 101 || header.length_present || header.chunked || header.trailer_present || ++informational > 8) {
            available_body(input, out, limits.body_bytes);return deny(why, "unsupported informational response");
        }
    }
    if (final.status == 204 || final.status == 304) {
        if (final.status == 204 && (final.length_present || final.chunked)) {
            available_body(input, out, limits.body_bytes);return deny(why, "framing on no-content response");
        }
    } else if (final.chunked) {
        if (!chunks(input, final, limits, out, why)) return false;
    } else if (final.length_present) {
        if (!body_bytes(input, final.length, out, limits, why)) return false;
    } else {
        while (input.more(why)) {
            const auto size = input.available().size();
            if (!body_bytes(input, size, out, limits, why)) return false;
        }
        if (!why.empty() || !input.eof()) return false;
    }
    out.body_complete = true;
    if (!input.available().empty()) return deny(why, "trailing response bytes");
    return true;
}

} // namespace ynx::ide_finite_get::wire
