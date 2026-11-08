#pragma once
// SAME original operation immutable records; storage is never qualification.
#include <array>
#include <cstdint>
#include <string>
#include <vector>
namespace ynx::social::finite {
using Bytes=std::vector<unsigned char>;using Digest=std::array<unsigned char,32>;
Digest sha(const Bytes&);std::string hex(const Digest&);
struct Intent {
 Digest source_history,canonical_role,source_resource,binding_resource;
 std::uint32_t role=0;
 Bytes body,frame;
 Bytes encode()const;
 std::string operation()const;
};
struct Observation {Bytes classic,pair,terminal;bool entered=false;};
class Journal {
 int fd_=-1;bool close_selected_=false,closed_=false;int first_=0;
 std::uint64_t dev_=0,ino_=0;std::uint32_t uid_=0,gid_=0;
 Intent intent_;Bytes original_;std::string operation_;
 std::string registered_path_;
 void current()const;void exclusive(const char*,const Bytes&);Bytes read(const char*,std::size_t,bool missing=false)const;
public:
 // borrowed actual already Root-selected journal FD; own duplicated child.
 explicit Journal(int,const Intent&,const std::string& registered_path="");~Journal();
 Journal(const Journal&)=delete;Journal&operator=(const Journal&)=delete;
 void enter();void intentCurrent()const;
 bool probeEntered()const;
 void retainClassic(const Bytes&);void retainPair(const Bytes&);void terminal();
 Observation query()const;void queryInto(Observation&)const;
 bool close(int&first)noexcept;
};
}
