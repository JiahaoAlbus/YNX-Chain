#pragma once
#include "CaptureJSON.hpp"
#include "RootCaptureResource.hpp"
#include "ProjectionFacts.hpp"
#include "OriginalSHA256.hpp"
#include <cstring>
namespace ynx::auth::android_capture {
// Only called with the actual independently selected row and held originals.
// The pure comparison result is not Source/Root admission or a JSON parser.
inline std::string bind_selected_policy(const Resource&r,const std::string&root,const std::string&enrollment,const std::string&held_policy){
 const auto*p=r.selected_policy;if(!p)throw 1;
 auto canonical=encode_policy(*p);
 if(!digest_shape(p->root_digest)||!digest_shape(p->enrollment_digest)||!digest_shape(p->spki)||root.empty()||enrollment.empty())throw 2;
 if(!p->signature_contract.purpose||std::strcmp(p->signature_contract.purpose,source_purpose(r.kind))||!r.current_endpoint||!r.current_spki||std::strcmp(p->endpoint,r.current_endpoint)||std::strcmp(p->spki,r.current_spki))throw 6;
 if(canonical!=held_policy||original_sha256(root)!=p->root_digest||original_sha256(enrollment)!=p->enrollment_digest)throw 6;
 return canonical;
}
}
