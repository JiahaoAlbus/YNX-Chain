#pragma once
#include "MobileCanonicalDATA.hpp"
#include <array>
namespace ynx::auth::mobile::qualified {
using Bytes=std::vector<uint8_t>;
struct SourcePolicy {
 std::string rootDigest,enrollmentDigest,platform,applicationId,endpoint,spki,gatewayOrigin,registryDigest,currentLocator;
 std::array<std::string,3>frames;
 std::array<std::string,4>registeredDigests; // Root/profile/current/subject, independent compiled provenance
 std::string originalRegistrationDigest; // optional independently selected historical account original, QUERY ONLY
 std::string expectedNonce,previousHead;
 uint64_t previousSequence=0,previousFloor=0,previousTimeFloor=0,previousExecutionHeight=0;
};
struct SourceOriginals {Bytes root,enrollment,profile,current;std::array<Bytes,4>registered;Bytes originalRegisteredSubject;};
struct SourceMetadata {
 data::Value scope,context,subjectRegistration;std::string scopeOriginal,reference,operationID;
 uint32_t mode=0;uint64_t issued=0,expires=0,sequence=0,floor=0,height=0;std::string head;
};
// Actual Core Source18 AND on three FULL unchanged role bodies. Public input
// success is DATA only; only compiled normal producer with genuine physical
// owners + independent Native selection + registered resource pins may use it.
SourceMetadata verifySourceOriginals(const SourceOriginals&,const SourcePolicy&,uint64_t now);
std::string originalSHA256(const Bytes&);
}
