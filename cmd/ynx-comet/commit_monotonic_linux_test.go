//go:build linux

package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

func assertCommitMonotonicBetween(t *testing.T, before commitMonotonicReading, value string, after commitMonotonicReading) {
	t.Helper()
	a, e1 := strconv.ParseInt(before.NS, 10, 64)
	b, e2 := strconv.ParseInt(value, 10, 64)
	c, e3 := strconv.ParseInt(after.NS, 10, 64)
	if e1 != nil || e2 != nil || e3 != nil || !(a <= b && b <= c) {
		t.Fatalf("CLOCK_MONOTONIC boundary outside same-kernel interval: %q %q %q", before.NS, value, after.NS)
	}
}
func TestCommitMonotonicSameKernelChild(t *testing.T) {
	clock := newCommitMonotonicClock(strings.Repeat("b", 40))
	if os.Getenv("YNX_TEST_SYNTHETIC_CLOCK_CHILD") == "1" {
		reading := clock.read()
		_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"boot": clock.boot, "namespace": clock.namespace, "ns": reading.NS})
		os.Exit(0)
	}
	before := clock.read()
	child := exec.Command(os.Args[0], "-test.run=^TestCommitMonotonicSameKernelChild$")
	child.Env = append(os.Environ(), "YNX_TEST_SYNTHETIC_CLOCK_CHILD=1")
	raw, err := child.Output()
	after := clock.read()
	var value map[string]string
	if err != nil || json.Unmarshal(raw, &value) != nil || value["boot"] != clock.boot || value["namespace"] != clock.namespace {
		t.Fatalf("same-kernel identity mismatch: %v %s", err, raw)
	}
	assertCommitMonotonicBetween(t, before, value["ns"], after)
}
