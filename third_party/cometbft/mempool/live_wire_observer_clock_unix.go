//go:build linux || darwin

package mempool

import (
	"errors"
	"math"

	"golang.org/x/sys/unix"
)

func liveWireMonotonicNS() (uint64, error) {
	var ts unix.Timespec
	if err := unix.ClockGettime(unix.CLOCK_MONOTONIC, &ts); err != nil {
		return 0, err
	}
	if ts.Sec < 0 || ts.Nsec < 0 || ts.Nsec >= 1_000_000_000 || uint64(ts.Sec) > (math.MaxUint64-uint64(ts.Nsec))/1_000_000_000 {
		return 0, errors.New("invalid CLOCK_MONOTONIC value")
	}
	return uint64(ts.Sec)*1_000_000_000 + uint64(ts.Nsec), nil
}
