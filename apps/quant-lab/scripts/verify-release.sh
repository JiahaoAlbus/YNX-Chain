#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$repo_root"

runtime_targets=(
  apps/quant-lab/web
  apps/quant-lab/server
  apps/quant-lab/Dockerfile
  apps/quant-lab/compose.yaml
  apps/quant-lab/k8s
  apps/quant-lab/public-product-metadata.json
  apps/quant-lab/product-release.json
  cmd/ynx-quantd
  cmd/ynx-quant-worker
  cmd/ynx-quant-paperd
  cmd/ynx-quant-riskd
  cmd/ynx-quant-web
  cmd/ynx-quant-cli
  internal/quantlab
  internal/quantworker
  internal/quantcli
)

forbidden='TODO|FIXME|Coming soon|example\.com|Fake (Balance|User|Transaction|Price|Revenue|APY|Liquidity|Provider|Health)|hard[- ]coded success|mock provider|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'
if rg -n -i --glob '!**/*_test.go' --glob '!**/*.test.mjs' -e "$forbidden" "${runtime_targets[@]}"; then
  echo "Quant runtime/release prohibited-content gate failed"
  exit 1
fi

jq -e '.productId == "ynx-quant-lab" and .implementedLocal == true and .deployedPublic == false' apps/quant-lab/product-release.json >/dev/null
jq -e '.productId == "ynx-quant-lab" and (.downloads | type == "array")' apps/quant-lab/public-product-metadata.json >/dev/null

go test ./internal/quantlab ./internal/quantworker ./internal/quantapp ./internal/quantcli \
  ./cmd/ynx-quantd ./cmd/ynx-quant-worker ./cmd/ynx-quant-paperd \
  ./cmd/ynx-quant-riskd ./cmd/ynx-quant-web ./cmd/ynx-quant-cli
go vet ./internal/quantlab ./internal/quantworker ./internal/quantapp ./internal/quantcli \
  ./cmd/ynx-quantd ./cmd/ynx-quant-worker ./cmd/ynx-quant-paperd \
  ./cmd/ynx-quant-riskd ./cmd/ynx-quant-web ./cmd/ynx-quant-cli
npm test --prefix apps/quant-lab
npm run test:browser --prefix apps/quant-lab
node --test apps/quant-lab/sdk/typescript/index.test.mjs

python_bin=${YNX_PYTHON_BIN:-python3}
PYTHONPATH=apps/quant-lab/sdk/python/src "$python_bin" -m unittest discover \
  -s apps/quant-lab/sdk/python/tests -p 'test_*.py' -v

docker compose -f apps/quant-lab/compose.yaml config --quiet
ruby -e 'require "yaml"; YAML.load_stream(File.read("apps/quant-lab/k8s/quant-candidate.yaml"))'

if [[ "${YNX_REQUIRE_DOCKER_BUILD:-0}" == "1" ]]; then
  docker build -f apps/quant-lab/Dockerfile \
    --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" \
    -t ynx-quant:testnet-local .
fi

echo "Quant local release gates passed; remote, signed, installed, and public evidence remain separate gates"
