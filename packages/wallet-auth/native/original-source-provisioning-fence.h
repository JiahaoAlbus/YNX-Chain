#pragma once
#include <array>
#include <cstdint>
#include <limits>
#include <string>
namespace ynx_auth_private {
// Private DATA snapshot fence only. Not an issuer, resource constructor,
// authenticated reserve channel, signing permission or native admission.
struct ProvisioningPublicIdentity {
 std::array<std::string,3> originals;
 std::string sourceId,head;
 std::uint64_t sequence=0,floor=0;
};
class ProvisioningPublicFence final {
 ProvisioningPublicIdentity original_;
 std::uint64_t wall_=0,mono_=0,expires_=0,monoEnd_=0;
 bool selected_=false,emitted_=false;const char *first_=nullptr;
 bool fail(const char *code){if(!first_)first_=code;return false;}
 static bool digest(const std::string &s){
  if(s.size()!=64)return false;
  for(unsigned char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;
  return true;
 }
 static bool valid(const ProvisioningPublicIdentity &s){
  if(!s.sequence||s.floor>s.sequence||!digest(s.head)||s.sourceId.empty()||s.sourceId.size()>128)return false;
  for(const auto &v:s.originals)if(!digest(v))return false;
  for(unsigned char c:s.sourceId)if(!((c>='0'&&c<='9')||(c>='a'&&c<='z')||(c>='A'&&c<='Z')||c=='.'||c=='_'||c==':'||c=='-'))return false;
  return true;
 }
public:
 bool capture(const ProvisioningPublicIdentity &identity,std::uint64_t issued,
  std::uint64_t expires,std::uint64_t wall,std::uint64_t mono){
  if(first_)return false;
  if(selected_)return fail("AUTH_IDENTITY_PROVISIONING_SNAPSHOT_REUSED");
  selected_=true;
  if(!valid(identity)||expires<=issued||expires-issued>30000||wall<issued||wall>=expires)
   return fail("AUTH_IDENTITY_PROVISIONING_SNAPSHOT_INVALID");
  auto left=expires-wall;
  if(mono>std::numeric_limits<std::uint64_t>::max()-left)
   return fail("AUTH_IDENTITY_PROVISIONING_SNAPSHOT_CLOCK_INVALID");
  original_=identity;wall_=wall;mono_=mono;expires_=expires;monoEnd_=mono+left;return true;
 }
 bool complete(const ProvisioningPublicIdentity &identity,std::uint64_t wall,std::uint64_t mono){
  if(first_)return false;
  if(!selected_||emitted_)return fail("AUTH_IDENTITY_PROVISIONING_SNAPSHOT_REUSED");
  if(!valid(identity)||identity.originals!=original_.originals||identity.sourceId!=original_.sourceId||
   identity.floor!=original_.floor||identity.head!=original_.head||identity.sequence<original_.sequence)
   return fail("AUTH_IDENTITY_PROVISIONING_ORIGINAL_CHANGED");
  if(wall<wall_||wall>=expires_||mono<mono_||mono>=monoEnd_)
   return fail("AUTH_IDENTITY_PROVISIONING_POST_CURRENT_EXPIRED");
  emitted_=true;return true;
 }
 const char *firstCause()const{return first_;}
};
}
