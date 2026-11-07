#ifndef YNX_IDE_FINITE_GET_WIRE_HPP
#define YNX_IDE_FINITE_GET_WIRE_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// Private standard HTTP framing for the fixed seven GETs. This helper supplies
// no fetch provider, proof parser, signature domain, Root or Source authority.
namespace ynx::ide_finite_get::wire {

struct Response {
    int status_code = 0;
    std::string headers_original, trailers_original;
    std::vector<std::uint8_t> body;
    bool body_complete = false;
};

struct Limits {
    std::size_t header_bytes = 262144, body_bytes = 1048576, wire_bytes = 1376256;
};

class Reader {
public:
    virtual ~Reader() = default;
    virtual std::size_t read(std::uint8_t *, std::size_t) = 0;
};

bool validate_route(const std::string &path, const std::string &original_operation_id, std::string &why);
bool build_request(const std::string &authority, const std::string &opid, const std::string &path,
                   const std::string &original_proof, std::string &out, std::string &why);
// false means framing/bounds failure only. Reader exceptions propagate intact.
// Original received headers/trailers/body prefixes remain owned by Response;
// body_complete never means business, proof, Root or Source acceptance.
bool read_response(Reader &, const Limits &, Response &, std::string &why);

} // namespace ynx::ide_finite_get::wire

#endif
