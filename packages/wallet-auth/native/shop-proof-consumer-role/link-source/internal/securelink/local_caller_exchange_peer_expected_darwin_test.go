//go:build darwin && cgo

package securelink

import "testing"

func publicOriginalLocalCallerExpectedStart(t *testing.T, pid int) (uint32, uint64, uint64, uint32) {
	t.Helper()
	a, b, uid, err := originalLocalCallerDarwinStart(pid)
	if err != nil {
		t.Fatal(err)
	}
	return LocalCallerDarwinProcessStart, a, b, uid
}
