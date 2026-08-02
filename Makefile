.PHONY: setup devnet dev env-check no-placeholder-check secret-scan dependency-audit static-check docs-compliance-check public-disclosure-check docs-release-package docs-release-package-check objective-state-check readme-positioning-check deploy-readiness-gate deploy-readiness-gate-check deploy-connection-retry-check deploy-source-integrity-check public-proof-evidence-check public-proof-package-check release-manifest-check release-manifest-evidence-check preflight test integration-test smoke-test remote-smoke-test remote-smoke-test-via-sg remote-smoke-transport-check public-ingress-diagnostic public-ingress-path-check deploy-testnet deploy-authoritative-monitoring deploy-dry-run deploy-consensus-candidate consensus-candidate-deploy-gate verify-consensus-candidate consensus-candidate-key-ceremony consensus-overlay-key-ceremony production-service-signer-ceremony-plan production-service-signer-ceremony-check production-custody-review-packet production-custody-review-check owner-handover-packet owner-handover-check deploy-consensus-overlay verify-consensus-overlay consensus-candidate-fault-drill consensus-candidate-signed-tx-drill consensus-candidate-rollback bft-gateway-check bft-ai-action-check bft-pay-action-check bft-trust-action-check bft-resource-action-check consensus-public-cutover-check consensus-public-cutover-gate public-bft-cutover-plan public-bft-cutover-transaction-check public-bft-freeze-rehearsal-plan public-bft-freeze-rehearsal-approval-template public-bft-freeze-rehearsal-approval-template-check public-bft-freeze-rehearsal-transaction-check public-bft-production-rehearsal public-bft-production-rehearsal-check public-bft-production-recovery-check public-bft-production-driver-check mutation-freeze-check replication-compression-check caddy-ingress-check verify-testnet verify-testnet-check host-key-audit host-key-repair-plan host-key-approval-check host-key-approval-status host-key-approval-template host-key-approval-request host-key-approval-packet host-key-approved-repair-dry-run host-key-approved-repair host-key-approval-check-test legacy-inventory remote-blocker-report status logs restart backup rollback docs grant-package ecosystem-package exchange-package mainnet-readiness wallet-integration-check address-codec-check chainlist-package chainlist-candidate-check chainlist-live-check chainlist-collision-refresh exchange-vector-check exchange-package-integrity-check exchange-live-check exchange-integration-check developer-quickstart-check sdk-check sdk-release-package sdk-release-integrity-check sdk-remote-check contract-tooling-check monitoring-check authoritative-monitoring-check replication-alert-check indexer-check explorer-check faucet-check ai-gateway-check pay-api-check trust-api-check resource-api-check resource-market-check resource-sponsor-check bridge-api-check stablecoin-issuer-check validator-peer-readiness-check consensus-migration-check consensus-abci-check consensus-signed-transfer-check consensus-quorum-check consensus-production-package-check ops-check public-proof native-ynxt-no-hidden-freeze-check anti-illegal-request-check anti-unreasonable-tracking-check request-validity-check trust-appeal-check transparency-report-check emergency-action-policy-check privacy-safety-check
.PHONY: bft-evm-receipt-check bft-ide-contract-check native-wallet-check chat-api-check square-api-check app-gateway-check app-account-ownership-check browser-signer-check mobile-check mobile-product-split-check mobile-android-native-check mobile-android-release-check mobile-android-release-installed-check mobile-biometric-installed-check
.PHONY: deploy-bridge-testnet deploy-bridge-testnet-dry-run bridge-integration-check bridge-supply-chain-check bridge-release-candidate-check bridge-observability-check bridge-dependency-audit-check bridge-sdk-check bridge-route-adapter-check bridge-provider-check bridge-data-lifecycle-check bridge-capacity-check bridge-migration-check bridge-restore-check bridge-evidence-check
.PHONY: upgrade-source-release-audit upgrade-source-release-evidence-check governance-check governance-testnet-drill
.PHONY: integration-coverage-refresh integration-coverage-refresh-check integration-acceptance-refresh integration-acceptance-check integration-release-acceptance-check integration-product-release-matrix-refresh integration-product-release-matrix-check integration-capability-matrices-refresh integration-capability-matrices-check integration-completion-audit-refresh integration-completion-audit-check integration-npm-audit-policy-check integration-npm-audit-policy-check-test integration-protect-preflight
.PHONY: bft-evm-legacy-transfer-check bft-evm-access-list-transfer-check bft-evm-dynamic-fee-transfer-check bft-evm-fee-suggestion-check bft-evm-fee-history-check asset-primitives-check
.PHONY: yusd-sandbox-check yusd-restore-drill yusd-testnet-deploy-check read-availability-check economics-explorer-deploy-check economics-monitor-check economics-monitor-lifecycle-check economics-runtime-check staking-risk-runtime-check economics-integration-adapter-check economics-integration-store-check economics-local-testnet-evidence-check economics-shared-testnet-acceptance-check economics-testnet-cli-artifact-check economics-testnet-cli-artifact-evidence liquid-staking-candidate-check security-pools-candidate-check fee-market-candidate-check macro-stress-check economics-public-ui-check economics-public-package-check economics-supply-chain-check economics-release-boundary-check economics-integration-contract-check economics-local-candidate-check safety-module-candidate-check account-abstraction-check solvency-check integration-contract-check consensus-state-sync-check consensus-eip1559-commit-check consensus-fee-history-check streambft-candidate-check chain-core-release-check
.PHONY: oracle-test oracle-web-test oracle-container oracle-dast oracle-testnet-package oracle-testnet-smoke oracle-release-package oracle-release-evidence oracle-release-integrity-check

oracle-test:
	go test ./internal/oracle/... ./sdk/oracle/go ./cmd/ynx-oracled ./cmd/ynx-oracle-provider -race -count=1

oracle-web-test:
	npm --prefix apps/oracle run lint
	npm --prefix apps/oracle test

oracle-container:
	docker build --build-arg SOURCE_COMMIT=$$(git rev-parse HEAD) --file Dockerfile.oracle --tag ynx-oracle:testnet .

oracle-dast: oracle-container
	bash ./scripts/verify/oracle-dast.sh

oracle-testnet-package:
	PACKAGE_ONLY=1 bash ./scripts/deploy/deploy-oracle-testnet.sh

oracle-testnet-smoke:
	bash ./scripts/verify/oracle-testnet-smoke.sh

oracle-release-package:
	node ./scripts/package/oracle-release.mjs --output tmp/oracle-release

oracle-release-evidence:
	node ./scripts/package/oracle-release.mjs --output tmp/oracle-release --evidence-dir release/evidence

oracle-release-integrity-check:
	node ./scripts/verify/oracle-release-integrity-check.mjs

setup:
	go mod tidy

devnet:
	YNX_NETWORK=devnet YNX_HTTP_ADDR=127.0.0.1:6420 YNX_DATA_DIR=./tmp/devnet-state go run ./cmd/ynx-chaind

dev: devnet

env-check:
	bash ./scripts/validate/env-check.sh

no-placeholder-check:
	bash ./scripts/validate/no-placeholder-check.sh

secret-scan:
	bash ./scripts/validate/secret-scan.sh

dependency-audit:
	npm audit --audit-level=high --fetch-timeout=15000 --fetch-retries=0

static-check:
	go vet ./cmd/... ./internal/...
	find scripts -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n
	find scripts -type f -name '*.mjs' -print0 | xargs -0 -n1 node --check

docs-compliance-check:
	node ./scripts/verify/docs-compliance-check.mjs

public-disclosure-check:
	node ./scripts/verify/public-disclosure-gate.mjs

integration-coverage-refresh:
	node ./scripts/ops/refresh-integration-coverage.mjs

integration-coverage-refresh-check:
	node ./scripts/ops/refresh-integration-coverage.mjs --self-test

integration-acceptance-refresh:
	node ./scripts/ops/refresh-integration-acceptance.mjs --github

integration-acceptance-check:
	node ./scripts/verify/integration-acceptance-check.mjs

integration-release-acceptance-check:
	node ./scripts/verify/integration-acceptance-check.mjs --release

integration-product-release-matrix-refresh:
	node ./scripts/ops/refresh-product-release-matrix.mjs

integration-product-release-matrix-check:
	node ./scripts/ops/refresh-product-release-matrix.mjs --self-test
	node ./scripts/ops/refresh-product-release-matrix.mjs --check

integration-capability-matrices-refresh:
	node ./scripts/ops/refresh-fable5-capability-matrices.mjs

integration-capability-matrices-check:
	node ./scripts/ops/refresh-fable5-capability-matrices.mjs --check

integration-completion-audit-refresh:
	node ./scripts/ops/refresh-fable5-completion-audit.mjs

integration-completion-audit-check:
	node ./scripts/ops/refresh-fable5-completion-audit.mjs --check

integration-npm-audit-policy-check:
	node ./scripts/verify/npm-audit-policy-check.mjs

integration-npm-audit-policy-check-test:
	node ./scripts/verify/npm-audit-policy-check.mjs --self-test

integration-protect-preflight: integration-coverage-refresh-check integration-acceptance-check integration-product-release-matrix-check integration-capability-matrices-check integration-completion-audit-check contract-tooling-check integration-npm-audit-policy-check integration-npm-audit-policy-check-test
	go test ./...
	$(MAKE) no-placeholder-check
	$(MAKE) secret-scan
	$(MAKE) static-check

docs-release-package:
	node ./scripts/package/docs-release.mjs

docs-release-package-check:
	node ./scripts/package/docs-release.mjs --self-test
	node ./scripts/verify/docs-release-package-check.mjs --self-test

objective-state-check:
	bash ./scripts/verify/objective-state-check.sh

readme-positioning-check:
	node ./scripts/verify/readme-positioning-check.mjs

deploy-readiness-gate:
	node ./scripts/verify/deploy-readiness-gate.mjs

deploy-readiness-gate-check:
	node ./scripts/verify/deploy-readiness-gate-check.mjs

deploy-connection-retry-check:
	bash ./scripts/verify/deploy-connection-retry-check.sh

deploy-source-integrity-check:
	bash ./scripts/verify/deploy-source-integrity-check.sh

public-proof-evidence-check:
	node ./scripts/verify/public-proof-evidence-check.mjs --self-test

public-proof-package-check:
	node ./scripts/verify/public-proof-package-check.mjs --self-test

release-manifest-check:
	commit=$$(git rev-parse --short=12 HEAD); node ./scripts/verify/release-manifest-check.mjs "tmp/deploy/ynx-chain-$$commit" "$$commit" "ynx-chain-$$commit"

release-manifest-evidence-check:
	node ./scripts/verify/release-manifest-evidence.mjs --self-test

upgrade-source-release-audit:
	bash ./scripts/verify/upgrade-source-release-audit.sh

upgrade-source-release-evidence-check:
	node ./scripts/verify/upgrade-source-release-evidence.mjs --self-test

preflight:
	bash ./scripts/deploy/preflight.sh

test:
	go test ./cmd/... ./internal/...

integration-test:
	go test ./cmd/... ./internal/...

smoke-test:
	bash ./scripts/verify/testnet-smoke-test.sh

remote-smoke-test:
	bash ./scripts/verify/remote-smoke-test.sh

remote-smoke-test-via-sg:
	bash ./scripts/verify/remote-smoke-via-sg.sh

remote-smoke-transport-check:
	node ./scripts/verify/remote-smoke-transport-check.mjs

public-ingress-diagnostic:
	node ./scripts/verify/public-ingress-diagnostic.mjs

public-ingress-path-check:
	node ./scripts/verify/public-ingress-diagnostic.mjs --self-test

deploy-testnet:
	bash ./scripts/deploy/deploy-testnet.sh

deploy-bridge-testnet:
	bash ./scripts/deploy/deploy-bridge-testnet.sh

deploy-bridge-testnet-dry-run:
	YNX_BRIDGE_TESTNET_DRY_RUN=1 bash ./scripts/deploy/deploy-bridge-testnet.sh

deploy-authoritative-monitoring:
	bash ./scripts/deploy/deploy-authoritative-monitoring.sh

deploy-dry-run:
	bash ./scripts/deploy/dry-run.sh

deploy-consensus-candidate:
	bash ./scripts/deploy/deploy-consensus-candidate.sh

consensus-candidate-deploy-gate:
	bash ./scripts/verify/consensus-candidate-deploy-gate.sh

verify-consensus-candidate:
	bash ./scripts/verify/verify-consensus-candidate.sh

consensus-candidate-key-ceremony:
	bash ./scripts/ops/init-consensus-candidate-keys.sh

consensus-overlay-key-ceremony:
	bash ./scripts/ops/init-consensus-overlay-keys.sh

deploy-consensus-overlay:
	bash ./scripts/deploy/deploy-consensus-overlay.sh

verify-consensus-overlay:
	bash ./scripts/verify/verify-consensus-overlay.sh

consensus-candidate-fault-drill:
	bash ./scripts/verify/consensus-candidate-fault-drill.sh

consensus-candidate-signed-tx-drill:
	bash ./scripts/verify/consensus-candidate-signed-tx-drill.sh

consensus-candidate-rollback:
	bash ./scripts/ops/rollback-consensus-candidate.sh

bft-gateway-check:
	bash ./scripts/verify/bft-gateway-check.sh

bft-evm-receipt-check:
	bash ./scripts/verify/bft-evm-receipt-check.sh

bft-evm-legacy-transfer-check:
	bash ./scripts/verify/bft-evm-legacy-transfer-check.sh

bft-evm-access-list-transfer-check:
	bash ./scripts/verify/bft-evm-access-list-transfer-check.sh

bft-evm-dynamic-fee-transfer-check:
	bash ./scripts/verify/bft-evm-dynamic-fee-transfer-check.sh

bft-evm-fee-suggestion-check:
	bash ./scripts/verify/bft-evm-fee-suggestion-check.sh

bft-evm-fee-history-check:
	bash ./scripts/verify/bft-evm-fee-history-check.sh

bft-ide-contract-check:
	bash ./scripts/verify/bft-ide-contract-check.sh

bft-ai-action-check:
	bash ./scripts/verify/bft-ai-action-check.sh

bft-pay-action-check:
	bash ./scripts/verify/bft-pay-action-check.sh

bft-trust-action-check:
	bash ./scripts/verify/bft-trust-action-check.sh

bft-resource-action-check:
	bash ./scripts/verify/bft-resource-action-check.sh

consensus-public-cutover-check:
	node ./scripts/verify/consensus-public-cutover-gate.mjs --self-test

consensus-public-cutover-gate:
	node ./scripts/verify/consensus-public-cutover-gate.mjs

public-bft-cutover-plan:
	PUBLIC_BFT_CUTOVER_MODE=plan bash ./scripts/ops/public-bft-cutover-transaction.sh

public-bft-cutover-transaction-check:
	bash ./scripts/verify/public-bft-cutover-transaction-check.sh

public-bft-freeze-rehearsal-plan:
	PUBLIC_BFT_FREEZE_REHEARSAL_MODE=plan bash ./scripts/ops/public-bft-freeze-rehearsal-transaction.sh

public-bft-freeze-rehearsal-approval-template:
	node ./scripts/ops/write-public-bft-freeze-rehearsal-approval-template.mjs

public-bft-freeze-rehearsal-approval-template-check:
	bash ./scripts/verify/public-bft-freeze-rehearsal-approval-template-check.sh

public-bft-freeze-rehearsal-transaction-check:
	bash ./scripts/verify/public-bft-freeze-rehearsal-transaction-check.sh

production-service-signer-ceremony-plan:
	YNX_SERVICE_SIGNER_CEREMONY_MODE=plan bash ./scripts/ops/init-production-service-signers.sh

production-service-signer-ceremony-check:
	bash ./scripts/verify/production-service-signer-ceremony-check.sh

production-custody-review-packet:
	node ./scripts/ops/write-production-custody-review-packet.mjs

production-custody-review-check:
	bash ./scripts/verify/production-custody-review-check.sh

owner-handover-packet:
	node ./scripts/ops/write-owner-handover-packet.mjs

owner-handover-check:
	bash ./scripts/verify/owner-handover-check.sh

public-bft-production-rehearsal:
	bash ./scripts/ops/public-bft-production-driver.sh rehearse

public-bft-production-rehearsal-check:
	node ./scripts/verify/validate-public-bft-production-rehearsal.mjs --self-test

public-bft-production-recovery-check:
	node ./scripts/verify/validate-public-bft-production-recovery.mjs --self-test

public-bft-production-driver-check:
	bash ./scripts/verify/public-bft-production-driver-check.sh
	bash ./scripts/verify/public-bft-production-candidate-check.sh

mutation-freeze-check:
	bash ./scripts/verify/mutation-freeze-check.sh

replication-compression-check:
	bash ./scripts/verify/replication-compression-check.sh

caddy-ingress-check:
	bash ./scripts/deploy/dry-run.sh

verify-testnet:
	bash ./scripts/verify/verify-testnet.sh

verify-testnet-check:
	bash ./scripts/verify/verify-testnet-check.sh

host-key-audit:
	bash ./scripts/ops/host-key-audit.sh

host-key-repair-plan:
	bash ./scripts/ops/host-key-repair-plan.sh

host-key-approval-check:
	node ./scripts/ops/host-key-approval-check.mjs

host-key-approval-status:
	node ./scripts/ops/host-key-approval-check.mjs --status

host-key-approval-template:
	node ./scripts/ops/host-key-approval-check.mjs --write-template

host-key-approval-request:
	node ./scripts/ops/host-key-approval-check.mjs --write-approval-request

host-key-approval-packet:
	node ./scripts/ops/host-key-approval-check.mjs --write-approval-packet

host-key-approved-repair-dry-run:
	node ./scripts/ops/host-key-approval-check.mjs --repair-known-hosts --dry-run

host-key-approved-repair:
	node ./scripts/ops/host-key-approval-check.mjs --repair-known-hosts

host-key-approval-check-test:
	node ./scripts/ops/host-key-approval-check.mjs --self-test

legacy-inventory:
	bash ./scripts/ops/legacy-inventory.sh

remote-blocker-report:
	node ./scripts/verify/remote-blocker-report.mjs

status:
	bash ./scripts/ops/status.sh

logs:
	bash ./scripts/ops/logs.sh

restart:
	bash ./scripts/ops/restart.sh

backup:
	bash ./scripts/ops/backup.sh

rollback:
	bash ./scripts/ops/rollback.sh

docs:
	bash ./scripts/package/docs.sh

grant-package:
	bash ./scripts/package/grant-package.sh

ecosystem-package:
	bash ./scripts/package/ecosystem-package.sh

exchange-package:
	bash ./scripts/package/exchange-package.sh

mainnet-readiness:
	bash ./scripts/package/mainnet-readiness.sh

wallet-integration-check:
	bash ./scripts/verify/wallet-integration-check.sh

address-codec-check:
	bash ./scripts/verify/address-codec-check.sh

chainlist-package:
	bash ./scripts/package/chainlist-package.sh

chainlist-candidate-check:
	node ./scripts/verify/chainlist-candidate-check.mjs

chainlist-live-check:
	node ./scripts/verify/chainlist-live-check.mjs --output tmp/public-proof/chainlist-live.json

chainlist-collision-refresh:
	node ./scripts/ops/refresh-chainlist-collision-evidence.mjs --output chain-metadata/chainid-collision-evidence.json

exchange-vector-check:
	rm -rf tmp/exchange-vector-check
	mkdir -p tmp/exchange-vector-check
	go run ./scripts/fixtures/generate-exchange-vectors -output tmp/exchange-vector-check/signed-transactions.json
	cmp testdata/exchange-signed-transactions.json tmp/exchange-vector-check/signed-transactions.json

exchange-package-integrity-check:
	node ./scripts/verify/exchange-candidate-check.mjs

exchange-live-check:
	node ./scripts/verify/exchange-live-check.mjs --output tmp/public-proof/exchange-live.json

exchange-integration-check:
	bash ./scripts/verify/exchange-integration-check.sh

developer-quickstart-check:
	bash ./scripts/verify/developer-quickstart-check.sh

sdk-check:
	bash ./scripts/verify/sdk-check.sh

browser-signer-check:
	bash ./scripts/verify/browser-signer-check.sh

mobile-check:
	bash ./scripts/verify/mobile-check.sh

mobile-product-split-check:
	bash ./scripts/verify/mobile-product-split-check.sh

mobile-android-native-check:
	bash ./scripts/verify/mobile-android-native-check.sh

mobile-android-release-check:
	bash ./scripts/verify/mobile-android-release-check.sh

mobile-android-release-installed-check:
	bash ./scripts/verify/mobile-android-release-installed-check.sh

mobile-biometric-installed-check:
	bash ./scripts/verify/mobile-biometric-installed-check.sh

sdk-release-package:
	node ./scripts/package/sdk-release.mjs --output tmp/packages/sdk-release

sdk-release-integrity-check:
	node ./scripts/verify/sdk-release-integrity-check.mjs

sdk-remote-check:
	bash ./scripts/verify/sdk-remote-check.sh

contract-tooling-check:
	bash ./scripts/verify/contract-tooling-check.sh

monitoring-check:
	bash ./scripts/verify/monitoring-check.sh

authoritative-monitoring-check:
	bash ./scripts/verify/authoritative-monitoring-check.sh

replication-alert-check:
	bash ./scripts/verify/replication-alert-check.sh

indexer-check:
	bash ./scripts/verify/indexer-check.sh

explorer-check:
	bash ./scripts/verify/explorer-check.sh

faucet-check:
	bash ./scripts/verify/faucet-check.sh

ai-gateway-check:
	bash ./scripts/verify/ai-gateway-check.sh

pay-api-check:
	bash ./scripts/verify/pay-api-check.sh

trust-api-check:
	bash ./scripts/verify/trust-api-check.sh

native-wallet-check:
	bash ./scripts/verify/native-wallet-check.sh

chat-api-check:
	bash ./scripts/verify/chat-api-check.sh

square-api-check:
	bash ./scripts/verify/square-api-check.sh

app-gateway-check:
	bash ./scripts/verify/app-gateway-check.sh

app-account-ownership-check: app-gateway-check
	@echo "app-account-ownership-check passed"

resource-api-check:
	bash ./scripts/verify/resource-api-check.sh

bridge-api-check:
	bash ./scripts/verify/bridge-api-check.sh

bridge-integration-check:
	node ./scripts/verify/bridge-integration-check.mjs

bridge-supply-chain-check:
	bash ./scripts/verify/bridge-supply-chain-check.sh

.PHONY: bridge-release-candidate-check
bridge-release-candidate-check:
	node ./scripts/package/bridge-release-candidate.mjs --output tmp/bridge-release-candidate
	node ./scripts/verify/bridge-release-candidate.mjs --candidate tmp/bridge-release-candidate --source-root .

bridge-observability-check:
	node ./scripts/verify/bridge-observability-check.mjs

.PHONY: bridge-dependency-audit-check bridge-sdk-check bridge-route-adapter-check bridge-provider-check
bridge-dependency-audit-check:
	node ./scripts/verify/bridge-dependency-audit.mjs

bridge-sdk-check:
	bash ./scripts/verify/bridge-sdk-check.sh

bridge-route-adapter-check:
	node ./scripts/verify/bridge-route-adapter-check.mjs

bridge-provider-check:
	bash ./scripts/verify/bridge-provider-check.sh

.PHONY: bridge-data-lifecycle-check
bridge-data-lifecycle-check:
	bash ./scripts/verify/bridge-data-lifecycle-check.sh

.PHONY: bridge-capacity-check bridge-migration-check bridge-restore-check bridge-evidence-check
bridge-capacity-check:
	bash ./scripts/verify/bridge-capacity-check.sh

bridge-migration-check:
	bash ./scripts/verify/bridge-migration-check.sh

bridge-restore-check:
	bash ./scripts/verify/bridge-restore-check.sh

bridge-evidence-check:
	node ./scripts/verify/bridge-evidence-check.mjs

stablecoin-issuer-check:
	bash ./scripts/verify/stablecoin-issuer-check.sh

stable-reserve-attestation-check:
	go test -race ./internal/stablereserve ./internal/economics ./internal/explorer ./cmd/ynx-stable-reserve-verify ./cmd/ynx-explorerd

economics-explorer-deploy-check:
	bash -n ./scripts/deploy/deploy-economics-explorer.sh ./scripts/deploy/remote/install-economics-explorer.sh
	node ./scripts/verify/economics-explorer-deploy-check.mjs
	DEPLOY_DRY_RUN=1 bash ./scripts/deploy/deploy-economics-explorer.sh

economics-monitor-check:
	bash ./scripts/verify/economics-monitor-check.sh

economics-monitor-lifecycle-check:
	bash ./scripts/verify/economics-monitor-lifecycle-check.sh

yusd-sandbox-check:
	go test -race ./internal/yusdsandbox ./cmd/ynx-yusd-sandboxd

yusd-restore-drill:
	go test ./internal/yusdsandbox -run BackupRestoreDrill -count=1

yusd-testnet-deploy-check:
	bash ./scripts/verify/yusd-testnet-deploy-check.sh

read-availability-check:
	bash ./scripts/verify/read-availability-check.sh

economics-runtime-check:
	go test -race ./internal/economics ./cmd/ynx-economics-runtime
	go run ./cmd/ynx-economics-runtime -input economics/examples/runtime-replay.json >/dev/null

staking-risk-runtime-check:
	go test -race ./internal/economics ./cmd/ynx-staking-risk-runtime
	go run ./cmd/ynx-staking-risk-runtime -input economics/examples/staking-risk-runtime-replay.json >/dev/null

economics-integration-adapter-check:
	go test -race ./internal/economics ./cmd/ynx-economics-integration
	go run ./cmd/ynx-economics-integration -economics-input economics/examples/runtime-replay.json -staking-input economics/examples/staking-risk-runtime-replay.json -source-commit 72591ce6ab9eb4ae7878fcf6369c9aac37e7fba9 -summary >/dev/null

economics-integration-store-check:
	go test -race ./internal/economics ./cmd/ynx-economics-integration-store
	node ./scripts/verify/economics-integration-store-check.mjs

economics-local-testnet-evidence-check:
	go test -race ./internal/economics ./cmd/ynx-economics-local-testnet-evidence
	node ./scripts/verify/economics-local-testnet-evidence-check.mjs

economics-shared-testnet-acceptance-check:
	go test -race ./internal/economics -run SharedTestnet -count=1
	go test -race ./cmd/ynx-economics-shared-testnet-acceptance -count=1

economics-testnet-cli-artifact-check:
	node ./scripts/verify/economics-testnet-cli-artifact-check.mjs

economics-testnet-cli-artifact-evidence:
	node ./scripts/verify/economics-testnet-cli-artifact-check.mjs --out-dir dist/ynxt-economics-testnet-cli-darwin-arm64 --evidence release/economics-testnet-cli-artifact.json

liquid-staking-candidate-check:
	go test -race ./internal/economics ./cmd/ynx-liquid-staking-sim
	go run ./cmd/ynx-liquid-staking-sim -input economics/examples/liquid-staking-stress.json >/dev/null

security-pools-candidate-check:
	go test -race ./internal/economics ./cmd/ynx-security-pools-sim
	go run ./cmd/ynx-security-pools-sim -input economics/examples/security-pools-stress.json >/dev/null

fee-market-candidate-check:
	go test -race ./internal/economics ./cmd/ynx-fee-market-sim
	go run ./cmd/ynx-fee-market-sim -input economics/examples/fee-market-stress.json >/dev/null

macro-stress-check:
	go test -race ./internal/economics ./cmd/ynx-macro-stress-sim
	go run ./cmd/ynx-macro-stress-sim -input economics/examples/macro-stress.json >/dev/null

economics-public-ui-check:
	go test -race ./internal/explorer -run 'Economics' -count=1

economics-public-package-check:
	node ./scripts/verify/economics-public-package-check.mjs

economics-supply-chain-check:
	node ./scripts/verify/economics-supply-chain-check.mjs

economics-release-boundary-check:
	node ./scripts/verify/economics-release-boundary-check.mjs

economics-integration-contract-check:
	node ./scripts/verify/economics-integration-contract-check.mjs

economics-local-candidate-check: yusd-sandbox-check yusd-restore-drill economics-runtime-check staking-risk-runtime-check economics-integration-adapter-check economics-integration-store-check economics-local-testnet-evidence-check liquid-staking-candidate-check security-pools-candidate-check fee-market-candidate-check macro-stress-check economics-public-ui-check economics-public-package-check economics-supply-chain-check economics-release-boundary-check economics-integration-contract-check
	@echo "economics local candidate checks passed; deployment and unresolved security states remain governed by release evidence"

safety-module-candidate-check:
	go test -race ./internal/economics ./cmd/ynx-safety-module-sim -run 'SafetyModule'
	go run ./cmd/ynx-safety-module-sim -input economics/examples/safety-module-shortfall.json >/dev/null

resource-market-check:
	bash ./scripts/verify/resource-market-check.sh

resource-sponsor-check:
	bash ./scripts/verify/resource-sponsor-check.sh

validator-peer-readiness-check:
	bash ./scripts/verify/validator-peer-readiness-check.sh

consensus-migration-check:
	bash ./scripts/verify/consensus-migration-check.sh

consensus-abci-check:
	go test ./internal/consensus ./cmd/ynx-abci

consensus-signed-transfer-check:
	go test ./internal/consensus -run 'Test(SignedTransaction|ApplicationExecutesSignedTransfer|ApplicationDoesNotAdvance)' -count=1

consensus-quorum-check:
	bash ./scripts/verify/consensus-quorum-check.sh

consensus-state-sync-check:
	bash ./scripts/verify/consensus-state-sync-check.sh

consensus-eip1559-commit-check:
	bash ./scripts/verify/consensus-eip1559-commit-check.sh

consensus-fee-history-check:
	bash ./scripts/verify/consensus-fee-history-check.sh

streambft-candidate-check:
	bash ./scripts/verify/streambft-candidate-check.sh

chain-core-release-check:
	node ./scripts/verify/chain-core-release-check.mjs

asset-primitives-check:
	bash ./scripts/verify/asset-primitives-check.sh

account-abstraction-check:
	go test -count=1 ./internal/assetauth ./internal/consensus ./internal/bftgateway ./internal/bundler ./cmd/ynx-bundlerd -run 'SmartAccount|UserOperation|Paymaster|Sponsored|Bundler'
	go test -race -count=1 ./internal/assetauth ./internal/consensus ./internal/bftgateway ./internal/bundler -run 'SmartAccount|UserOperation|Paymaster|Sponsored|Bundler'

solvency-check:
	go test -count=1 ./internal/consensus ./internal/bftgateway -run 'Solvency|Staking'
	go test -race -count=1 ./internal/consensus ./internal/bftgateway -run 'Solvency|Staking'

integration-contract-check:
	node ./scripts/verify/integration-contract-check.mjs

governance-check:
	bash ./scripts/verify/governance-check.sh

governance-testnet-drill:
	bash ./scripts/verify/governance-testnet-drill.sh

consensus-production-package-check:
	bash ./scripts/verify/consensus-production-package-check.sh

ops-check:
	bash ./scripts/verify/ops-check.sh

public-proof:
	bash ./scripts/package/public-proof.sh

native-ynxt-no-hidden-freeze-check:
	bash ./scripts/verify/native-ynxt-no-hidden-freeze-check.sh

anti-illegal-request-check:
	bash ./scripts/verify/anti-illegal-request-check.sh

anti-unreasonable-tracking-check:
	bash ./scripts/verify/anti-unreasonable-tracking-check.sh

request-validity-check:
	bash ./scripts/verify/request-validity-check.sh

trust-appeal-check:
	bash ./scripts/verify/trust-appeal-check.sh

transparency-report-check:
	bash ./scripts/verify/transparency-report-check.sh

emergency-action-policy-check:
	bash ./scripts/verify/anti-illegal-request-check.sh

privacy-safety-check:
	bash ./scripts/verify/anti-unreasonable-tracking-check.sh
