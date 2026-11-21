//go:build !linux

package main

import "testing"

func assertCommitMonotonicBetween(t *testing.T, before commitMonotonicReading, value string, after commitMonotonicReading) {
	t.Fatal("Linux-only clock assertion invoked on unsupported platform")
}
