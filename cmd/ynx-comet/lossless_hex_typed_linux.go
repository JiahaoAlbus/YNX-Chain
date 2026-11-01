//go:build linux && ynx_lossless_hex

package main

import (
	"github.com/cometbft/cometbft/mempool"
	nm "github.com/cometbft/cometbft/node"
)

func operatorLosslessHexCapability() error { return nil }

func operatorLosslessHexOption() nm.Option {
	// Zero selects the supplier's finite original limits, never unlimited work.
	// No CLI budget override, alternate encoding or fallback is introduced here.
	return nm.ExperimentalMempoolLosslessHex(mempool.LosslessHexLimits{})
}
