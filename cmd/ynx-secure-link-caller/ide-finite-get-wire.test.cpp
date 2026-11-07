#ifndef YNX_IDE_FINITE_GET_PUBLIC_TEST
#error Compile this PUBLIC wire control only with YNX_IDE_FINITE_GET_PUBLIC_TEST
#endif
#include "ide-finite-get-wire.hpp"
#include <algorithm>
#include <cstring>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace wire = ynx::ide_finite_get::wire;
namespace {
unsigned controls = 0;
const std::string opid = "ABCDEFGHIJKLMNOP";
const std::string prefix = "/api/v1/ide/deployments/" + opid;
constexpr std::size_t unlimited = std::numeric_limits<std::size_t>::max();
void require(bool value, const std::string &message) { if (!value) throw std::runtime_error(message); }

struct OriginalReadFailure { const void *identity; };
class PublicReader final : public wire::Reader {
public:
    explicit PublicReader(std::string input, std::size_t step = unlimited,
                          std::size_t throw_after = unlimited, const void *identity = nullptr)
        : input_(std::move(input)), step_(step), throw_after_(throw_after), identity_(identity) {}
    std::size_t read(std::uint8_t *out, std::size_t maximum) override {
        ++calls;
        if (offset_ >= throw_after_) throw OriginalReadFailure{identity_};
        const auto count = std::min({maximum, step_, input_.size()-offset_, throw_after_-offset_});
        if (count) std::memcpy(out, input_.data()+offset_, count);
        offset_ += count;return count;
    }
    std::size_t calls = 0;
private:
    std::string input_;
    std::size_t offset_ = 0, step_, throw_after_;
    const void *identity_;
};
std::string body(const wire::Response &response) { return {response.body.begin(), response.body.end()}; }
std::string head(int status, const std::string &fields = "") {
    return "HTTP/1.1 " + std::to_string(status) + " PUBLIC\r\n" + fields + "\r\n";
}
wire::Response accepted(const std::string &input, const std::string &expected, const std::string &label,
                        wire::Limits limits = {}, std::size_t step = unlimited, int status = 200) {
    PublicReader reader(input, step);wire::Response response;std::string why = "old failure";
    require(wire::read_response(reader, limits, response, why), "accept " + label + ": " + why);
    require(why.empty() && response.body_complete && response.status_code == status && body(response) == expected,
            "complete original response changed: " + label);
    ++controls;return response;
}
wire::Response rejected(const std::string &input, const std::string &label,
                        wire::Limits limits = {}, std::size_t step = unlimited) {
    PublicReader reader(input, step);wire::Response response;std::string why;
    require(!wire::read_response(reader, limits, response, why), "accepted invalid wire: " + label);
    require(!why.empty(), "missing static protocol/bounds diagnostic: " + label);
    ++controls;return response;
}
void route(const std::string &path, const std::string &id, bool expected, const std::string &label) {
    std::string why = "old failure";
    require(wire::validate_route(path, id, why) == expected && (expected ? why.empty() : !why.empty()), "route " + label);
    ++controls;
}

void routes_and_periods() {
    for (const auto &id : {opid, std::string(128, 'z')}) {
        const auto base = "/api/v1/ide/deployments/" + id;
        for (const char *suffix : {"", "/logs", "/runtime", "/usage", "/usage/records", "/billing/2024-02-29", "/billing/2024-02-29/native-intent"})
            route(base+suffix, id, true, suffix);
    }
    for (const char *period : {"0000-02-29", "0001-01-01", "0099-12-31", "1900-02-28", "2000-02-29", "2026-11-07", "9999-12-31"}) {
        route(prefix+"/billing/"+period, opid, true, period);
        route(prefix+"/billing/"+period+"/native-intent", opid, true, period);
    }
    for (const char *period : {"1900-02-29", "2100-02-29", "2023-02-29", "2024-02-30", "2024-04-31", "2024-00-01",
        "2024-13-01", "2024-01-00", "2024-01-32", "2024-2-29", "024-02-29", "10000-01-01", "2024-02-29Z"})
        route(prefix+"/billing/"+period, opid, false, period);
    for (const std::string &id : std::vector<std::string>{"", std::string(15, 'a'), std::string(129, 'a'),
        "ABCDEFGHIJKLMNO.", "ABCDEFGHIJKLMNO/", "ABCDEFGHIJKLMNO%", "ABCDEFGHIJKLMNO\n"})
        route("/api/v1/ide/deployments/"+id, id, false, "original ID boundary");
    for (const std::string &path : std::vector<std::string>{prefix+"/", prefix+"?", prefix+"?x=1", prefix+"#x", prefix+"/logs/",
        prefix+"//logs", prefix+"/./logs", prefix+"/runtime/../logs", prefix+"/%6cogs", prefix+"/usage%2frecords",
        prefix+"/billing/2024-02-29/native-intent/", prefix+"/billing/2024-02-29?x=1", prefix+"/billing/2024-02-29/native-intent#x",
        prefix+"/LOGS", prefix+"X", "https://public.test"+prefix, "/api/v1/IDE/deployments/"+opid,
        "/api/v1/ide/deployments/FOREIGN-OPERATION", prefix+std::string("\0",1)})
        route(path, opid, false, "no route normalization or alias");
}

void exact_original_request() {
    const std::string proof = "  PUBLIC+original/%= bytes \xc3\xa9  ";
    std::string out = "previous request", why;
    require(wire::build_request("public.test:8443", opid, prefix+"/logs", proof, out, why), "original proof request failed");
    const auto expected = "GET " + prefix + "/logs HTTP/1.1\r\nHost: public.test:8443\r\nx-ynx-product-session-proof-v4: " + proof + "\r\nConnection: close\r\n\r\n";
    require(out == expected && why.empty(), "original proof bytes were trimmed, parsed, recoded or replaced");
    require(out.find("Content-Type:") == std::string::npos && out.find("Content-Length:") == std::string::npos &&
            out.find("Transfer-Encoding:") == std::string::npos, "GET acquired a body transfer header");
    ++controls;
    const auto maximum = std::string(196608, 'P');
    require(wire::build_request("public.test", opid, prefix, maximum, out, why) && out.size() <= 262144 &&
            out.find(maximum) != std::string::npos, "maximum original proof changed or exceeded header bound");++controls;
    for (const std::string &bad : std::vector<std::string>{"", std::string(196609, 'P'), "proof\rheader", "proof\nheader",
        std::string("proof\0header",12), "proof\theader", "proof\x7fheader", "proof\x01header"}) {
        out = "retained original";
        require(!wire::build_request("public.test", opid, prefix, bad, out, why) && !why.empty() && out == "retained original",
                "invalid proof or failed output commit");++controls;
    }
    for (const char *host : {"https://public.test", "public.test/path", "user@public.test", "public.test?x", "public.test#x",
        "public.test\r\nx-extra: yes", "Public.test", "public.test.", "-public.test", "public-.test", "public..test",
        "public.test:0", "public.test:65536", "public.test:0443", "public.test:", "public.test:443:443"}) {
        require(!wire::build_request(host, opid, prefix, "PUBLIC", out, why) && !why.empty(), "invalid authority admitted");++controls;
    }
    require(!wire::build_request("public.test", opid, prefix+"?raw", "PUBLIC", out, why), "request builder bypassed route closure");++controls;
}

void content_length_and_status() {
    const auto header = head(200, "Content-Length: 5\r\nX-Public: original\r\n");
    const auto response = accepted(header+"hello", "hello", "content length", {}, 1);
    require(response.headers_original == header && response.trailers_original.empty(), "original header bytes changed");
    accepted(head(200,"Content-Length: 0\r\n"), "", "empty fixed body");
    accepted(head(200,"Content-Length: 4\r\n")+std::string("a\0bc",4), std::string("a\0bc",4), "binary entity");
    accepted(head(302,"Content-Length: 3\r\nLocation: https://foreign.test/\r\n")+"RED", "RED", "redirect body is DATA", {}, unlimited, 302);
    accepted(head(500,"Content-Length: 3\r\n")+"bad", "bad", "status is not business acceptance", {}, unlimited, 500);
    accepted(head(200,"cOnTeNt-LeNgTh: 0005\r\n")+"hello", "hello", "standard decimal framing retains header spelling");
    for (const std::string &fields : std::vector<std::string>{"Content-Length: 3\r\nContent-Length: 3\r\n",
        "Content-Length: 3\r\ncontent-length: 4\r\n", "Content-Length: 3, 3\r\n", "Content-Length: +3\r\n",
        "Content-Length: -1\r\n", "Content-Length: 184467440737095516160\r\n",
        "Content-Length: 3\r\nTransfer-Encoding: chunked\r\n", "Transfer-Encoding: gzip\r\n",
        "Transfer-Encoding: chunked, chunked\r\n", "Transfer-Encoding: gzip, chunked\r\n",
        "Transfer-Encoding: chunked\r\nTransfer-Encoding: chunked\r\n", "X-Bad : value\r\n",
        " Folded: value\r\n", "\tFolded: value\r\n", "X-Bad: value\x7f\r\n"})
        rejected(head(200,fields)+"abc", "ambiguous or invalid response field");
    rejected("HTTP/2 200 PUBLIC\r\n\r\n", "HTTP version alias");
    rejected("HTTP/1.1 099 PUBLIC\r\n\r\n", "invalid status lower bound");
    rejected("HTTP/1.1 600 PUBLIC\r\n\r\n", "invalid status upper bound");
    rejected("HTTP/1.1 200\r\n\r\n", "malformed status line");
    const auto extra = rejected(head(200,"Content-Length: 3\r\n")+"abcEXTRA", "already read trailing response bytes");
    require(extra.body_complete && body(extra) == "abc", "framed complete body was lost after trailing-byte rejection");
}

void chunked_and_trailers() {
    const auto header = head(200,"Transfer-Encoding: chunked\r\nTrailer: X-Public-Trace\r\n");
    const auto data = header + "3;public=value;quoted=\"a\\\"b\"\r\nabc\r\n2\r\nde\r\n0\r\nX-Public-Trace: done\r\n\r\n";
    for (const std::size_t step : {std::size_t{1}, std::size_t{7}, unlimited}) {
        const auto parsed = accepted(data, "abcde", "chunked original entity", {}, step);
        require(parsed.headers_original == header && parsed.trailers_original == "X-Public-Trace: done\r\n\r\n", "original chunked metadata changed");
    }
    accepted(head(200,"Transfer-Encoding: CHUNKED\r\n")+"000A\r\n0123456789\r\n0\r\n\r\n", "0123456789", "hexadecimal chunk grammar");
    accepted(head(200,"Transfer-Encoding: chunked\r\n")+"0\r\nX-Public: okay\r\n\r\n", "", "safe optional undeclared trailer");
    for (const char *chunks : {"Z\r\n", "0xA\r\n", "\r\n", "10000000000000000\r\n", "3;\r\nabc\r\n0\r\n\r\n",
        "3;x=\"unterminated\r\nabc\r\n0\r\n\r\n", "3;x=\r\nabc\r\n0\r\n\r\n", "3\r\nabcX\r\n0\r\n\r\n"})
        rejected(head(200,"Transfer-Encoding: chunked\r\n")+chunks, "invalid chunk grammar");
    for (const char *name : {"Content-Length", "Transfer-Encoding", "Host", "Connection", "Trailer", "Authorization", "Set-Cookie", "Content-Type"}) {
        rejected(head(200,"Transfer-Encoding: chunked\r\nTrailer: "+std::string(name)+"\r\n")+"0\r\n\r\n", "forbidden advertised trailer");
        const auto partial = rejected(head(200,"Transfer-Encoding: chunked\r\n")+"3\r\nabc\r\n0\r\n"+name+": bad\r\n\r\n", "forbidden actual trailer");
        require(body(partial) == "abc" && !partial.body_complete, "trailer rejection erased original entity prefix");
    }
    rejected(header+"0\r\nX-Other: no\r\n\r\n", "undeclared trailer under a declaration");
    rejected(header+"0\r\nX-Public-Trace: one\r\nx-public-trace: two\r\n\r\n", "duplicate trailer name");
    rejected(header+"0\r\n X-Public-Trace: folded\r\n\r\n", "folded trailer");
    rejected(head(200,"Transfer-Encoding: chunked\r\nConnection: X-Private\r\n")+"0\r\nX-Private: forbidden\r\n\r\n", "connection-nominated trailer");
    rejected(head(200,"Trailer: X-Public\r\nContent-Length: 0\r\n"), "trailer on fixed-length body");
    rejected("HTTP/1.0 200 PUBLIC\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n", "HTTP1.0 transfer encoding");
    rejected(header+"0\r\n\r\nEXTRA", "trailing chunked bytes");
}

void informational_and_eof() {
    std::string information;
    for (unsigned i = 0; i < 8; ++i) information += head(i%2 ? 103 : 100, "X-Public: interim\r\n");
    const auto final = head(200,"Content-Length: 1\r\n");
    const auto parsed = accepted(information+final+"x", "x", "eight bounded informational blocks", {}, 3);
    require(parsed.headers_original == information+final, "interim original headers were dropped");
    rejected(information+head(100)+final+"x", "ninth informational block");
    rejected(head(101,"Upgrade: anything\r\n"), "upgrade is not a finite GET response");
    rejected(head(100,"Content-Length: 0\r\n")+final+"x", "informational framing field");
    rejected(head(103), "informational without a final response");
    accepted(head(200)+"original EOF entity", "original EOF entity", "EOF framing", {}, 2);
    accepted("HTTP/1.0 200 PUBLIC\r\nX-Public: original\r\n\r\nEOF", "EOF", "HTTP1.0 EOF framing");
    accepted(head(200), "", "empty EOF entity");
    accepted(head(204), "", "no-content response", {}, unlimited, 204);
    rejected(head(204,"Content-Length: 0\r\n"), "forbidden 204 length field");
    accepted(head(304,"Content-Length: 9999999\r\n"), "", "304 representation metadata is not a body", {}, unlimited, 304);
}

void fixed_bounds() {
    const std::string begin = "HTTP/1.1 200 PUBLIC\r\nContent-Length: 3\r\nX-Public: ";
    const std::string maximum_header = begin + std::string(262144-begin.size()-4, 'h') + "\r\n\r\n";
    accepted(maximum_header+"abc", "abc", "exact maximum header bytes");
    auto small = wire::Limits{};small.header_bytes = 262143;
    small.wire_bytes = small.header_bytes + small.body_bytes + 65536;
    // Fragment off the parser's 8192-byte buffer boundary so the last read
    // actually contains the final header LF AND the body prefix under test.
    const auto header_bound = rejected(maximum_header+"abc", "first overflowing header byte", small, 8191);
    require(header_bound.headers_original.size() == small.header_bytes && body(header_bound) == "abc", "bounded header failure lost available body prefix");
    const std::string maximum_body(1048576, 'b');
    accepted(head(200,"Content-Length: 1048576\r\n")+maximum_body, maximum_body, "exact maximum fixed body");
    accepted(head(200)+maximum_body, maximum_body, "exact maximum EOF body");
    const auto long_eof = rejected(head(200)+maximum_body+"x", "body first overflowing byte");
    require(long_eof.body.size() == maximum_body.size() && !long_eof.body_complete, "EOF bound lost original bounded prefix");
    const auto declared = rejected(head(200,"Content-Length: 1048577\r\n")+"PUBLIC-prefix", "declared oversized body");
    require(body(declared) == "PUBLIC-prefix", "oversized length discarded received body prefix");
    const auto chunk = rejected(head(200,"Transfer-Encoding: chunked\r\n")+"100001\r\nPUBLIC-prefix", "oversized chunk");
    require(body(chunk) == "PUBLIC-prefix", "oversized chunk discarded received entity prefix");
    const auto eof_header = head(200);
    auto wire_limit = wire::Limits{};wire_limit.wire_bytes = eof_header.size()+3;
    require(body(rejected(eof_header+"abcd", "wire first overflowing byte", wire_limit)) == "abc", "wire bound changed allowed original prefix");
    for (unsigned invalid = 0; invalid < 4; ++invalid) {
        wire::Limits limits;
        if (invalid == 0) limits.header_bytes = 262145;
        else if (invalid == 1) limits.body_bytes = 1048577;
        else if (invalid == 2) limits.wire_bytes = 1376257;
        else limits.header_bytes = 0;
        PublicReader reader(head(200));wire::Response response;std::string why;
        require(!wire::read_response(reader, limits, response, why) && !why.empty() && reader.calls == 0,
                "invalid limits performed reader I/O");++controls;
    }
    auto no_body = wire::Limits{};no_body.body_bytes = 0;
    no_body.wire_bytes = no_body.header_bytes + no_body.body_bytes + 65536;
    accepted(head(204), "", "explicit zero body budget", no_body, unlimited, 204);
}

void retained_prefix_and_original_exceptions() {
    const auto length = head(200,"Content-Length: 5\r\n");
    const auto truncated = rejected(length+"abc", "truncated fixed-length body", {}, 1);
    require(body(truncated) == "abc" && truncated.headers_original == length && !truncated.body_complete, "truncated fixed body was not retained");
    const auto chunk_header = head(200,"Transfer-Encoding: chunked\r\n");
    const auto chunk = rejected(chunk_header+"3\r\nabc\r\n5\r\nde", "truncated later chunk", {}, 2);
    require(body(chunk) == "abcde" && !chunk.body_complete, "truncated chunk entity prefix changed");
    const std::string bad_header = "HTTP/1.1 200 PUBLIC\r\nX-Bad: bare\nX-Public: tail\r\n\r\n";
    const auto invalid = rejected(bad_header+"abc", "invalid header with received body read-ahead");
    require(invalid.headers_original == bad_header && body(invalid) == "abc", "invalid original header/body prefix lost");
    const auto duplicate_header = head(200,"Content-Length: 3\r\nContent-Length: 3\r\n");
    const auto duplicate = rejected(duplicate_header+"abc", "duplicate header keeps received payload");
    require(duplicate.headers_original == duplicate_header && body(duplicate) == "abc", "invalid complete header lost available payload");
    const auto unfinished = rejected("HTTP/1.1 200 PUBLIC\r\nX-Public: partial", "truncated original header");
    require(unfinished.headers_original == "HTTP/1.1 200 PUBLIC\r\nX-Public: partial" && unfinished.body.empty(), "truncated header prefix changed");
    int marker = 0;
    for (const auto &test : std::vector<std::pair<std::string, std::string>>{{length+"abc", "abc"},
        {head(200)+"abc", "abc"}, {chunk_header+"3\r\nabc\r\n5\r\nde", "abcde"}}) {
        PublicReader reader(test.first+"unread", unlimited, test.first.size(), &marker);
        wire::Response response;std::string why;
        bool original = false;
        try { (void)wire::read_response(reader, {}, response, why); }
        catch (const OriginalReadFailure &error) { original = error.identity == &marker; }
        require(original && body(response) == test.second && !response.body_complete && why.empty(),
                "reader exception was translated or original received entity prefix was discarded");++controls;
    }
}
} // namespace

int main() {
    try {
        routes_and_periods();exact_original_request();content_length_and_status();chunked_and_trailers();
        informational_and_eof();fixed_bounds();retained_prefix_and_original_exceptions();
        std::cout << "{\"status\":\"PASS\",\"pureWireControls\":" << controls
                  << ",\"groups\":7,\"networkOrCryptoExecuted\":false,\"RootAdmission\":false,\"SourceAdmission\":false}\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "finite GET PUBLIC wire control failed: " << error.what() << '\n';return 1;
    }
}
