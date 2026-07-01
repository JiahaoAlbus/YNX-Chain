#!/usr/bin/env bash
set -euo pipefail

case "exchange-package" in
  grant-package) dir=docs/grants ;;
  ecosystem-package|chainlist-package) dir=docs/ecosystem ;;
  exchange-package) dir=docs/exchange-listing ;;
  mainnet-readiness) dir=docs/mainnet-readiness ;;
  public-proof) dir=docs/public-proof ;;
  *) dir=docs ;;
esac
test -d "$dir" || { echo "missing $dir"; exit 1; }
find "$dir" -type f | sort
echo "exchange-package package check passed"

