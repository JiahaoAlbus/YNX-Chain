#!/usr/bin/env bash
set -euo pipefail

image=${1:?"Usage: verify-docker-server-image.sh IMAGE EXPECTED_SOURCE_COMMIT EXPECTED_RUNTIME_CHECKPOINT OUTPUT_DIR"}
expected_commit=${2:?"Expected source commit is required."}
expected_runtime=${3:?"Expected runtime checkpoint is required."}
output_dir=${4:?"Output directory is required."}
[[ "$expected_commit" =~ ^[0-9a-f]{40}$ && "$expected_runtime" =~ ^[0-9a-f]{40}$ ]] || { echo "Expected commits must be full SHA-1 values." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker CLI is required." >&2; exit 1; }

mkdir -p "$output_dir"
port=$(node -e 'const net=require("net");const server=net.createServer();server.listen(0,"127.0.0.1",()=>{process.stdout.write(String(server.address().port));server.close()})')
name="ynx-code-image-check-$RANDOM-$RANDOM"
cookie_jar=$(mktemp)
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; rm -f "$cookie_jar"; }
trap cleanup EXIT

labels=$(docker image inspect "$image" --format '{{json .Config.Labels}}')
node -e '
const [labels, expectedCommit, expectedRuntime] = process.argv.slice(1); const value=JSON.parse(labels);
for (const [key, expected] of Object.entries({"org.opencontainers.image.title":"YNX Code Server","org.opencontainers.image.revision":expectedCommit,"io.ynx.runtime-checkpoint":expectedRuntime,"io.ynx.artifact-class":"unsigned-testnet-preview"})) if(value[key]!==expected) throw new Error(`${key} mismatch`);
' "$labels" "$expected_commit" "$expected_runtime"

# Docker's default seccomp profile blocks the non-root clone flags Bubblewrap
# needs for its inner user/mount/network namespaces. This changes only the
# outer CI syscall filter: the service remains non-root, read-only, cap-free
# and no-new-privileges, while untrusted compilation still has to pass through
# the inner Bubblewrap network-disabled boundary.
docker run --detach --name "$name" --user 10001:10001 --read-only --tmpfs /tmp:rw,nosuid,nodev,size=64m --tmpfs /var/lib/ynx-code:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=256m --cap-drop=ALL --security-opt no-new-privileges --security-opt seccomp=unconfined -e YNX_CODE_WORKSPACE_SESSION_KEY=ci-nonsecret-session-key -p "127.0.0.1:$port:4190" "$image" >/dev/null
health=""
for _ in {1..100}; do
  if health=$(curl --fail --silent --show-error --cookie-jar "$cookie_jar" "http://127.0.0.1:$port/runtime/health" 2>/dev/null); then break; fi
  docker inspect --format '{{.State.Running}}' "$name" | grep -Fxq true || { docker logs "$name" >&2; echo "Docker image exited during cold start." >&2; exit 1; }
  sleep 0.1
done
node -e 'const value=JSON.parse(process.argv[1]);if(value.ok!==true||value.service!=="ynx-code-workspace-agent"||value.sandboxReady!==true)throw new Error(`invalid Docker runtime health: ${JSON.stringify(value)}`)' "$health"
compile=$(curl --fail --silent --show-error --cookie "$cookie_jar" -X POST "http://127.0.0.1:$port/runtime/tasks" -H 'content-type: application/json' --data '{"protocolVersion":"ynx-code/v1","task":"build-run-active","approval":"execute-once","activePath":"hello.cpp","projectId":"docker-image-cpp","files":{"hello.cpp":"#include <iostream>\nint main(){std::cout << \"YNX-DOCKER-CPP\";return 0;}"}}')
node -e 'const value=JSON.parse(process.argv[1]);if(!value.ok||value.language!=="cpp"||value.sandbox?.network!==false||!String(value.output||"").includes("YNX-DOCKER-CPP"))throw new Error(`Docker C++ compile failed: ${JSON.stringify(value)}`)' "$compile"
image_id=$(docker image inspect "$image" --format '{{.Id}}')
node -e '
const fs=require("fs"); const [output,image,id,commit,runtime,health,compile]=process.argv.slice(1);
const value={schemaVersion:1,platform:"linux-container",image,localImageId:id,sourceCommit:commit,runtimeCheckpoint:runtime,runAsNonRoot:true,readOnlyRootFilesystem:true,capDropAll:true,noNewPrivileges:true,outerContainerSeccomp:"unconfined-required-for-bubblewrap-user-namespaces",coldStart:true,health:JSON.parse(health),realCppCompile:true,compile:JSON.parse(compile),productionSigned:false,registryPublished:false};
fs.writeFileSync(output,`${JSON.stringify(value,null,2)}\n`);
' "$output_dir/docker-image-evidence.json" "$image" "$image_id" "$expected_commit" "$expected_runtime" "$health" "$compile"
echo "Docker image cold start, isolated health and real C++ compile passed: $image"
