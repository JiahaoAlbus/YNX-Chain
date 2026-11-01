//go:build !ynx_live_wire_observation

package main

import (
	"errors"
	"github.com/cometbft/cometbft/mempool"
)

const operatorWireLiveLinked = false

func newOperatorWireLiveGetter(*mempool.Reactor) (operatorWireLiveGetter, error) {
	return nil, errors.New("matching typed Reactor live observation not built; after-stop is not live")
}
