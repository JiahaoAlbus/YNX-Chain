#pragma once
#include "RequiredOriginalAgentPorts.hpp"
#include <cstdint>
namespace ynx::mobilepq::aiagent {
// Native immutable reviewed CODE, not received Root rows/JSON/FD selection.
// Every path component is an original literal leaf below normal AppDirectory.
// Normal activation requires independently authorized registration/provisioning;
// this implementation never writes, imports or generates protected records.
struct AgentFilePin {std::string leaf,sha256;uint64_t device=0,inode=0,bytes=0;};
struct ReviewedAgentResource {
 std::string rootSHA256,profileSHA256,registrationSHA256;
 std::string directoryLeaf;uint64_t directoryDevice=0,directoryInode=0;
 uint32_t uid=0,gid=0;
 AgentFilePin registration,privateA,privateB;
};
const std::vector<ReviewedAgentResource>&reviewedOriginalAIAgentResources();
}
