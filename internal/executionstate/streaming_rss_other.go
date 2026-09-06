//go:build !darwin && !linux

package executionstate

// A platform without an RSS guard cannot claim this mode's memory limit.
func processPeakRSS() int64 { return -1 }
