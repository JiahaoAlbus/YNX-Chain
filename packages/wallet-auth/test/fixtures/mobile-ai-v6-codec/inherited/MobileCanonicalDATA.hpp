#pragma once
#include <cstdint>
#include <map>
#include <string>
#include <vector>
#include <stdexcept>
// Native implementation of the sole SDK canonical DATA subset used by this
// closed Source family (safe nonnegative integers; no floats). Not a second
// signature codec: original role body bytes go unchanged to Core Source18.
namespace ynx::auth::mobile::qualified::data {
struct Value {
 enum Type{nullValue,boolean,integer,string,object,array}type=nullValue;
 bool b=false;uint64_t n=0;std::string s;std::map<std::string,Value>o;std::vector<Value>a;
 const Value&at(const std::string&k)const{if(type!=object)throw std::runtime_error("MOBILE_SOURCE_OBJECT");auto i=o.find(k);if(i==o.end())throw std::runtime_error("MOBILE_SOURCE_FIELD");return i->second;}
 const std::string&text()const{if(type!=string)throw std::runtime_error("MOBILE_SOURCE_STRING");return s;}
 uint64_t number()const{if(type!=integer)throw std::runtime_error("MOBILE_SOURCE_NUMBER");return n;}
 void keys(std::initializer_list<const char*>expected)const{if(type!=object||o.size()!=expected.size())throw std::runtime_error("MOBILE_SOURCE_CLOSED_KEYS");for(auto k:expected)(void)at(k);}
};
Value parseCanonical(const std::vector<uint8_t>&,size_t maximum);
std::string canonical(const Value&);
std::vector<uint8_t>unbase64url(const std::string&,size_t maximum);
uint64_t u64(const std::string&,bool zero=false);
bool hex(const std::string&,size_t count=64);
std::vector<uint8_t>unhex(const std::string&,size_t count);
}
