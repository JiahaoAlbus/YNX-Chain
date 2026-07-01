.PHONY: setup devnet dev env-check no-placeholder-check secret-scan preflight test integration-test smoke-test deploy-testnet verify-testnet status logs restart backup rollback docs grant-package ecosystem-package exchange-package mainnet-readiness wallet-integration-check chainlist-package exchange-integration-check developer-quickstart-check public-proof

setup:
	go mod tidy

devnet:
	YNX_NETWORK=devnet YNX_HTTP_ADDR=127.0.0.1:6420 YNX_DATA_DIR=./tmp/devnet-state go run ./cmd/ynx-chaind

dev: devnet

env-check:
	./scripts/validate/env-check.sh

no-placeholder-check:
	./scripts/validate/no-placeholder-check.sh

secret-scan:
	./scripts/validate/secret-scan.sh

preflight:
	./scripts/deploy/preflight.sh

test:
	go test ./...

integration-test:
	go test ./...

smoke-test:
	./scripts/verify/testnet-smoke-test.sh

deploy-testnet:
	./scripts/deploy/deploy-testnet.sh

verify-testnet:
	./scripts/verify/testnet-smoke-test.sh

status:
	./scripts/ops/status.sh

logs:
	./scripts/ops/logs.sh

restart:
	./scripts/ops/restart.sh

backup:
	./scripts/ops/backup.sh

rollback:
	./scripts/ops/rollback.sh

docs:
	./scripts/package/docs.sh

grant-package:
	./scripts/package/grant-package.sh

ecosystem-package:
	./scripts/package/ecosystem-package.sh

exchange-package:
	./scripts/package/exchange-package.sh

mainnet-readiness:
	./scripts/package/mainnet-readiness.sh

wallet-integration-check:
	./scripts/verify/wallet-integration-check.sh

chainlist-package:
	./scripts/package/chainlist-package.sh

exchange-integration-check:
	./scripts/verify/exchange-integration-check.sh

developer-quickstart-check:
	./scripts/verify/developer-quickstart-check.sh

public-proof:
	./scripts/package/public-proof.sh

