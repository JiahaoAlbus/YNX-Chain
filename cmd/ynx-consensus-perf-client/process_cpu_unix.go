//go:build linux || darwin

package main

import "syscall"

func readProcessCPUUsage() (processCPUUsage, error) {
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		return processCPUUsage{}, err
	}
	return processCPUUsage{UserNs: int64(usage.Utime.Sec)*1e9 + int64(usage.Utime.Usec)*1000, SystemNs: int64(usage.Stime.Sec)*1e9 + int64(usage.Stime.Usec)*1000}, nil
}
