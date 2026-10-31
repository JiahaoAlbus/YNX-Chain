#pragma once
// PUBLIC compile-worker stand-in only. Never a production include operand.
#include <map>
#include <vector>
#include <string>
#include <stdexcept>
#include <new>
namespace ynx_auth_private {
class HostDirfdJournal {
public:
 std::map<std::string,std::string>records;std::string fault;unsigned writes=0,reads=0;
 std::vector<std::string>list(){if(fault=="list")throw std::runtime_error("PUBLIC_LIST");std::vector<std::string>v;for(const auto&r:records)v.push_back(r.first);return v;}
 void writeProductDeviceV4OnceExclusive(const std::string&name,const std::string&raw){
  writes++;const bool terminal=name.size()>=9&&name.substr(name.size()-9)==".terminal";const std::string phase=terminal?"terminal":"entered";
  if(raw.empty()||raw.size()>131072||records.count(name))throw std::runtime_error("PUBLIC_EXCLUSIVE_BOUND");
  if(fault=="before-"+phase)throw std::runtime_error("PUBLIC_BEFORE_WRITE");if(fault=="allocation-"+phase)throw std::bad_alloc();
  records.emplace(name,raw);if(fault=="ack-"+phase)throw std::runtime_error("PUBLIC_ACK_UNKNOWN");
 }
 std::string read(const std::string&name,size_t max){reads++;const auto&r=records.at(name);if(r.size()>max)throw std::runtime_error("PUBLIC_READ_BOUND");
  if((fault=="read-entered"&&name.substr(name.size()-8)==".entered")||(fault=="read-terminal"&&name.substr(name.size()-9)==".terminal"))return r+"PUBLIC-CHANGED";return r;}
};
}
