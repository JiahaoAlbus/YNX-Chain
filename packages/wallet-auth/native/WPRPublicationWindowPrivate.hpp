#pragma once
#include <cstdint>
#include <limits>
namespace ynx::wallet::product::publication {
// Pure DATA/time fence. Only a genuine WPR Source snapshot supplies its input
// in production; constructing this object never grants installation authority.
class PublicationWindow {
 uint64_t initial_wall_=0,last_wall_=0,initial_mono_=0,expires_=0,mono_end_=0;
 bool selected_=false,failed_=false;
public:
 bool capture(uint64_t issued,uint64_t expires,uint64_t wall,uint64_t mono){
  if(selected_||failed_){failed_=true;return false;}selected_=true;
  if(!issued||expires<=issued||expires-issued>30000||wall<issued||wall>=expires||mono>std::numeric_limits<uint64_t>::max()-(expires-wall)){failed_=true;return false;}
  initial_wall_=last_wall_=wall;initial_mono_=mono;expires_=expires;mono_end_=mono+(expires-wall);return true;
 }
 bool current(uint64_t wall,uint64_t mono){if(!selected_||failed_||wall<initial_wall_||wall<last_wall_||wall>=expires_||mono<initial_mono_||mono>=mono_end_){failed_=true;return false;}last_wall_=wall;return true;}
};
}
