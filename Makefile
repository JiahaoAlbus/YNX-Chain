.PHONY: setup devnet dev env-check no-placeholder-check secret-scan preflight test integration-test smoke-test deploy-testnet deploy-dry-run verify-testnet status logs restart backup rollback docs grant-package ecosystem-package exchange-package mainnet-readiness wallet-integration-check chainlist-package exchange-integration-check developer-quickstart-check public-proof

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

preflight:
	bash ./scripts/deploy/preflight.sh

test:
	go test ./...

integration-test:
	go test ./...

smoke-test:
	bash ./scripts/verify/testnet-smoke-test.sh

deploy-testnet:
	bash ./scripts/deploy/deploy-testnet.sh

deploy-dry-run:
	bash ./scripts/deploy/dry-run.sh

verify-testnet:
	bash ./scripts/verify/testnet-smoke-test.sh

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

chainlist-package:
	bash ./scripts/package/chainlist-package.sh

exchange-integration-check:
	bash ./scripts/verify/exchange-integration-check.sh

developer-quickstart-check:
	bash ./scripts/verify/developer-quickstart-check.sh

public-proof:
	bash ./scripts/package/public-proof.sh
