//go:build !linux

package main

import (
	"errors"
	"os"
)

func wireLiveUnsupported() error {
	return errors.New("live operator wire capture requires Linux original /proc identity and CLOCK_MONOTONIC")
}
func validateOperatorWireLivePath(string) error { return wireLiveUnsupported() }
func openOperatorWireLiveDirectory(string, bool) (*os.Root, *os.File, os.FileInfo, error) {
	return nil, nil, nil, wireLiveUnsupported()
}
func currentOperatorWireLiveDirectory(string, *os.Root, *os.File, os.FileInfo) error {
	return wireLiveUnsupported()
}
func operatorWireLiveProcessIdentity() (operatorWireLiveIdentity, error) {
	return operatorWireLiveIdentity{}, wireLiveUnsupported()
}
func operatorWireLiveMonotonic() (uint64, error) { return 0, wireLiveUnsupported() }
func readOperatorWireLiveFile(*os.Root, string, int64) ([]byte, error) {
	return nil, wireLiveUnsupported()
}
func writeOperatorWireLiveFile(*os.Root, *os.File, string, []byte) error {
	return wireLiveUnsupported()
}
func publishOperatorWireLiveRequest(*os.Root, *os.File, string, []byte) error {
	return wireLiveUnsupported()
}
