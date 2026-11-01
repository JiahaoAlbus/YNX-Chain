//go:build !linux && !darwin

package mempool

import "errors"

func liveWireMonotonicNS() (uint64, error) {
	return 0, errors.New("CLOCK_MONOTONIC observation unsupported")
}
