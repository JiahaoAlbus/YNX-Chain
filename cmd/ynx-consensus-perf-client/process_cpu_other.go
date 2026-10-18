//go:build !linux && !darwin

package main

import "errors"

func readProcessCPUUsage() (processCPUUsage, error) {
	return processCPUUsage{}, errors.New("RUSAGE_SELF CPU sampling unavailable on this platform")
}
