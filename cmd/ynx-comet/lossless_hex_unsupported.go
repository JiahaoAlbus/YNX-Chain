//go:build !linux || !ynx_lossless_hex

package main

import (
	"errors"

	nm "github.com/cometbft/cometbft/node"
)

func operatorLosslessHexCapability() error {
	return errors.New("lossless carrier unsupported: requires the independently selected matching Linux ynx_lossless_hex build")
}

func operatorLosslessHexOption() nm.Option { return nil }
