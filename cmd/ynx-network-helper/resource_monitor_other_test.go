//go:build !darwin

package main_test

import "testing"

func resourceMonitorBinary(t *testing.T, dir string) (string, string) {
	t.Helper()
	t.Fatal("Darwin monitor requested on unsupported host")
	return "", ""
}
