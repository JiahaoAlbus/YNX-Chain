//go:build !darwin && !linux

package chain

import "errors"

func checkOfflinePQCopySpace(string, uint64) error {
	return errors.New("offline PQ copy space admission is unavailable on this platform")
}
