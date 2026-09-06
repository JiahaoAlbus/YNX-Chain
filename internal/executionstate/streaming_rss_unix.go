//go:build darwin || linux

package executionstate

import (
	"runtime"
	"syscall"
)

func processPeakRSS() int64 {
	var usage syscall.Rusage
	if syscall.Getrusage(syscall.RUSAGE_SELF, &usage) != nil {
		return 0
	}
	n := usage.Maxrss
	if runtime.GOOS == "linux" {
		n *= 1024
	}
	return n
}
